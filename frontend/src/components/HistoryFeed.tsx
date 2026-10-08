"use client";

import { HISTORY_EVENT_TYPES, type HistoryEntry, type HistoryEventType } from "@/lib/types";
import { Badge, Card, EmptyState, Skeleton, inputClass } from "./ui/primitives";
import { cx } from "./ui/theme";

const TONE_BY_EVENT: Record<string, string> = {
  EMERGENCY_DETECTED: "text-rose-300",
  EMERGENCY_CLEARED: "text-rose-300",
  CONTROLLER_TIMEOUT: "text-amber-300",
  COMMAND_FAILED: "text-amber-300",
  DEVICE_FAILURE: "text-rose-300",
  SENSOR_EVENT_REJECTED: "text-amber-300",
  MANUAL_OVERRIDE: "text-violet-300",
  RETURN_TO_AUTOMATIC: "text-violet-300",
  SIGNAL_CHANGED: "text-emerald-300",
  SIGNAL_STATE_REQUESTED: "text-sky-300",
  CONTROLLER_ACK: "text-emerald-300",
};

export function HistoryFeed({
  entries,
  loading,
  error,
  filter,
  onFilterChange,
}: {
  entries: HistoryEntry[];
  loading: boolean;
  error: string | null;
  filter: HistoryEventType | "ALL";
  onFilterChange: (value: HistoryEventType | "ALL") => void;
}) {
  return (
    <Card
      title="Recent activity"
      subtitle="Audit trail reported by the backend"
      actions={
        <select
          className={cx(inputClass, "w-auto py-1 text-xs")}
          value={filter}
          onChange={(event) => onFilterChange(event.target.value as HistoryEventType | "ALL")}
          aria-label="Filter activity by event type"
        >
          <option value="ALL">All events</option>
          {HISTORY_EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      }
      bodyClassName="px-2 py-2"
    >
      {error && (
        <p className="mx-2 mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          History unavailable: {error}
        </p>
      )}
      {loading && entries.length === 0 ? (
        <div className="space-y-2 p-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState message="No activity recorded yet." />
      ) : (
        <ol className="max-h-96 space-y-0.5 overflow-y-auto pr-1">
          {entries.map((entry, index) => (
            <li
              key={`${entry.timestamp}-${index}`}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded px-2 py-1.5 text-xs hover:bg-white/5"
            >
              <span className="font-mono text-[11px] tabular-nums text-slate-500">
                {formatTime(entry.timestamp)}
              </span>
              <Badge
                className="border-white/10 bg-white/5 text-slate-200"
                title={entry.event_type}
              >
                <span className={cx(TONE_BY_EVENT[entry.event_type] ?? "text-slate-300")}>
                  {entry.event_type}
                </span>
              </Badge>
              {entry.direction && (
                <span className="font-semibold text-slate-300">{entry.direction}</span>
              )}
              {entry.previous_state && entry.new_state ? (
                <span className="text-slate-400">
                  {entry.previous_state} → {entry.new_state}
                </span>
              ) : entry.new_state ? (
                <span className="text-slate-400">{entry.new_state}</span>
              ) : null}
              {entry.vehicle_id && (
                <span className="font-mono text-[11px] text-slate-500">{entry.vehicle_id}</span>
              )}
              {entry.message && (
                <span className="w-full text-[11px] text-slate-500 sm:w-auto">{entry.message}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], { hour12: false });
}