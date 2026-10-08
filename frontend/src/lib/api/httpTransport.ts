import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "../config";
import {
  DIRECTIONS,
  type ActiveAlert,
  type Direction,
  type HistoryEntry,
  type Junction,
  type JunctionStatus,
  type SignalState,
} from "../types";
import { ApiError, type Transport } from "./errors";

export interface HttpTransportOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

export function createHttpTransport(options: HttpTransportOptions = {}): Transport {
  const baseUrl = (options.baseUrl ?? API_BASE_URL).replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const doFetch = options.fetcher ?? fetch;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...init?.headers },
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new ApiError(
        aborted ? "TIMEOUT" : "NETWORK",
        aborted
          ? `Request to ${path} timed out after ${timeoutMs}ms`
          : `Could not reach ${baseUrl}`,
        undefined,
        error,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    let payload: unknown = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        if (response.ok) {
          throw new ApiError("MALFORMED", "Response was not valid JSON", response.status, raw);
        }
      }
    }

    if (!response.ok) {
      throw toApiError(response.status, payload, path);
    }
    return payload as T;
  }

  return {
    kind: "live",
    listJunctions: async () => {
      const payload = await request<unknown>("/junctions");
      const list = extractList(payload);
      return list.map(normalizeJunction);
    },
    getJunction: async (id) =>
      normalizeJunction((await request<unknown>(`/junctions/${id}`)) as Record<string, unknown>),
    getStatus: async (id) => normalizeStatus(await request<unknown>(`/junctions/${id}/status`)),
    getHistory: async (id, query) => {
      const params = new URLSearchParams();
      if (query?.limit) params.set("limit", String(query.limit));
      if (query?.eventType) params.set("event_type", query.eventType);
      if (query?.direction) params.set("direction", query.direction);
      const qs = params.toString();
      const payload = await request<unknown>(`/junctions/${id}/history${qs ? `?${qs}` : ""}`);
      return extractList(payload).map(normalizeHistoryEntry);
    },
    sendCommand: (id, body) => request(`/junctions/${id}/commands`, { method: "POST", body: JSON.stringify(body) }),
    sendSensorEvent: (body) => request("/sensor-events", { method: "POST", body: JSON.stringify(body) }),
    sendControllerEvent: (body) =>
      request("/controller-events", { method: "POST", body: JSON.stringify(body) }),
    createJunction: (body) => request("/junctions", { method: "POST", body: JSON.stringify(body) }),
  };
}

function toApiError(status: number, payload: unknown, path: string): ApiError {
  const message =
    extractMessage(payload) ??
    (status >= 500 ? `Backend error while calling ${path}` : `Request to ${path} failed`);
  if (status === 404) return new ApiError("NOT_FOUND", message, status, payload);
  if (status === 409) return new ApiError("CONFLICT", message, status, payload);
  if (status === 400 || status === 422) return new ApiError("VALIDATION", message, status, payload);
  return new ApiError("SERVER", message, status, payload);
}

function extractMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ["error", "message", "detail", "reason"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function extractList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["data", "items", "results", "junctions", "history", "events"]) {
      const value = record[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
  }
  throw new ApiError("MALFORMED", "Expected a list from the backend");
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function pickRecord(
  record: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

function pickArray(record: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function pickDirection(value: unknown): Direction | undefined {
  return DIRECTIONS.includes(value as Direction) ? (value as Direction) : undefined;
}

export function normalizeJunction(raw: Record<string, unknown>): Junction {
  const id =
    pickString(raw, ["junction_id", "id", "junctionId"]) ??
    (() => {
      throw new ApiError("MALFORMED", "Junction payload is missing an id");
    })();
  return {
    junction_id: id,
    name: pickString(raw, ["name", "display_name", "displayName"]),
    directions: pickArray(raw, ["directions"])?.filter(Boolean) as Direction[] | undefined,
    phases: pickArray(raw, ["phases"]) as Junction["phases"],
    green_duration_seconds: pickNumber(raw, ["green_duration_seconds", "greenDurationSeconds"]),
    yellow_duration_seconds: pickNumber(raw, ["yellow_duration_seconds", "yellowDurationSeconds"]),
    all_red_duration_seconds: pickNumber(raw, ["all_red_duration_seconds", "allRedDurationSeconds"]),
  };
}

function normalizeSignalMap(raw: Record<string, unknown> | undefined): Record<Direction, SignalState> {
  const result = {} as Record<Direction, SignalState>;
  const source = raw ?? {};
  for (const direction of DIRECTIONS) {
    const value = source[direction] ?? source[direction.toLowerCase()];
    result[direction] = (typeof value === "string" ? value.toUpperCase() : "RED") as SignalState;
  }
  return result;
}

function normalizeQueueMap(raw: Record<string, unknown> | undefined): Record<Direction, number> {
  const result = {} as Record<Direction, number>;
  const source = raw ?? {};
  for (const direction of DIRECTIONS) {
    const value = Number(source[direction] ?? source[direction.toLowerCase()] ?? 0);
    result[direction] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return result;
}

export function normalizeStatus(raw: unknown): JunctionStatus {
  if (!raw || typeof raw !== "object") {
    throw new ApiError("MALFORMED", "Junction status payload was empty");
  }
  const record = raw as Record<string, unknown>;
  const emergencyRaw = pickRecord(record, ["emergency"]) ?? undefined;
  const alertsRaw = pickArray(record, ["alerts", "active_alerts", "activeAlerts"]) ?? [];
  const pendingRaw = pickRecord(record, ["pending_command", "pendingCommand"]) ?? undefined;

  return {
    junction_id:
      pickString(record, ["junction_id", "junctionId", "id"]) ?? "UNKNOWN",
    mode: (pickString(record, ["mode"]) ?? "AUTOMATIC").toUpperCase() as JunctionStatus["mode"],
    phase: (pickString(record, ["phase"]) ?? "ALL_RED").toUpperCase() as JunctionStatus["phase"],
    controller_status: (
      pickString(record, ["controller_status", "controllerStatus"]) ?? "UNKNOWN"
    ).toUpperCase() as JunctionStatus["controller_status"],
    sensor_status: (
      pickString(record, ["sensor_status", "sensorStatus"]) ?? undefined
    )?.toUpperCase() as JunctionStatus["sensor_status"],
    desired_signals: normalizeSignalMap(pickRecord(record, ["desired_signals", "desiredSignals"])),
    actual_signals: normalizeSignalMap(pickRecord(record, ["actual_signals", "actualSignals"])),
    queues: normalizeQueueMap(pickRecord(record, ["queues"])),
    emergency: emergencyRaw
      ? {
          active: Boolean(emergencyRaw.active ?? emergencyRaw.is_active ?? true),
          direction: pickDirection(emergencyRaw.direction) ?? null,
          vehicle_id: pickString(emergencyRaw, ["vehicle_id", "vehicleId"]) ?? null,
          detected_at: pickString(emergencyRaw, ["detected_at", "detectedAt"]) ?? null,
        }
      : null,
    alerts: alertsRaw.map((entry) => normalizeAlert(entry)),
    pending_command: pendingRaw
      ? {
          command_id: pickString(pendingRaw, ["command_id", "commandId"]) ?? "",
          direction: pickDirection(pendingRaw.direction) ?? null,
          requested_state: (pickString(pendingRaw, ["requested_state", "requestedState"]) ??
            null) as SignalState | null,
          issued_at: pickString(pendingRaw, ["issued_at", "issuedAt"]) ?? undefined,
          expires_at: pickString(pendingRaw, ["expires_at", "expiresAt"]) ?? null,
        }
      : null,
    green_remaining_seconds: pickNumber(record, [
      "green_remaining_seconds",
      "greenRemainingSeconds",
    ]) as number | null,
    updated_at: pickString(record, ["updated_at", "updatedAt"]) ?? null,
  };
}

function normalizeAlert(raw: unknown): ActiveAlert {
  if (typeof raw === "string") {
    return { code: "ALERT", severity: "WARNING", message: raw };
  }
  if (!raw || typeof raw !== "object") {
    return { code: "ALERT", severity: "WARNING", message: "Unreadable alert" };
  }
  const record = raw as Record<string, unknown>;
  const severity = (pickString(record, ["severity", "level"]) ?? "WARNING").toUpperCase();
  return {
    code: pickString(record, ["code", "type"]) ?? "ALERT",
    severity:
      severity === "CRITICAL" || severity === "ERROR"
        ? "CRITICAL"
        : severity === "INFO"
          ? "INFO"
          : "WARNING",
    message: pickString(record, ["message", "detail"]) ?? "Unspecified alert",
    direction: pickDirection(record.direction) ?? null,
    device_type: (pickString(record, ["device_type", "deviceType"]) ??
      null) as ActiveAlert["device_type"],
    since: pickString(record, ["since", "created_at"]) ?? null,
  };
}

export function normalizeHistoryEntry(raw: Record<string, unknown>): HistoryEntry {
  return {
    id: (raw.id as string | number | undefined) ?? undefined,
    junction_id: pickString(raw, ["junction_id", "junctionId"]) ?? "UNKNOWN",
    event_type: pickString(raw, ["event_type", "eventType", "type"]) ?? "UNKNOWN",
    direction: pickDirection(raw.direction) ?? null,
    previous_state: pickString(raw, ["previous_state", "previousState"]) ?? null,
    new_state: pickString(raw, ["new_state", "newState"]) ?? null,
    command_id: pickString(raw, ["command_id", "commandId"]) ?? null,
    message: pickString(raw, ["message", "detail", "reason"]) ?? null,
    vehicle_id: pickString(raw, ["vehicle_id", "vehicleId"]) ?? null,
    timestamp: pickString(raw, ["timestamp", "created_at", "occurred_at"]) ?? new Date().toISOString(),
  };
}