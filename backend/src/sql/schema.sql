-- ============================================================
-- FACTORY TRAFFIC MANAGEMENT SYSTEM
-- PostgreSQL Database Schema
-- Designed in 3NF
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE junction_mode AS ENUM (
    'AUTOMATIC',
    'MANUAL',
    'EMERGENCY',
    'DEGRADED'
);

CREATE TYPE phase_type AS ENUM (
    'NORTH_SOUTH',
    'EAST_WEST'
);

CREATE TYPE signal_state AS ENUM (
    'RED',
    'YELLOW',
    'GREEN'
);

CREATE TYPE controller_status AS ENUM (
    'ONLINE',
    'OFFLINE',
    'DEGRADED',
    'UNKNOWN'
);

CREATE TYPE direction_type AS ENUM (
    'NORTH',
    'SOUTH',
    'EAST',
    'WEST'
);

CREATE TYPE vehicle_type AS ENUM (
    'FORKLIFT',
    'TRUCK',
    'EMPLOYEE_VEHICLE',
    'EMERGENCY'
);

CREATE TYPE vehicle_status AS ENUM (
    'WAITING',
    'CLEARED'
);

CREATE TYPE sensor_event_type AS ENUM (
    'VEHICLE_DETECTED',
    'VEHICLE_CLEARED'
);

CREATE TYPE processed_event_status AS ENUM (
    'PROCESSED',
    'DUPLICATE',
    'REJECTED'
);

CREATE TYPE command_type AS ENUM (
    'AUTOMATIC_PHASE_CHANGE',
    'MANUAL_GREEN_REQUEST',
    'RETURN_TO_AUTOMATIC',
    'EMERGENCY_PREEMPTION',
    'SAFE_STOP'
);

CREATE TYPE command_status AS ENUM (
    'PENDING',
    'SENT',
    'ACKNOWLEDGED',
    'FAILED',
    'TIMEOUT',
    'CANCELLED'
);

CREATE TYPE audit_event_type AS ENUM (
    'VEHICLE_DETECTED',
    'VEHICLE_CLEARED',
    'DUPLICATE_EVENT',
    'REJECTED_EVENT',

    'SIGNAL_TRANSITION_STARTED',
    'SIGNAL_TRANSITION_COMPLETED',

    'SIGNAL_COMMAND_REQUESTED',
    'SIGNAL_COMMAND_ACKNOWLEDGED',
    'SIGNAL_COMMAND_FAILED',
    'SIGNAL_COMMAND_TIMEOUT',

    'EMERGENCY_DETECTED',
    'EMERGENCY_CLEARED',

    'MANUAL_OVERRIDE_STARTED',
    'MANUAL_OVERRIDE_ENDED',

    'MODE_CHANGED',

    'CONTROLLER_ONLINE',
    'CONTROLLER_OFFLINE',
    'CONTROLLER_FAILURE',

    'SENSOR_ONLINE',
    'SENSOR_OFFLINE',

    'SYSTEM_RECOVERY',
    'SYSTEM_RESTART'
);


-- ============================================================
-- JUNCTIONS
-- ============================================================

CREATE TABLE junctions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name            VARCHAR(100) NOT NULL,
    description     TEXT,

    mode            junction_mode NOT NULL DEFAULT 'AUTOMATIC',
    current_phase   phase_type NOT NULL DEFAULT 'NORTH_SOUTH',

    controller_status controller_status
                    NOT NULL DEFAULT 'UNKNOWN',

    state_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_transition_at TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_junction_name UNIQUE (name)
);


-- ============================================================
-- JUNCTION DIRECTIONS
-- ============================================================

CREATE TABLE junction_directions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    junction_id     UUID NOT NULL
                    REFERENCES junctions(id)
                    ON DELETE CASCADE,

    direction       direction_type NOT NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_junction_direction
        UNIQUE (junction_id, direction)
);


-- ============================================================
-- VEHICLES
--
-- Represents a vehicle currently known to the system.
-- Queue is derived from vehicles with status = WAITING.
-- ============================================================

CREATE TABLE vehicles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    vehicle_id      VARCHAR(100) NOT NULL,

    junction_id     UUID NOT NULL
                    REFERENCES junctions(id)
                    ON DELETE RESTRICT,

    direction       direction_type NOT NULL,

    vehicle_type    vehicle_type NOT NULL,

    status          vehicle_status NOT NULL DEFAULT 'WAITING',

    sensor_timestamp TIMESTAMPTZ,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    sequence_no     BIGINT,

    cleared_at      TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_active_vehicle
        UNIQUE (junction_id, vehicle_id, status)
);


-- ============================================================
-- PROCESSED EVENTS
--
-- event_id is the idempotency key.
--
-- If the same event arrives twice:
-- first request -> PROCESSED
-- second request -> DUPLICATE
-- ============================================================

CREATE TABLE processed_events (
    event_id        VARCHAR(150) PRIMARY KEY,

    junction_id     UUID
                    REFERENCES junctions(id)
                    ON DELETE SET NULL,

    event_type      sensor_event_type,

    status          processed_event_status NOT NULL,

    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ,

    rejection_reason TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SIGNAL STATES
--
-- One row per junction + direction.
--
-- desired_state = what backend wants
-- actual_state  = what controller confirmed
-- ============================================================

CREATE TABLE signal_states (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    junction_id     UUID NOT NULL
                    REFERENCES junctions(id)
                    ON DELETE CASCADE,

    direction       direction_type NOT NULL,

    desired_state   signal_state NOT NULL DEFAULT 'RED',

    actual_state    signal_state,

    actual_state_updated_at TIMESTAMPTZ,

    desired_state_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_signal_junction_direction
        UNIQUE (junction_id, direction)
);


-- ============================================================
-- CONTROLLER COMMANDS
--
-- Every physical controller request gets a unique command_id.
-- ACKs can be correlated using command_id.
-- ============================================================

CREATE TABLE controller_commands (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    command_id      VARCHAR(150) NOT NULL,

    junction_id     UUID NOT NULL
                    REFERENCES junctions(id)
                    ON DELETE RESTRICT,

    command_type    command_type NOT NULL,

    direction       direction_type,

    requested_state signal_state,

    status          command_status NOT NULL DEFAULT 'PENDING',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    sent_at         TIMESTAMPTZ,

    acknowledged_at TIMESTAMPTZ,

    timeout_at      TIMESTAMPTZ,

    completed_at    TIMESTAMPTZ,

    failure_reason  TEXT,

    CONSTRAINT uq_command_id UNIQUE (command_id)
);


-- ============================================================
-- CONTROLLER ACKNOWLEDGEMENTS
--
-- Physical controller response.
-- This is deliberately separate from controller_commands.
-- ============================================================

CREATE TABLE controller_acknowledgements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    command_id      UUID NOT NULL
                    REFERENCES controller_commands(id)
                    ON DELETE RESTRICT,

    status          command_status NOT NULL,

    actual_state    signal_state,

    controller_timestamp TIMESTAMPTZ,

    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    message         TEXT
);


-- ============================================================
-- EMERGENCIES
--
-- Keeps emergency lifecycle separate from vehicle records.
-- ============================================================

CREATE TABLE emergencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    vehicle_id      UUID NOT NULL
                    REFERENCES vehicles(id)
                    ON DELETE RESTRICT,

    junction_id     UUID NOT NULL
                    REFERENCES junctions(id)
                    ON DELETE RESTRICT,

    direction       direction_type NOT NULL,

    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    cleared_at      TIMESTAMPTZ,

    active          BOOLEAN NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- MANUAL OVERRIDES
-- ============================================================

CREATE TABLE manual_overrides (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    junction_id     UUID NOT NULL
                    REFERENCES junctions(id)
                    ON DELETE RESTRICT,

    requested_direction direction_type NOT NULL,

    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    ended_at        TIMESTAMPTZ,

    active          BOOLEAN NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- AUDIT LOG
--
-- Immutable history of important system events.
-- ============================================================

CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,

    junction_id     UUID
                    REFERENCES junctions(id)
                    ON DELETE SET NULL,

    event_type      audit_event_type NOT NULL,

    description     TEXT NOT NULL,

    entity_type     VARCHAR(50),
    entity_id       VARCHAR(150),

    metadata        JSONB,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SENSOR STATUS
-- ============================================================

CREATE TABLE sensor_status (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    junction_id     UUID NOT NULL
                    REFERENCES junctions(id)
                    ON DELETE CASCADE,

    direction       direction_type NOT NULL,

    status          controller_status NOT NULL DEFAULT 'UNKNOWN',

    last_event_at   TIMESTAMPTZ,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_sensor_junction_direction
        UNIQUE (junction_id, direction)
);


-- ============================================================
-- INDEXES
-- ============================================================

-- Vehicle queue queries
CREATE INDEX idx_vehicles_queue
ON vehicles (junction_id, direction, status);

-- Waiting time / scheduler queries
CREATE INDEX idx_vehicles_waiting
ON vehicles (junction_id, status, received_at);

-- Vehicle lookup
CREATE INDEX idx_vehicles_vehicle_id
ON vehicles (junction_id, vehicle_id);

-- Event history
CREATE INDEX idx_processed_events_junction
ON processed_events (junction_id, received_at);

-- Controller commands
CREATE INDEX idx_commands_junction_status
ON controller_commands (junction_id, status);

-- ACK lookup
CREATE INDEX idx_ack_command
ON controller_acknowledgements (command_id);

-- Emergency scheduler
CREATE INDEX idx_emergencies_active
ON emergencies (junction_id, active, detected_at);

-- Audit history
CREATE INDEX idx_audit_junction_time
ON audit_logs (junction_id, created_at DESC);

-- Sensor monitoring
CREATE INDEX idx_sensor_status_junction
ON sensor_status (junction_id);


-- ============================================================
-- PARTIAL INDEXES
-- ============================================================

-- Only one active emergency per vehicle.
CREATE UNIQUE INDEX uq_active_emergency_vehicle
ON emergencies (vehicle_id)
WHERE active = TRUE;

-- Only one active manual override per junction.
CREATE UNIQUE INDEX uq_active_manual_override
ON manual_overrides (junction_id)
WHERE active = TRUE;