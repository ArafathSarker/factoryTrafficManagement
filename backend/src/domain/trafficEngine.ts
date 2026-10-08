export type SignalState = "RED" | "YELLOW" | "GREEN";
export type Direction = "NORTH" | "SOUTH" | "EAST" | "WEST";
export type Phase = "NORTH_SOUTH" | "EAST_WEST";
export type Mode = "AUTOMATIC" | "MANUAL" | "EMERGENCY" | "DEGRADED" | "FAILURE";
export type VehicleType = "FORKLIFT" | "TRUCK" | "EMPLOYEE_VEHICLE" | "EMERGENCY";

export interface JunctionState {
    mode: Mode;
    phase: Phase;
    stateStartedAt: Date;
    nextTransitionAt: Date | null;
}

export interface PhaseSignals {
    NORTH: SignalState;
    SOUTH: SignalState;
    EAST: SignalState;
    WEST: SignalState;
}

export const GREEN_DURATION_MS = 30000;
export const YELLOW_DURATION_MS = 5000;
export const ALL_RED_DURATION_MS = 3000;

export function getSignalsForPhase(phase: Phase, state: "GREEN" | "YELLOW" | "ALL_RED"): PhaseSignals {
    const isNS = phase === "NORTH_SOUTH";
    const activeState = state === "ALL_RED" ? "RED" : state;
    return {
        NORTH: isNS ? activeState : "RED",
        SOUTH: isNS ? activeState : "RED",
        EAST: !isNS ? activeState : "RED",
        WEST: !isNS ? activeState : "RED"
    };
}

export function computeNextPhase(queues: Record<Direction, number>): Phase {
    const nsTotal = queues.NORTH + queues.SOUTH;
    const ewTotal = queues.EAST + queues.WEST;
    return nsTotal >= ewTotal ? "NORTH_SOUTH" : "EAST_WEST";
}
