import {
  DIRECTIONS,
  type Direction,
  type HistoryEntry,
  type HistoryQuery,
  type Junction,
  type JunctionStatus,
  type Phase,
  type SignalState,
  type VehicleType,
} from "../types";
import { ApiError, type Transport } from "../api/errors";

const GREEN_SECONDS = 30;
const YELLOW_SECONDS = 5;
const ALL_RED_SECONDS = 2;
const COMMAND_TIMEOUT_SECONDS = 5;
const ACK_DELAY_SECONDS = 2;
const EMERGENCY_STALE_SECONDS = 60;
const MAX_HISTORY = 200;

const VEHICLE_WEIGHT: Record<VehicleType, number> = {
  EMERGENCY: 100,
  TRUCK: 10,
  FORKLIFT: 5,
  EMPLOYEE_VEHICLE: 1,
};

const VEHICLE_MIX: VehicleType[] = [
  "EMPLOYEE_VEHICLE",
  "EMPLOYEE_VEHICLE",
  "FORKLIFT",
  "FORKLIFT",
  "TRUCK",
];

type PhaseState = "GREEN" | "YELLOW" | "ALL_RED";

interface QueuedVehicle {
  vehicle_id: string;
  vehicle_type: VehicleType;
  arrived_at_ms: number;
}

interface PendingCommandState {
  command_id: string;
  direction: Direction;
  requested_state: SignalState;
  issued_at_ms: number;
  deadline_ms: number;
  ack_at_ms: number | null;
}

interface JunctionState {
  junction_id: string;
  name: string;
  queues: Record<Direction, QueuedVehicle[]>;
  desired: Record<Direction, SignalState>;
  actual: Record<Direction, SignalState>;
  mode: JunctionStatus["mode"];
  phase: Phase;
  phase_state: PhaseState;
  phase_state_ends_at_ms: number;
  green_remaining_seconds: number;
  controller: JunctionStatus["controller_status"];
  sensor: JunctionStatus["controller_status"];
  signals_faulted: boolean;
  emergency: { active: boolean; direction: Direction | null; vehicle_id: string | null; detected_at_ms: number | null };
  manual_target: Direction | null;
  manual_hold: boolean;
  pending_command: PendingCommandState | null;
  auto_ack: boolean;
  processed_events: Set<string>;
  last_sequence_no: number;
  history: HistoryEntry[];
}

const now = () => Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

function allRed(): Record<Direction, SignalState> {
  return { NORTH: "RED", SOUTH: "RED", EAST: "RED", WEST: "RED" };
}

function phaseFor(direction: Direction): Phase {
  return direction === "NORTH" || direction === "SOUTH" ? "NORTH_SOUTH" : "EAST_WEST";
}

function directionsOf(phase: Phase): Direction[] {
  return phase === "NORTH_SOUTH" ? ["NORTH", "SOUTH"] : phase === "EAST_WEST" ? ["EAST", "WEST"] : [];
}

export class MockBackend {
  private junctions = new Map<string, JunctionState>();
  private seq = 1000;
  private commandSeq = 8000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private vehicleSeq = 500;
  private lastRandomArrival = 0;

  constructor() {
    this.seed("A", "Main Gate Junction");
    this.seed("B", "Warehouse Junction");
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private seed(junctionId: string, name: string): void {
    this.junctions.set(junctionId, {
      junction_id: junctionId,
      name,
      queues: { NORTH: [], SOUTH: [], EAST: [], WEST: [] },
      desired: allRed(),
      actual: allRed(),
      mode: "AUTOMATIC",
      phase: "ALL_RED",
      phase_state: "ALL_RED",
      phase_state_ends_at_ms: now() + ALL_RED_SECONDS * 1000,
      green_remaining_seconds: ALL_RED_SECONDS,
      controller: "ONLINE",
      sensor: "ONLINE",
      signals_faulted: false,
      emergency: { active: false, direction: null, vehicle_id: null, detected_at_ms: null },
      manual_target: null,
      manual_hold: false,
      pending_command: null,
      auto_ack: true,
      processed_events: new Set(),
      last_sequence_no: 0,
      history: [],
    });
  }

  private require(id: string): JunctionState {
    const state = this.junctions.get(id);
    if (!state) throw new ApiError("NOT_FOUND", `Junction ${id} does not exist`, 404);
    return state;
  }

  private log(state: JunctionState, entry: Omit<HistoryEntry, "junction_id" | "timestamp">): void {
    state.history.unshift({ ...entry, junction_id: state.junction_id, timestamp: iso(now()) });
    if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
  }

  private nextEventId(): string {
    this.seq += 1;
    return `evt-${this.seq}`;
  }

  private nextCommandId(): string {
    this.commandSeq += 1;
    return `cmd-${this.commandSeq}`;
  }

  // ---------------------------------------------------------------- simulation

  private tick(): void {
    const t = now();
    for (const state of this.junctions.values()) {
      this.maybeAutoArrival(state, t);
      this.expireStaleEmergency(state, t);
      this.resolvePendingCommand(state, t);
      this.advanceSignals(state, t);
      this.updateMode(state);
    }
  }

  private maybeAutoArrival(state: JunctionState, t: number): void {
    if (state.sensor !== "ONLINE") return;
    if (t - this.lastRandomArrival < 6000) return;
    this.lastRandomArrival = t;
    const busy = DIRECTIONS.filter((d) => state.actual[d] === "GREEN");
    const candidates = DIRECTIONS.filter((d) => !busy.includes(d) || Math.random() < 0.25);
    const direction = candidates[Math.floor(Math.random() * candidates.length)];
    const vehicleType = VEHICLE_MIX[Math.floor(Math.random() * VEHICLE_MIX.length)];
    this.vehicleSeq += 1;
    const vehicleId = `VH-${this.vehicleSeq}`;
    this.seq += 1;
    this.applyArrival(state, {
      event_id: `evt-${this.seq}`,
      direction,
      vehicle_id: vehicleId,
      vehicle_type: vehicleType,
      sequence_no: state.last_sequence_no + 1,
      timestamp: iso(t),
      source: "simulation",
    });
  }

  private expireStaleEmergency(state: JunctionState, t: number): void {
    const emergency = state.emergency;
    if (!emergency.active || !emergency.detected_at_ms) return;
    if (t - emergency.detected_at_ms < EMERGENCY_STALE_SECONDS * 1000) return;
    emergency.active = false;
    emergency.detected_at_ms = null;
    this.log(state, {
      event_type: "EMERGENCY_CLEARED",
      message: `Stale emergency cleared after ${EMERGENCY_STALE_SECONDS}s without clearance`,
    });
  }

  private resolvePendingCommand(state: JunctionState, t: number): void {
    const pending = state.pending_command;
    if (!pending) return;
    if (pending.ack_at_ms !== null && t >= pending.ack_at_ms) {
      state.pending_command = null;
      if (state.controller !== "ONLINE") return;
      state.actual[pending.direction] = pending.requested_state;
      this.log(state, {
        event_type: "CONTROLLER_ACK",
        direction: pending.direction,
        new_state: pending.requested_state,
        command_id: pending.command_id,
        message: "Controller confirmed requested state",
      });
      this.log(state, {
        event_type: "SIGNAL_CHANGED",
        direction: pending.direction,
        new_state: pending.requested_state,
        command_id: pending.command_id,
      });
      return;
    }
    if (t >= pending.deadline_ms) {
      state.pending_command = null;
      this.log(state, {
        event_type: "CONTROLLER_TIMEOUT",
        direction: pending.direction,
        command_id: pending.command_id,
        message: `No acknowledgement for ${pending.command_id} within ${COMMAND_TIMEOUT_SECONDS}s`,
      });
    }
  }

  private advanceSignals(state: JunctionState, t: number): void {
    if (t < state.phase_state_ends_at_ms) {
      state.green_remaining_seconds = Math.max(
        0,
        Math.round((state.phase_state_ends_at_ms - t) / 1000),
      );
      return;
    }

    if (state.phase_state === "GREEN") {
      this.beginYellow(state);
      return;
    }
    if (state.phase_state === "YELLOW") {
      this.beginAllRed(state);
      return;
    }
    this.beginNextGreen(state);
  }

  private beginYellow(state: JunctionState): void {
    const t = now();
    state.phase_state = "YELLOW";
    state.phase_state_ends_at_ms = t + YELLOW_SECONDS * 1000;
    state.green_remaining_seconds = YELLOW_SECONDS;
    for (const direction of directionsOf(state.phase)) {
      this.requestSignal(state, direction, "YELLOW");
    }
    this.log(state, {
      event_type: "SIGNAL_TRANSITION_STARTED",
      previous_state: state.phase,
      new_state: "YELLOW",
      message: "Green phase expired, clearing with yellow",
    });
  }

  private beginAllRed(state: JunctionState): void {
    const t = now();
    state.phase_state = "ALL_RED";
    state.phase = "ALL_RED";
    state.phase_state_ends_at_ms = t + ALL_RED_SECONDS * 1000;
    state.green_remaining_seconds = ALL_RED_SECONDS;
    for (const direction of DIRECTIONS) this.requestSignal(state, direction, "RED");
    this.log(state, {
      event_type: "SIGNAL_TRANSITION_STARTED",
      previous_state: "YELLOW",
      new_state: "ALL_RED",
      message: "All-red clearance between conflicting phases",
    });
  }

  private beginNextGreen(state: JunctionState): void {
    const target = this.selectPhase(state);
    if (!target) {
      state.phase_state_ends_at_ms = now() + 2000;
      state.green_remaining_seconds = 2;
      return;
    }
    if (target !== state.phase) {
      this.log(state, {
        event_type: "PHASE_CHANGED",
        previous_state: state.phase,
        new_state: target,
        message: this.explainChoice(state, target),
      });
    }
    state.phase = target;
    state.phase_state = "GREEN";
    state.phase_state_ends_at_ms = now() + GREEN_SECONDS * 1000;
    state.green_remaining_seconds = GREEN_SECONDS;
    for (const direction of directionsOf(target)) this.requestSignal(state, direction, "GREEN");
  }

  private selectPhase(state: JunctionState): Phase | null {
    const scores: Record<Direction, number> = { NORTH: 0, SOUTH: 0, EAST: 0, WEST: 0 };
    const t = now();
    for (const direction of DIRECTIONS) {
      const queue = state.queues[direction];
      if (!queue.length) continue;
      const priorityMass = queue.reduce((sum, v) => sum + VEHICLE_WEIGHT[v.vehicle_type], 0);
      const longestWait = Math.max(
        ...queue.map((v) => (t - v.arrived_at_ms) / 1000),
        0,
      );
      scores[direction] =
        queue.length + priorityMass * 0.5 + longestWait / 10 + (longestWait > 60 ? 15 : 0);
    }
    const byPhase: Record<Phase, number> = {
      NORTH_SOUTH: scores.NORTH + scores.SOUTH,
      EAST_WEST: scores.EAST + scores.WEST,
      ALL_RED: 0,
    };
    const emergency = state.emergency;
    if (emergency.active && emergency.direction) {
      const forced = phaseFor(emergency.direction);
      if (byPhase[forced] >= 0) return forced;
    }
    if (state.manual_hold && state.manual_target) {
      return phaseFor(state.manual_target);
    }
    const served = byPhase[state.phase];
    const best = (Object.keys(byPhase) as Phase[]).reduce((a, b) =>
      byPhase[b] > byPhase[a] ? b : a,
    );
    if (byPhase[best] <= 0) return null;
    if (best === state.phase && byPhase[best] <= served * 1.15) return state.phase;
    return best;
  }

  private explainChoice(state: JunctionState, phase: Phase): string {
    const parts = directionsOf(phase)
      .map((d) => `${d}=${state.queues[d].length}`)
      .join(", ");
    return `Scheduler selected ${phase} (${parts})`;
  }

  private requestSignal(state: JunctionState, direction: Direction, requested: SignalState): void {
    if (state.desired[direction] === requested) return;
    state.desired[direction] = requested;
    const command: PendingCommandState = {
      command_id: this.nextCommandId(),
      direction,
      requested_state: requested,
      issued_at_ms: now(),
      deadline_ms: now() + COMMAND_TIMEOUT_SECONDS * 1000,
      ack_at_ms: state.auto_ack && state.controller === "ONLINE" ? now() + ACK_DELAY_SECONDS * 1000 : null,
    };
    state.pending_command = command;
    this.log(state, {
      event_type: "SIGNAL_STATE_REQUESTED",
      direction,
      new_state: requested,
      command_id: command.command_id,
      message: `Sent ${requested} to controller for ${direction}`,
    });
  }

  private updateMode(state: JunctionState): void {
    const previous = state.mode;
    if (state.controller !== "ONLINE" || state.signals_faulted) {
      state.mode = "FAILURE";
    } else if (state.emergency.active) {
      state.mode = "EMERGENCY";
    } else if (state.manual_hold) {
      state.mode = "MANUAL";
    } else {
      state.mode = "AUTOMATIC";
    }
    if (previous !== state.mode) {
      this.log(state, {
        event_type: "MODE_CHANGED",
        previous_state: previous,
        new_state: state.mode,
        message: `Mode moved to ${state.mode}`,
      });
    }
  }

  // -------------------------------------------------------------- event intake

  private applyArrival(
    state: JunctionState,
    event: {
      event_id: string;
      direction: Direction;
      vehicle_id: string;
      vehicle_type: VehicleType;
      sequence_no: number;
      timestamp: string;
      source: string;
    },
  ): void {
    state.queues[event.direction].push({
      vehicle_id: event.vehicle_id,
      vehicle_type: event.vehicle_type,
      arrived_at_ms: now(),
    });
    state.last_sequence_no = Math.max(state.last_sequence_no, event.sequence_no);
    this.log(state, {
      event_type: "VEHICLE_DETECTED",
      direction: event.direction,
      vehicle_id: event.vehicle_id,
      message: `${event.vehicle_type} ${event.vehicle_id} arrived (${event.source})`,
    });
    if (event.vehicle_type === "EMERGENCY") {
      if (state.emergency.active && state.emergency.direction !== event.direction) {
        this.log(state, {
          event_type: "EMERGENCY_DETECTED",
          direction: event.direction,
          vehicle_id: event.vehicle_id,
          message: `Competing emergency ignored, ${state.emergency.direction} already preempting`,
        });
        return;
      }
      state.emergency = {
        active: true,
        direction: event.direction,
        vehicle_id: event.vehicle_id,
        detected_at_ms: now(),
      };
      this.log(state, {
        event_type: "EMERGENCY_DETECTED",
        direction: event.direction,
        vehicle_id: event.vehicle_id,
        message: `Emergency preemption from ${event.direction}`,
      });
    }
  }

  private applyCleared(
    state: JunctionState,
    event: {
      event_id: string;
      direction: Direction;
      vehicle_id: string;
      sequence_no: number;
      timestamp: string;
      source: string;
    },
  ): void {
    const queue = state.queues[event.direction];
    const index = queue.findIndex((v) => v.vehicle_id === event.vehicle_id);
    if (index === -1) {
      this.log(state, {
        event_type: "SENSOR_EVENT_REJECTED",
        direction: event.direction,
        vehicle_id: event.vehicle_id,
        message: "Clearance for a vehicle that is not queued",
      });
      return;
    }
    queue.splice(index, 1);
    state.last_sequence_no = Math.max(state.last_sequence_no, event.sequence_no);
    this.log(state, {
      event_type: "VEHICLE_CLEARED",
      direction: event.direction,
      vehicle_id: event.vehicle_id,
      message: `${event.vehicle_id} left the junction (${event.source})`,
    });
    if (state.emergency.active && state.emergency.vehicle_id === event.vehicle_id) {
      state.emergency = { active: false, direction: null, vehicle_id: null, detected_at_ms: null };
      this.log(state, {
        event_type: "EMERGENCY_CLEARED",
        vehicle_id: event.vehicle_id,
        message: "Emergency vehicle cleared, returning to normal scheduling",
      });
    }
  }

  // ------------------------------------------------------------------ snapshot

  private snapshot(state: JunctionState): JunctionStatus {
    const alerts: JunctionStatus["alerts"] = [];
    if (state.controller !== "ONLINE") {
      alerts.push({
        code: "CONTROLLER_OFFLINE",
        severity: "CRITICAL",
        message: "Junction controller is offline; commands cannot be confirmed.",
      });
    }
    if (state.sensor !== "ONLINE") {
      alerts.push({
        code: "SENSOR_OFFLINE",
        severity: "WARNING",
        message: "Vehicle sensors are offline; queues may be inaccurate.",
      });
    }
    if (state.signals_faulted) {
      alerts.push({
        code: "SIGNAL_FAILURE",
        severity: "CRITICAL",
        message: "A signal head reported a hardware failure.",
      });
    }
    if (state.pending_command) {
      alerts.push({
        code: "COMMAND_PENDING",
        severity: "INFO",
        message: `Waiting for controller to confirm ${state.pending_command.requested_state} on ${state.pending_command.direction}.`,
        direction: state.pending_command.direction,
      });
    }
    const mismatches = DIRECTIONS.filter(
      (d) => state.desired[d] !== state.actual[d],
    );
    if (mismatches.length && state.controller === "ONLINE") {
      alerts.push({
        code: "STATE_MISMATCH",
        severity: "WARNING",
        message: `Desired/actual mismatch on ${mismatches.join(", ")}.`,
        direction: mismatches[0],
      });
    }
    if (state.mode === "MANUAL") {
      alerts.push({
        code: "MANUAL_OVERRIDE",
        severity: "INFO",
        message: `Manual override active${state.manual_target ? ` targeting ${state.manual_target}` : ""}.`,
      });
    }
    if (state.mode === "EMERGENCY") {
      alerts.push({
        code: "EMERGENCY",
        severity: "CRITICAL",
        message: `Emergency preemption from ${state.emergency.direction ?? "unknown"}.`,
        direction: state.emergency.direction,
      });
    }

    return {
      junction_id: state.junction_id,
      mode: state.mode,
      phase: state.phase,
      controller_status: state.controller,
      sensor_status: state.sensor,
      desired_signals: { ...state.desired },
      actual_signals: { ...state.actual },
      queues: {
        NORTH: state.queues.NORTH.length,
        SOUTH: state.queues.SOUTH.length,
        EAST: state.queues.EAST.length,
        WEST: state.queues.WEST.length,
      },
      emergency: state.emergency.active
        ? {
            active: true,
            direction: state.emergency.direction,
            vehicle_id: state.emergency.vehicle_id,
            detected_at: state.emergency.detected_at_ms ? iso(state.emergency.detected_at_ms) : null,
          }
        : { active: false, direction: null, vehicle_id: null, detected_at: null },
      alerts,
      pending_command: state.pending_command
        ? {
            command_id: state.pending_command.command_id,
            direction: state.pending_command.direction,
            requested_state: state.pending_command.requested_state,
            issued_at: iso(state.pending_command.issued_at_ms),
            expires_at: iso(state.pending_command.deadline_ms),
          }
        : null,
      green_remaining_seconds: state.green_remaining_seconds,
      updated_at: iso(now()),
    };
  }

  // ------------------------------------------------------------------- public

  transport(): Transport {
    return {
      kind: "mock",
      listJunctions: async () => this.listJunctions(),
      getJunction: async (id) => this.getJunction(id),
      getStatus: async (id) => this.snapshot(this.require(id)),
      getHistory: async (id, query) => this.getHistory(id, query),
      sendCommand: async (id, body) => this.sendCommand(id, body),
      sendSensorEvent: async (body) => this.sendSensorEvent(body),
      sendControllerEvent: async (body) => this.sendControllerEvent(body),
      createJunction: async (body) => this.createJunction(body),
    };
  }

  listJunctions(): Junction[] {
    return [...this.junctions.values()].map((state) => this.toJunction(state));
  }

  getJunction(id: string): Junction {
    return this.toJunction(this.require(id));
  }

  getHistory(id: string, query: HistoryQuery = {}): HistoryEntry[] {
    const state = this.require(id);
    let entries = state.history;
    if (query.eventType) entries = entries.filter((e) => e.event_type === query.eventType);
    if (query.direction) entries = entries.filter((e) => e.direction === query.direction);
    if (query.limit) entries = entries.slice(0, query.limit);
    return entries;
  }

  private sendCommandInternal(id: string, body: { command: string; direction?: string; requested_state?: string }): unknown {
    const state = this.require(id);
    const command = String(body.command ?? "").toUpperCase();

    if (state.controller !== "ONLINE" && command !== "RETURN_TO_AUTOMATIC") {
      throw new ApiError("CONFLICT", "Controller is offline, manual commands are not accepted", 409);
    }

    if (command === "RETURN_TO_AUTOMATIC") {
      const previousMode = state.mode;
      state.manual_hold = false;
      state.manual_target = null;
      state.mode = previousMode === "EMERGENCY" || previousMode === "FAILURE" ? previousMode : "AUTOMATIC";
      this.log(state, {
        event_type: "RETURN_TO_AUTOMATIC",
        message: "Administrator returned the junction to automatic control",
      });
      this.log(state, {
        event_type: "MODE_CHANGED",
        previous_state: "MANUAL",
        new_state: "AUTOMATIC",
        message: "Mode moved to AUTOMATIC",
      });
      return { accepted: true, message: "Returned to automatic control", status: this.snapshot(state) };
    }

    const direction = body.direction ? (body.direction.toUpperCase() as Direction) : undefined;
    if (!direction || !DIRECTIONS.includes(direction)) {
      throw new ApiError("VALIDATION", `Command ${command} requires a valid direction`, 400);
    }

    state.manual_hold = true;
    state.manual_target = direction;
    this.log(state, {
      event_type: "MANUAL_OVERRIDE",
      direction,
      message: `Administrator requested ${command} for ${direction}`,
    });

    if (command === "MANUAL_ALL_RED_REQUEST") {
      state.phase = "ALL_RED";
      state.phase_state = "ALL_RED";
      state.phase_state_ends_at_ms = now() + ALL_RED_SECONDS * 1000;
      state.green_remaining_seconds = ALL_RED_SECONDS;
      for (const dir of DIRECTIONS) this.requestSignal(state, dir, "RED");
    } else if (command === "MANUAL_GREEN_REQUEST") {
      const target = phaseFor(direction);
      if (target !== state.phase || state.phase_state !== "GREEN") {
        state.phase_state = "ALL_RED";
        state.phase = "ALL_RED";
        state.phase_state_ends_at_ms = now() + ALL_RED_SECONDS * 1000;
        this.log(state, {
          event_type: "SIGNAL_TRANSITION_STARTED",
          previous_state: state.phase,
          new_state: "ALL_RED",
          message: `Manual request to ${direction}, clearing conflicting movements first`,
        });
        for (const dir of DIRECTIONS) this.requestSignal(state, dir, "RED");
      }
      state.green_remaining_seconds = GREEN_SECONDS;
    }

    return {
      accepted: true,
      message: `Manual request accepted for ${direction}`,
      command_id: state.pending_command?.command_id,
      status: this.snapshot(state),
    };
  }

  private sendSensorEventInternal(body: Record<string, unknown>): unknown {
    const junctionId = String(body.junction_id ?? "");
    const state = this.require(junctionId);
    const eventId = String(body.event_id ?? "");
    const direction = String(body.direction ?? "").toUpperCase() as Direction;
    const eventType = String(body.event_type ?? "").toUpperCase();
    const vehicleId = String(body.vehicle_id ?? "");
    const vehicleType = String(body.vehicle_type ?? "EMPLOYEE_VEHICLE").toUpperCase() as VehicleType;
    const sequenceNo = Number(body.sequence_no ?? state.last_sequence_no + 1);

    if (!eventId) throw new ApiError("VALIDATION", "event_id is required", 400);
    if (!DIRECTIONS.includes(direction)) {
      throw new ApiError("VALIDATION", `Unknown direction "${body.direction}"`, 400);
    }
    if (eventType !== "VEHICLE_ARRIVED" && eventType !== "VEHICLE_CLEARED") {
      throw new ApiError("VALIDATION", `Unknown event_type "${body.event_type}"`, 400);
    }
    if (!(vehicleType in VEHICLE_WEIGHT)) {
      throw new ApiError("VALIDATION", `Unknown vehicle_type "${body.vehicle_type}"`, 400);
    }
    if (state.sensor !== "ONLINE") {
      throw new ApiError("CONFLICT", "Sensors are offline, event rejected", 409);
    }

    if (state.processed_events.has(eventId)) {
      this.log(state, {
        event_type: "SENSOR_EVENT_REJECTED",
        direction,
        vehicle_id: vehicleId,
        message: `Duplicate event ${eventId} ignored`,
      });
      return {
        accepted: false,
        duplicate: true,
        event_id: eventId,
        rejected_reason: "Duplicate event_id",
        queues: this.snapshot(state).queues,
      };
    }
    state.processed_events.add(eventId);

    if (eventType === "VEHICLE_ARRIVED") {
      this.applyArrival(state, {
        event_id: eventId,
        direction,
        vehicle_id: vehicleId,
        vehicle_type: vehicleType,
        sequence_no: sequenceNo,
        timestamp: String(body.timestamp ?? iso(now())),
        source: "sensor",
      });
    } else {
      this.applyCleared(state, {
        event_id: eventId,
        direction,
        vehicle_id: vehicleId,
        sequence_no: sequenceNo,
        timestamp: String(body.timestamp ?? iso(now())),
        source: "sensor",
      });
    }
    return { accepted: true, event_id: eventId, queues: this.snapshot(state).queues };
  }

  private sendControllerEventInternal(body: Record<string, unknown>): unknown {
    const state = this.require(String(body.junction_id ?? ""));
    const commandId = String(body.command_id ?? "");
    const status = String(body.status ?? "ACK").toUpperCase();
    const deviceType = String(body.device_type ?? "SIGNAL_CONTROLLER").toUpperCase();
    const direction = body.direction ? (String(body.direction).toUpperCase() as Direction) : undefined;

    if (deviceType === "SENSOR" || status === "SENSOR_OFFLINE") {
      state.sensor = status === "OFFLINE" || status === "NACK" ? "OFFLINE" : "ONLINE";
      this.log(state, {
        event_type: state.sensor === "ONLINE" ? "DEVICE_RECOVERED" : "DEVICE_FAILURE",
        device_type: "SENSOR",
        new_state: state.sensor,
        message: `Sensor reported ${state.sensor}`,
      });
      return { accepted: true, duplicate: false };
    }

    if (deviceType === "SIGNAL" || deviceType === "SIGNAL_HEAD") {
      state.signals_faulted = status === "OFFLINE" || status === "NACK";
      this.log(state, {
        event_type: state.signals_faulted ? "DEVICE_FAILURE" : "DEVICE_RECOVERED",
        direction: direction ?? null,
        device_type: "SIGNAL",
        new_state: state.signals_faulted ? "OFFLINE" : "ONLINE",
        message: `Signal head reported ${state.signals_faulted ? "OFFLINE" : "ONLINE"}`,
      });
      return { accepted: true, duplicate: false };
    }

    if (status === "OFFLINE") {
      state.controller = "OFFLINE";
      state.pending_command = null;
      this.log(state, {
        event_type: "DEVICE_FAILURE",
        device_type: "SIGNAL_CONTROLLER",
        new_state: "OFFLINE",
        message: "Junction controller went offline",
      });
      return { accepted: true, duplicate: false };
    }

    if (status === "ONLINE" && state.controller !== "ONLINE") {
      state.controller = "ONLINE";
      this.log(state, {
        event_type: "DEVICE_RECOVERED",
        device_type: "SIGNAL_CONTROLLER",
        new_state: "ONLINE",
        message: "Junction controller reconnected",
      });
      return { accepted: true, duplicate: false };
    }

    const pending = state.pending_command;
    if (!pending || pending.command_id !== commandId) {
      this.log(state, {
        event_type: "SENSOR_EVENT_REJECTED",
        command_id: commandId,
        message: "Acknowledgement for an unknown or already completed command",
      });
      return { accepted: false, duplicate: true, reason: "No matching pending command" };
    }
    if (status === "NACK") {
      state.pending_command = null;
      this.log(state, {
        event_type: "COMMAND_FAILED",
        command_id: commandId,
        direction: pending.direction,
        message: "Controller rejected the requested state",
      });
      return { accepted: false, duplicate: false, reason: "Controller reported NACK" };
    }

    const reported = String(body.actual_state ?? pending.requested_state).toUpperCase() as SignalState;
    state.pending_command = null;
    state.actual[pending.direction] = reported;
    this.log(state, {
      event_type: "CONTROLLER_ACK",
      direction: pending.direction,
      new_state: reported,
      command_id: commandId,
      message: "Controller confirmed requested state",
    });
    this.log(state, {
      event_type: "SIGNAL_CHANGED",
      direction: pending.direction,
      new_state: reported,
      command_id: commandId,
    });
    return { accepted: true, duplicate: false };
  }

  /** Re-derives the operating mode so mode changes are visible without waiting for the next tick. */
  private refreshMode(junctionId: string): void {
    const state = this.junctions.get(junctionId);
    if (state) this.updateMode(state);
  }

  sendCommand(id: string, body: { command: string; direction?: string; requested_state?: string }): unknown {
    try {
      return this.sendCommandInternal(id, body);
    } finally {
      this.refreshMode(id);
    }
  }

  sendSensorEvent(body: Record<string, unknown>): unknown {
    const junctionId = String(body.junction_id ?? "");
    try {
      return this.sendSensorEventInternal(body);
    } finally {
      this.refreshMode(junctionId);
    }
  }

  sendControllerEvent(body: Record<string, unknown>): unknown {
    const junctionId = String(body.junction_id ?? "");
    try {
      return this.sendControllerEventInternal(body);
    } finally {
      this.refreshMode(junctionId);
    }
  }

  createJunction(body: Record<string, unknown>): unknown {
    const junctionId = String(body.junction_id ?? "").trim().toUpperCase();
    if (!junctionId) throw new ApiError("VALIDATION", "junction_id is required", 400);
    if (this.junctions.has(junctionId)) {
      throw new ApiError("CONFLICT", `Junction ${junctionId} already exists`, 409);
    }
    this.seed(junctionId, String(body.name ?? `Junction ${junctionId}`));
    return this.getJunction(junctionId);
  }

  private toJunction(state: JunctionState): Junction {
    return {
      junction_id: state.junction_id,
      name: state.name,
      directions: [...DIRECTIONS],
      phases: ["NORTH_SOUTH", "EAST_WEST"],
      green_duration_seconds: GREEN_SECONDS,
      yellow_duration_seconds: YELLOW_SECONDS,
      all_red_duration_seconds: ALL_RED_SECONDS,
    };
  }
}