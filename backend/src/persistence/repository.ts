import { pool } from "../config/db.js";
import { Phase, Direction, Mode, PhaseSignals } from "../domain/trafficEngine.js";

export async function getJunction(idOrName: string) {
    const res = await pool.query(
        "SELECT * FROM junctions WHERE id::text = $1 OR name = $1",
        [idOrName]
    );
    return res.rows[0];
}

export async function createJunction(name: string, description: string) {
    const res = await pool.query(
        "INSERT INTO junctions (name, description, mode, current_phase) VALUES ($1, $2, 'AUTOMATIC', 'NORTH_SOUTH') RETURNING *",
        [name, description]
    );
    const junction = res.rows[0];
    const directions: Direction[] = ["NORTH", "SOUTH", "EAST", "WEST"];
    for (const d of directions) {
        await pool.query("INSERT INTO junction_directions (junction_id, direction) VALUES ($1, $2)", [junction.id, d]);
        await pool.query("INSERT INTO signal_states (junction_id, direction, desired_state, actual_state) VALUES ($1, $2, 'RED', 'RED')", [junction.id, d]);
    }
    return junction;
}

export async function getQueues(junctionId: string): Promise<Record<Direction, number>> {
    const res = await pool.query(
        "SELECT direction, COUNT(*) as cnt FROM vehicles WHERE junction_id = $1 AND status = 'WAITING' GROUP BY direction",
        [junctionId]
    );
    const queues: Record<Direction, number> = { NORTH: 0, SOUTH: 0, EAST: 0, WEST: 0 };
    res.rows.forEach(r => {
        queues[r.direction as Direction] = parseInt(r.cnt);
    });
    return queues;
}

export async function addVehicle(eventId: string, junctionId: string, direction: string, vehicleId: string, vehicleType: string, seqNo: number, ts: string) {
    const check = await pool.query("SELECT * FROM processed_events WHERE event_id = $1", [eventId]);
    if (check.rows.length > 0) return { duplicate: true };

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("INSERT INTO processed_events (event_id, junction_id, event_type, status, received_at) VALUES ($1, $2, 'VEHICLE_DETECTED', 'PROCESSED', NOW())", [eventId, junctionId]);
        await client.query("INSERT INTO vehicles (vehicle_id, junction_id, direction, vehicle_type, sensor_timestamp, sequence_no) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ON CONSTRAINT uq_active_vehicle DO NOTHING RETURNING id", [vehicleId, junctionId, direction, vehicleType, ts, seqNo]);
        const vRes = await client.query("SELECT id FROM vehicles WHERE vehicle_id = $1 AND junction_id = $2 AND status = 'WAITING'", [vehicleId, junctionId]);
        
        if (vehicleType === "EMERGENCY" && vRes.rows.length > 0) {
            await client.query("INSERT INTO emergencies (vehicle_id, junction_id, direction) VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT uq_active_emergency_vehicle DO NOTHING", [vRes.rows[0].id, junctionId, direction]);
        }
        await client.query("COMMIT");
        return { duplicate: false };
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}

export async function removeVehicle(eventId: string, junctionId: string, direction: string, vehicleId: string, seqNo: number, ts: string) {
    const check = await pool.query("SELECT * FROM processed_events WHERE event_id = $1", [eventId]);
    if (check.rows.length > 0) return { duplicate: true };

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("INSERT INTO processed_events (event_id, junction_id, event_type, status, received_at) VALUES ($1, $2, 'VEHICLE_CLEARED', 'PROCESSED', NOW())", [eventId, junctionId]);
        await client.query("UPDATE vehicles SET status = 'CLEARED', cleared_at = NOW() WHERE junction_id = $1 AND vehicle_id = $2 AND status = 'WAITING' RETURNING id", [junctionId, vehicleId]);
        const vRes = await client.query("SELECT id FROM vehicles WHERE vehicle_id = $1 AND junction_id = $2 ORDER BY created_at DESC LIMIT 1", [vehicleId, junctionId]);
        if (vRes.rows.length > 0) {
            await client.query("UPDATE emergencies SET active = FALSE, cleared_at = NOW() WHERE vehicle_id = $1", [vRes.rows[0].id]);
        }
        await client.query("COMMIT");
        return { duplicate: false };
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}

export async function updateJunctionState(junctionId: string, phase: string, mode: string) {
    await pool.query("UPDATE junctions SET current_phase = $1, mode = $2 WHERE id = $3", [phase, mode, junctionId]);
}

export async function getSignalStates(junctionId: string) {
    const res = await pool.query("SELECT direction, desired_state, actual_state FROM signal_states WHERE junction_id = $1", [junctionId]);
    return res.rows;
}

export async function updateSignalDesiredState(junctionId: string, signals: PhaseSignals) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const [dir, state] of Object.entries(signals)) {
            await client.query("UPDATE signal_states SET desired_state = $1, desired_state_updated_at = NOW() WHERE junction_id = $2 AND direction = $3", [state, junctionId, dir]);
        }
        await client.query("COMMIT");
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}

export async function getJunctionStatus(id: string) {
    const j = await getJunction(id);
    if (!j) return null;
    const signals = await getSignalStates(j.id);
    const queues = await getQueues(j.id);
    const desired: any = {};
    const actual: any = {};
    signals.forEach(s => {
        desired[s.direction] = s.desired_state;
        actual[s.direction] = s.actual_state || "RED";
    });
    const emergRes = await pool.query(`
        SELECT e.active, e.direction, e.detected_at, v.vehicle_id 
        FROM emergencies e 
        JOIN vehicles v ON e.vehicle_id = v.id 
        WHERE e.junction_id = $1 AND e.active = TRUE LIMIT 1
    `, [j.id]);
    const emergency = emergRes.rows.length > 0 ? emergRes.rows[0] : null;

    return {
        junction_id: j.id,
        mode: j.mode,
        phase: j.current_phase,
        controller_status: j.controller_status,
        desired_signals: desired,
        actual_signals: actual,
        queues,
        emergency
    };
}
