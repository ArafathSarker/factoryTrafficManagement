export const DIRECTIONS = ["NORTH", "SOUTH", "EAST", "WEST"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const SIGNAL_STATES = ["RED", "YELLOW", "GREEN", "ALL_RED"] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];

export const PHASES = ["NORTH_SOUTH", "EAST_WEST", "ALL_RED"] as const;
export type Phase = (typeof PHASES)[number];

export const MODES = ["AUTOMATIC", "MANUAL", "EMERGENCY", "FAILURE", "DEGRADED"] as const;
export type Mode = (typeof MODES)[number];

export const DEVICE_STATUSES = ["ONLINE", "OFFLINE", "DEGRADED", "WARNING", "UNKNOWN"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const VEHICLE_TYPES = [
  "FORKLIFT",
  "TRUCK",
  "EMPLOYEE_VEHICLE",
  "EMERGENCY",
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const SENSOR_EVENT_TYPES = ["VEHICLE_ARRIVED", "VEHICLE_CLEARED"] as const;
export type SensorEventType = (typeof SENSOR_EVENT_TYPES)[number];

export const DEVICE_TYPES = [
  "SIGNAL_CONTROLLER",
  "SIGNAL",
  "SENSOR",
  "JUNCTION_CONTROLLER",
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const COMMANDS = [
  "MANUAL_GREEN_REQUEST",
  "MANUAL_YELLOW_REQUEST",
  "MANUAL_ALL_RED_REQUEST",
  "HOLD_PHASE",
  "RETURN_TO_AUTOMATIC",
] as const;
export type CommandName = (typeof COMMANDS)[number];

export const HISTORY_EVENT_TYPES = [
  "VEHICLE_DETECTED",
  "VEHICLE_CLEARED",
  "SENSOR_EVENT_REJECTED",
  "SIGNAL_TRANSITION_STARTED",
  "SIGNAL_STATE_REQUESTED",
  "SIGNAL_CHANGED",
  "EMERGENCY_DETECTED",
  "EMERGENCY_CLEARED",
  "MANUAL_OVERRIDE",
  "RETURN_TO_AUTOMATIC",
  "CONTROLLER_ACK",
  "CONTROLLER_TIMEOUT",
  "COMMAND_FAILED",
  "DEVICE_FAILURE",
  "DEVICE_RECOVERED",
  "MODE_CHANGED",
  "PHASE_CHANGED",
] as const;
export type HistoryEventType = (typeof HISTORY_EVENT_TYPES)[number];

export interface Junction {
  junction_id: string;
  name?: string;
  directions?: Direction[];
  phases?: Phase[];
  green_duration_seconds?: number;
  yellow_duration_seconds?: number;
  all_red_duration_seconds?: number;
}

export interface EmergencyInfo {
  active: boolean;
  direction?: Direction | null;
  vehicle_id?: string | null;
  detected_at?: string | null;
}

export interface PendingCommand {
  command_id: string;
  direction?: Direction | null;
  requested_state?: SignalState | null;
  issued_at?: string;
  expires_at?: string | null;
}

export interface ActiveAlert {
  code: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  direction?: Direction | null;
  device_type?: DeviceType | null;
  since?: string | null;
}

export interface JunctionStatus {
  junction_id: string;
  mode: Mode;
  phase: Phase;
  controller_status: DeviceStatus;
  sensor_status?: DeviceStatus;
  desired_signals: Record<Direction, SignalState>;
  actual_signals: Record<Direction, SignalState>;
  queues: Record<Direction, number>;
  emergency?: EmergencyInfo | null;
  alerts?: ActiveAlert[] | null;
  pending_command?: PendingCommand | null;
  green_remaining_seconds?: number | null;
  updated_at?: string | null;
}

export interface HistoryEntry {
  id?: string | number;
  junction_id: string;
  event_type: HistoryEventType | string;
  direction?: Direction | null;
  previous_state?: string | null;
  new_state?: string | null;
  command_id?: string | null;
  message?: string | null;
  vehicle_id?: string | null;
  device_type?: DeviceType | null;
  timestamp: string;
}

export interface SensorEventRequest {
  event_id?: string;
  junction_id: string;
  direction: Direction;
  event_type: SensorEventType;
  vehicle_id: string;
  vehicle_type: VehicleType;
  sequence_no?: number;
  timestamp?: string;
}

export interface ControllerEventRequest {
  command_id: string;
  junction_id: string;
  status: "ACK" | "NACK" | "OFFLINE";
  actual_state?: SignalState;
  direction?: Direction;
  device_type?: DeviceType;
  timestamp?: string;
}

export interface CommandRequest {
  command: CommandName;
  direction?: Direction;
  requested_state?: SignalState;
}

export interface SensorEventResult {
  accepted: boolean;
  duplicate?: boolean;
  rejected_reason?: string | null;
  event_id?: string;
  queues?: Record<Direction, number>;
}

export interface ControllerEventResult {
  accepted: boolean;
  duplicate?: boolean;
  reason?: string | null;
}

export interface CommandResult {
  accepted: boolean;
  message?: string;
  command_id?: string;
  mode?: Mode;
  status?: JunctionStatus;
}

export interface CreateJunctionRequest {
  junction_id: string;
  name?: string;
  directions?: Direction[];
  green_duration_seconds?: number;
  yellow_duration_seconds?: number;
  all_red_duration_seconds?: number;
}

export interface HistoryQuery {
  limit?: number;
  eventType?: HistoryEventType;
  direction?: Direction;
}