import type { HistoryEntry, HistoryQuery, Junction, JunctionStatus } from "../types";

export type ApiErrorKind =
  | "NETWORK"
  | "TIMEOUT"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "SERVER"
  | "MALFORMED";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly details?: unknown;

  constructor(kind: ApiErrorKind, message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.details = details;
  }

  get isRetryable(): boolean {
    return this.kind === "NETWORK" || this.kind === "TIMEOUT" || this.kind === "SERVER";
  }
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case "NETWORK":
        return "Cannot reach the backend. Is it running?";
      case "TIMEOUT":
        return "The backend did not respond in time.";
      case "NOT_FOUND":
        return error.message || "Not found.";
      case "VALIDATION":
        return error.message || "The request was rejected as invalid.";
      case "CONFLICT":
        return error.message || "The request conflicts with the current junction state.";
      case "MALFORMED":
        return "The backend returned data the dashboard could not understand.";
      default:
        return error.message || "Unexpected backend error.";
    }
  }
  if (error instanceof Error) return error.message;
  return "Unknown error.";
}

export interface Transport {
  readonly kind: "live" | "mock";
  listJunctions(): Promise<Junction[]>;
  getJunction(id: string): Promise<Junction>;
  getStatus(id: string): Promise<JunctionStatus>;
  getHistory(id: string, query?: HistoryQuery): Promise<HistoryEntry[]>;
  sendCommand(
    id: string,
    body: { command: string; direction?: string; requested_state?: string },
  ): Promise<unknown>;
  sendSensorEvent(body: Record<string, unknown>): Promise<unknown>;
  sendControllerEvent(body: Record<string, unknown>): Promise<unknown>;
  createJunction(body: Record<string, unknown>): Promise<unknown>;
}