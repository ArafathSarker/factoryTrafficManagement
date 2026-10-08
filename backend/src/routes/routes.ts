import express from "express";
import { getJunction, createJunction, getJunctionStatus, addVehicle, removeVehicle, updateJunctionState, updateSignalDesiredState, getQueues } from "../persistence/repository.js";
import { pool } from "../config/db.js";

const route = express.Router();

// Auto-seed Junction A for testing
(async () => {
    try {
        const existing = await getJunction("A");
        if (!existing) {
            await createJunction("A", "Main Factory Junction");
            console.log("Seeded Junction A");
        }
    } catch (e) {
        console.error("Failed to seed junction A", e);
    }
})();

route.get("/junctions", async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM junctions");
    res.json(rows);
});

route.get("/junctions/:id", async (req, res) => {
    const j = await getJunction(req.params.id);
    if (!j) return res.status(404).json({ error: "Not found" });
    res.json(j);
});

route.post("/junctions", async (req, res) => {
    const j = await createJunction(req.body.name, req.body.description || "");
    res.json(j);
});

route.get("/junctions/:id/status", async (req, res) => {
    const status = await getJunctionStatus(req.params.id);
    if (!status) return res.status(404).json({ error: "Not found" });
    res.json(status);
});

route.get("/junctions/:id/history", async (req, res) => {
    const { rows } = await pool.query("SELECT id, junction_id, event_type, description as message, entity_type, entity_id, metadata, created_at as timestamp FROM audit_logs WHERE junction_id = $1 ORDER BY created_at DESC LIMIT 50", [req.params.id]);
    res.json(rows);
});

route.post("/junctions/:id/commands", async (req, res) => {
    const { command, direction } = req.body;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // Serialize traffic decisions with a row lock
        const jRes = await client.query("SELECT * FROM junctions WHERE id = $1 FOR UPDATE", [req.params.id]);
        if (jRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Not found" });
        }
        const j = jRes.rows[0];

        if (command === "MANUAL_GREEN_REQUEST") {
            const newPhase = (direction === "NORTH" || direction === "SOUTH") ? "NORTH_SOUTH" : "EAST_WEST";
            await client.query("UPDATE junctions SET mode = 'MANUAL', current_phase = $1 WHERE id = $2", [newPhase, j.id]);

            // Log override
            await client.query("INSERT INTO manual_overrides (junction_id, requested_direction, active) VALUES ($1, $2, TRUE) ON CONFLICT ON CONSTRAINT uq_active_manual_override DO NOTHING", [j.id, direction || 'NORTH']);
            await client.query("INSERT INTO audit_logs (junction_id, event_type, description) VALUES ($1, 'MANUAL_OVERRIDE_STARTED', $2)", [j.id, `Manual override requested for ${direction}`]);

        } else if (command === "RETURN_TO_AUTOMATIC") {
            await client.query("UPDATE junctions SET mode = 'AUTOMATIC' WHERE id = $1", [j.id]);
            await client.query("UPDATE manual_overrides SET active = FALSE, ended_at = NOW() WHERE junction_id = $1 AND active = TRUE", [j.id]);
            await client.query("INSERT INTO audit_logs (junction_id, event_type, description) VALUES ($1, 'RETURN_TO_AUTOMATIC', 'Returned to automatic mode')", [j.id]);
        }

        await client.query("COMMIT");
        res.json({ accepted: true, message: "Accepted" });
    } catch (e) {
        await client.query("ROLLBACK");
        console.error(e);
        res.status(500).json({ error: "Internal error" });
    } finally {
        client.release();
    }
});

route.post("/sensor-events", async (req, res) => {
    const { event_id, junction_id, direction, event_type, vehicle_id, vehicle_type, sequence_no, timestamp } = req.body;

    try {
        const j = await getJunction(junction_id);
        if (!j) return res.status(404).json({ error: "Unknown junction" });

        if (event_type === "VEHICLE_ARRIVED" || event_type === "VEHICLE_DETECTED") {
            const r = await addVehicle(event_id, j.id, direction, vehicle_id, vehicle_type, sequence_no, timestamp);
            if (r.duplicate) return res.status(202).json({ accepted: true, duplicate: true });
        } else if (event_type === "VEHICLE_CLEARED") {
            const r = await removeVehicle(event_id, j.id, direction, vehicle_id, sequence_no, timestamp);
            if (r.duplicate) return res.status(202).json({ accepted: true, duplicate: true });
        }

        // Scheduler logic will evaluate queues on the next tick
        // so we don't instantly switch states here.

        res.status(202).json({ accepted: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Internal error" });
    }
});

route.post("/controller-events", async (req, res) => {
    const { junction_id, actual_state, status, direction } = req.body;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // Serialize traffic decisions with a row lock
        const jRes = await client.query("SELECT * FROM junctions WHERE id = $1 FOR UPDATE", [junction_id]);
        if (jRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Not found" });
        }

        if (status === "ACK") {
            if (actual_state && direction) {
                await client.query("UPDATE signal_states SET actual_state = $1, actual_state_updated_at = NOW() WHERE junction_id = $2 AND direction = $3", [actual_state, junction_id, direction]);
            } else {
                await client.query("UPDATE signal_states SET actual_state = desired_state, actual_state_updated_at = NOW() WHERE junction_id = $1", [junction_id]);
            }
        } else if (status === "NACK" || status === "OFFLINE") {
            await client.query("UPDATE junctions SET controller_status = $1 WHERE id = $2", [status === "OFFLINE" ? "OFFLINE" : "WARNING", junction_id]);
        }

        await client.query("INSERT INTO audit_logs (junction_id, event_type, description) VALUES ($1, 'CONTROLLER_ACK', $2)", [junction_id, `Controller reported ${status}`]);

        await client.query("COMMIT");
        res.json({ accepted: true, message: "ACK applied" });
    } catch (e) {
        await client.query("ROLLBACK");
        console.error(e);
        res.status(500).json({ error: "Failed" });
    } finally {
        client.release();
    }
});

export const appRouter = route;