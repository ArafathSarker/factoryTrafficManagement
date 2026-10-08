import { pool } from "../config/db.js";
import { computeNextPhase, getSignalsForPhase, Phase, PhaseSignals, GREEN_DURATION_MS, YELLOW_DURATION_MS, ALL_RED_DURATION_MS } from "../domain/trafficEngine.js";

export async function runScheduler() {
    setInterval(async () => {
        try {
            const { rows: junctions } = await pool.query("SELECT id FROM junctions");
            for (const j of junctions) {
                await tickJunction(j.id);
            }
        } catch (e) {
            console.error("Scheduler error", e);
        }
    }, 1000);
}

async function calculateNextPhase(client: any, junctionId: string, junction: any): Promise<Phase> {
    const vRes = await client.query(`
        SELECT direction, vehicle_type, sensor_timestamp
        FROM vehicles
        WHERE junction_id = $1 AND status = 'WAITING'
    `, [junctionId]);

    let nsScore = 0;
    let ewScore = 0;
    const now = new Date().getTime();

    for (const v of vRes.rows) {
        let weight = 1;
        if (v.vehicle_type === 'TRUCK') weight = 5;
        if (v.vehicle_type === 'FORKLIFT') weight = 2;
        
        const waitTimeMs = now - new Date(v.sensor_timestamp).getTime();
        // Add wait time multiplier (1 point per 10 seconds waiting)
        weight += Math.floor(waitTimeMs / 10000);

        if (v.direction === 'NORTH' || v.direction === 'SOUTH') nsScore += weight;
        else ewScore += weight;
    }

    if (nsScore === 0 && ewScore === 0) return junction.current_phase;
    return nsScore >= ewScore ? "NORTH_SOUTH" : "EAST_WEST";
}

async function tickJunction(junctionId: string) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        
        // 1. Lock the junction row
        const jRes = await client.query("SELECT * FROM junctions WHERE id = $1 FOR UPDATE", [junctionId]);
        if (jRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return;
        }
        const junction = jRes.rows[0];
        
        // 2. Fetch signal states
        const sigRes = await client.query("SELECT direction, desired_state FROM signal_states WHERE junction_id = $1", [junctionId]);
        let nsState = "RED";
        let ewState = "RED";
        for (const row of sigRes.rows) {
            if (row.direction === "NORTH") nsState = row.desired_state;
            if (row.direction === "EAST") ewState = row.desired_state;
        }
        
        const now = new Date().getTime();
        const transitionAt = junction.next_transition_at ? new Date(junction.next_transition_at).getTime() : 0;
        
        // Determine active color state logically
        let currentColorState = "RED";
        if (nsState === "GREEN" || ewState === "GREEN") currentColorState = "GREEN";
        else if (nsState === "YELLOW" || ewState === "YELLOW") currentColorState = "YELLOW";
        else currentColorState = "ALL_RED";
        

        const targetPhase = await calculateNextPhase(client, junctionId, junction);

        // Check for active emergencies
        // Expire emergencies older than 5 minutes
        await client.query("UPDATE emergencies SET active = FALSE WHERE active = TRUE AND detected_at < NOW() - INTERVAL '5 minutes'");
        
        const emergRes = await client.query("SELECT direction FROM emergencies WHERE junction_id = $1 AND active = TRUE LIMIT 1", [junctionId]);
        let activeEmergencyPhase: Phase | null = null;
        if (emergRes.rows.length > 0) {
            const eDir = emergRes.rows[0].direction;
            activeEmergencyPhase = (eDir === "NORTH" || eDir === "SOUTH") ? "NORTH_SOUTH" : "EAST_WEST";
            if (junction.mode !== "EMERGENCY") {
                await client.query("UPDATE junctions SET mode = 'EMERGENCY' WHERE id = $1", [junctionId]);
                junction.mode = "EMERGENCY";
            }
        } else if (junction.mode === "EMERGENCY") {
            // Revert to automatic if no emergencies
            await client.query("UPDATE junctions SET mode = 'AUTOMATIC' WHERE id = $1", [junctionId]);
            junction.mode = "AUTOMATIC";
        }
        
        // Manual override checking
        // Expire manual overrides older than 10 minutes
        await client.query("UPDATE manual_overrides SET active = FALSE, ended_at = NOW() WHERE active = TRUE AND created_at < NOW() - INTERVAL '10 minutes'");
        if (junction.mode === "MANUAL") {
            const manualRes = await client.query("SELECT * FROM manual_overrides WHERE junction_id = $1 AND active = TRUE LIMIT 1", [junctionId]);
            if (manualRes.rows.length === 0) {
                // Manual override expired
                await client.query("UPDATE junctions SET mode = 'AUTOMATIC' WHERE id = $1", [junctionId]);
                junction.mode = "AUTOMATIC";
            }
        }

        // Controller timeout check (if desired_state hasn't matched actual_state for > 15s)
        const offlineCheck = await client.query(`
            SELECT 1 FROM signal_states 
            WHERE junction_id = $1 AND desired_state != actual_state 
            AND desired_state_updated_at < NOW() - INTERVAL '15 seconds'
            LIMIT 1
        `, [junctionId]);
        if (offlineCheck.rows.length > 0 && junction.controller_status !== "OFFLINE") {
            await client.query("UPDATE junctions SET controller_status = 'OFFLINE' WHERE id = $1", [junctionId]);
        } else if (offlineCheck.rows.length === 0 && junction.controller_status === "OFFLINE") {
            await client.query("UPDATE junctions SET controller_status = 'ONLINE' WHERE id = $1", [junctionId]);
        }

        let resolvedPhase = targetPhase;
        if (junction.mode === "EMERGENCY" && activeEmergencyPhase) resolvedPhase = activeEmergencyPhase;
        if (junction.mode === "MANUAL") resolvedPhase = junction.current_phase as Phase;

        // State machine transition logic
        if (currentColorState === "GREEN") {
            const needSwitch = resolvedPhase !== junction.current_phase;
            const timeUp = now >= transitionAt;
            
            if (timeUp || needSwitch) {
                // Move to YELLOW
                const nextT = new Date(now + YELLOW_DURATION_MS);
                await updateJunctionAndSignals(client, junctionId, junction.current_phase, "YELLOW", nextT);
                await auditLog(client, junctionId, "SIGNAL_TRANSITION_STARTED", `Started transition from GREEN to YELLOW for phase ${junction.current_phase}`);
            }
        } else if (currentColorState === "YELLOW") {
            const timeUp = now >= transitionAt;
            if (timeUp) {
                // Move to ALL_RED
                const nextT = new Date(now + ALL_RED_DURATION_MS);
                await updateJunctionAndSignals(client, junctionId, junction.current_phase, "ALL_RED", nextT);
                await auditLog(client, junctionId, "SIGNAL_TRANSITION_STARTED", `Started ALL_RED clearance`);
            }
        } else if (currentColorState === "ALL_RED") {
            const timeUp = now >= transitionAt;
            if (timeUp) {
                // Move to GREEN for the targetPhase
                const nextT = new Date(now + GREEN_DURATION_MS);
                await updateJunctionAndSignals(client, junctionId, targetPhase, "GREEN", nextT);
                await client.query("UPDATE junctions SET current_phase = $1 WHERE id = $2", [targetPhase, junctionId]);
                await auditLog(client, junctionId, "SIGNAL_TRANSITION_COMPLETED", `Transitioned to GREEN for phase ${targetPhase}`);
            }
        }
        
        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        console.error("Error in tickJunction", e);
    } finally {
        client.release();
    }
}

async function updateJunctionAndSignals(client: any, junctionId: string, phase: string, state: "GREEN" | "YELLOW" | "ALL_RED", nextTransitionAt: Date) {
    await client.query("UPDATE junctions SET next_transition_at = $1, state_started_at = NOW() WHERE id = $2", [nextTransitionAt, junctionId]);
    
    const signals = getSignalsForPhase(phase as Phase, state);
    for (const [dir, sig] of Object.entries(signals)) {
        await client.query("UPDATE signal_states SET desired_state = $1, desired_state_updated_at = NOW() WHERE junction_id = $2 AND direction = $3", [sig, junctionId, dir]);
    }
}

async function auditLog(client: any, junctionId: string, eventType: string, description: string) {
    await client.query("INSERT INTO audit_logs (junction_id, event_type, description) VALUES ($1, $2, $3)", [junctionId, eventType, description]);
}
