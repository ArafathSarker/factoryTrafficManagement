export const databaseSchema = [
  {
    name: "extension_pgcrypto",
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
    `,
  },

  {
    name: "enum_junction_mode",
    sql: `
      CREATE TYPE junction_mode AS ENUM (
        'AUTOMATIC',
        'MANUAL',
        'EMERGENCY',
        'DEGRADED'
      );
    `,
  },

  {
    name: "enum_phase_type",
    sql: `
      CREATE TYPE phase_type AS ENUM (
        'NORTH_SOUTH',
        'EAST_WEST'
      );
    `,
  },

  {
    name: "enum_signal_state",
    sql: `
      CREATE TYPE signal_state AS ENUM (
        'RED',
        'YELLOW',
        'GREEN'
      );
    `,
  },

  {
    name: "enum_controller_status",
    sql: `
      CREATE TYPE controller_status AS ENUM (
        'ONLINE',
        'OFFLINE',
        'DEGRADED',
        'UNKNOWN'
      );
    `,
  },

  {
    name: "enum_direction_type",
    sql: `
      CREATE TYPE direction_type AS ENUM (
        'NORTH',
        'SOUTH',
        'EAST',
        'WEST'
      );
    `,
  },

  {
    name: "enum_vehicle_type",
    sql: `
      CREATE TYPE vehicle_type AS ENUM (
        'FORKLIFT',
        'TRUCK',
        'EMPLOYEE_VEHICLE',
        'EMERGENCY'
      );
    `,
  },

  {
    name: "enum_vehicle_status",
    sql: `
      CREATE TYPE vehicle_status AS ENUM (
        'WAITING',
        'CLEARED'
      );
    `,
  },

  {
    name: "enum_sensor_event_type",
    sql: `
      CREATE TYPE sensor_event_type AS ENUM (
        'VEHICLE_DETECTED',
        'VEHICLE_CLEARED'
      );
    `,
  },

  {
    name: "enum_processed_event_status",
    sql: `
      CREATE TYPE processed_event_status AS ENUM (
        'PROCESSED',
        'DUPLICATE',
        'REJECTED'
      );
    `,
  },

  {
    name: "enum_command_type",
    sql: `
      CREATE TYPE command_type AS ENUM (
        'AUTOMATIC_PHASE_CHANGE',
        'MANUAL_GREEN_REQUEST',
        'RETURN_TO_AUTOMATIC',
        'EMERGENCY_PREEMPTION',
        'SAFE_STOP'
      );
    `,
  },

  {
    name: "enum_command_status",
    sql: `
      CREATE TYPE command_status AS ENUM (
        'PENDING',
        'SENT',
        'ACKNOWLEDGED',
        'FAILED',
        'TIMEOUT',
        'CANCELLED'
      );
    `,
  },

  {
    name: "enum_audit_event_type",
    sql: `
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
    `,
  },

  {
    name: "table_junctions",
    sql: `
      CREATE TABLE junctions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        name VARCHAR(100) NOT NULL,
        description TEXT,

        mode junction_mode NOT NULL DEFAULT 'AUTOMATIC',

        current_phase phase_type
          NOT NULL DEFAULT 'NORTH_SOUTH',

        controller_status controller_status
          NOT NULL DEFAULT 'UNKNOWN',

        state_started_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        next_transition_at TIMESTAMPTZ,

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        updated_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        CONSTRAINT uq_junction_name
          UNIQUE (name)
      );
    `,
  },

  {
    name: "table_junction_directions",
    sql: `
      CREATE TABLE junction_directions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        junction_id UUID NOT NULL
          REFERENCES junctions(id)
          ON DELETE CASCADE,

        direction direction_type NOT NULL,

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        CONSTRAINT uq_junction_direction
          UNIQUE (junction_id, direction)
      );
    `,
  },

  {
    name: "table_vehicles",
    sql: `
      CREATE TABLE vehicles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        vehicle_id VARCHAR(100) NOT NULL,

        junction_id UUID NOT NULL
          REFERENCES junctions(id)
          ON DELETE RESTRICT,

        direction direction_type NOT NULL,

        vehicle_type vehicle_type NOT NULL,

        status vehicle_status
          NOT NULL DEFAULT 'WAITING',

        sensor_timestamp TIMESTAMPTZ,

        received_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        sequence_no BIGINT,

        cleared_at TIMESTAMPTZ,

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        updated_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        CONSTRAINT uq_active_vehicle
          UNIQUE (junction_id, vehicle_id, status)
      );
    `,
  },

  {
    name: "table_processed_events",
    sql: `
      CREATE TABLE processed_events (
        event_id VARCHAR(150) PRIMARY KEY,

        junction_id UUID
          REFERENCES junctions(id)
          ON DELETE SET NULL,

        event_type sensor_event_type,

        status processed_event_status NOT NULL,

        received_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        processed_at TIMESTAMPTZ,

        rejection_reason TEXT,

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      );
    `,
  },

  {
    name: "table_signal_states",
    sql: `
      CREATE TABLE signal_states (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        junction_id UUID NOT NULL
          REFERENCES junctions(id)
          ON DELETE CASCADE,

        direction direction_type NOT NULL,

        desired_state signal_state
          NOT NULL DEFAULT 'RED',

        actual_state signal_state,

        actual_state_updated_at TIMESTAMPTZ,

        desired_state_updated_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        updated_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        CONSTRAINT uq_signal_junction_direction
          UNIQUE (junction_id, direction)
      );
    `,
  },

  {
    name: "table_controller_commands",
    sql: `
      CREATE TABLE controller_commands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        command_id VARCHAR(150) NOT NULL,

        junction_id UUID NOT NULL
          REFERENCES junctions(id)
          ON DELETE RESTRICT,

        command_type command_type NOT NULL,

        direction direction_type,

        requested_state signal_state,

        status command_status
          NOT NULL DEFAULT 'PENDING',

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        sent_at TIMESTAMPTZ,

        acknowledged_at TIMESTAMPTZ,

        timeout_at TIMESTAMPTZ,

        completed_at TIMESTAMPTZ,

        failure_reason TEXT,

        CONSTRAINT uq_command_id
          UNIQUE (command_id)
      );
    `,
  },

  {
    name: "table_controller_acknowledgements",
    sql: `
      CREATE TABLE controller_acknowledgements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        command_id UUID NOT NULL
          REFERENCES controller_commands(id)
          ON DELETE RESTRICT,

        status command_status NOT NULL,

        actual_state signal_state,

        controller_timestamp TIMESTAMPTZ,

        received_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        message TEXT
      );
    `,
  },

  {
    name: "table_emergencies",
    sql: `
      CREATE TABLE emergencies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        vehicle_id UUID NOT NULL
          REFERENCES vehicles(id)
          ON DELETE RESTRICT,

        junction_id UUID NOT NULL
          REFERENCES junctions(id)
          ON DELETE RESTRICT,

        direction direction_type NOT NULL,

        detected_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        cleared_at TIMESTAMPTZ,

        active BOOLEAN NOT NULL DEFAULT TRUE,

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      );
    `,
  },

  {
    name: "table_manual_overrides",
    sql: `
      CREATE TABLE manual_overrides (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        junction_id UUID NOT NULL
          REFERENCES junctions(id)
          ON DELETE RESTRICT,

        requested_direction direction_type NOT NULL,

        started_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        ended_at TIMESTAMPTZ,

        active BOOLEAN NOT NULL DEFAULT TRUE,

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      );
    `,
  },

  {
    name: "table_audit_logs",
    sql: `
      CREATE TABLE audit_logs (
        id BIGSERIAL PRIMARY KEY,

        junction_id UUID
          REFERENCES junctions(id)
          ON DELETE SET NULL,

        event_type audit_event_type NOT NULL,

        description TEXT NOT NULL,

        entity_type VARCHAR(50),

        entity_id VARCHAR(150),

        metadata JSONB,

        created_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW()
      );
    `,
  },

  {
    name: "table_sensor_status",
    sql: `
      CREATE TABLE sensor_status (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        junction_id UUID NOT NULL
          REFERENCES junctions(id)
          ON DELETE CASCADE,

        direction direction_type NOT NULL,

        status controller_status
          NOT NULL DEFAULT 'UNKNOWN',

        last_event_at TIMESTAMPTZ,

        updated_at TIMESTAMPTZ
          NOT NULL DEFAULT NOW(),

        CONSTRAINT uq_sensor_junction_direction
          UNIQUE (junction_id, direction)
      );
    `,
  },

  // ==========================================================
  // INDEXES
  // ==========================================================

  {
    name: "index_vehicles_queue",
    sql: `
      CREATE INDEX idx_vehicles_queue
      ON vehicles (junction_id, direction, status);
    `,
  },

  {
    name: "index_vehicles_waiting",
    sql: `
      CREATE INDEX idx_vehicles_waiting
      ON vehicles (junction_id, status, received_at);
    `,
  },

  {
    name: "index_vehicles_vehicle_id",
    sql: `
      CREATE INDEX idx_vehicles_vehicle_id
      ON vehicles (junction_id, vehicle_id);
    `,
  },

  {
    name: "index_processed_events_junction",
    sql: `
      CREATE INDEX idx_processed_events_junction
      ON processed_events (junction_id, received_at);
    `,
  },

  {
    name: "index_commands_junction_status",
    sql: `
      CREATE INDEX idx_commands_junction_status
      ON controller_commands (junction_id, status);
    `,
  },

  {
    name: "index_ack_command",
    sql: `
      CREATE INDEX idx_ack_command
      ON controller_acknowledgements (command_id);
    `,
  },

  {
    name: "index_emergencies_active",
    sql: `
      CREATE INDEX idx_emergencies_active
      ON emergencies (junction_id, active, detected_at);
    `,
  },

  {
    name: "index_audit_junction_time",
    sql: `
      CREATE INDEX idx_audit_junction_time
      ON audit_logs (junction_id, created_at DESC);
    `,
  },

  {
    name: "index_sensor_status_junction",
    sql: `
      CREATE INDEX idx_sensor_status_junction
      ON sensor_status (junction_id);
    `,
  },

  // ==========================================================
  // PARTIAL / UNIQUE INDEXES
  // ==========================================================

  {
    name: "index_active_emergency_vehicle",
    sql: `
      CREATE UNIQUE INDEX uq_active_emergency_vehicle
      ON emergencies (vehicle_id)
      WHERE active = TRUE;
    `,
  },

  {
    name: "index_active_manual_override",
    sql: `
      CREATE UNIQUE INDEX uq_active_manual_override
      ON manual_overrides (junction_id)
      WHERE active = TRUE;
    `,
  },
] as const;