import { DIRECTIONS, type Direction, type JunctionStatus, type SignalState } from "@/lib/types";
import { Badge, Card } from "./ui/primitives";
import { cx, MODE_DESCRIPTIONS, MODE_STYLES, SIGNAL_STYLES } from "./ui/theme";

function SignalHead({
  direction,
  state,
  queue,
  stale,
}: {
  direction: Direction;
  state: SignalState;
  queue: number;
  stale: boolean;
}) {
  const style = SIGNAL_STYLES[state] ?? SIGNAL_STYLES.RED;
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cx(
          "h-9 w-9 shrink-0 rounded-full border-4 border-slate-800",
          style.lamp,
          stale && "opacity-40 grayscale",
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <p className={cx("text-sm font-bold leading-tight", style.text)}>{state}</p>
        <p className="truncate text-[11px] font-medium tracking-wide text-slate-400">{direction}</p>
      </div>
      <div className="ml-auto rounded-md border border-white/10 bg-slate-950/60 px-2 py-0.5 text-[11px] text-slate-300">
        Q{queue}
      </div>
    </div>
  );
}

export function IntersectionView({
  status,
  show,
}: {
  status: JunctionStatus;
  show: "actual" | "desired";
}) {
  const signals = show === "actual" ? status.actual_signals : status.desired_signals;
  const stale = show === "actual";

  const emergencyDirection = status.emergency?.active ? status.emergency.direction : null;

  return (
    <div className="grid grid-cols-[auto_1fr_auto] grid-rows-[auto_1fr_auto] items-center gap-3 rounded-xl border border-white/10 bg-slate-950/50 p-4">
      <div className="col-start-2 row-start-1 flex justify-center">
        <SignalHead
          direction="NORTH"
          state={signals.NORTH}
          queue={status.queues.NORTH}
          stale={stale}
        />
      </div>

      <div className="col-start-1 row-start-2 flex justify-center">
        <SignalHead direction="WEST" state={signals.WEST} queue={status.queues.WEST} stale={stale} />
      </div>

      <div className="col-start-2 row-start-2 flex items-center justify-center">
        <div className="flex h-full min-h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-slate-900/80 px-4 text-center">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Junction {status.junction_id}
          </span>
          <span className="text-lg font-bold tracking-wide text-slate-100">{status.phase}</span>
          <span
            className={cx(
              "text-xs font-medium",
              status.phase === "ALL_RED" ? "text-rose-300" : "text-slate-400",
            )}
          >
            {status.phase === "ALL_RED"
              ? "All-red clearance"
              : `${Math.max(status.green_remaining_seconds ?? 0, 0)}s remaining`}
          </span>
          {emergencyDirection && (
            <span className="rounded border border-rose-500/50 bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-200">
              EMERGENCY {emergencyDirection}
            </span>
          )}
        </div>
      </div>

      <div className="col-start-3 row-start-2 flex justify-center">
        <SignalHead direction="EAST" state={signals.EAST} queue={status.queues.EAST} stale={stale} />
      </div>

      <div className="col-start-2 row-start-3 flex justify-center">
        <SignalHead
          direction="SOUTH"
          state={signals.SOUTH}
          queue={status.queues.SOUTH}
          stale={stale}
        />
      </div>
    </div>
  );
}

export function SignalStateTable({ status }: { status: JunctionStatus }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-slate-500">
          <th className="py-2 font-semibold">Direction</th>
          <th className="py-2 font-semibold">Desired</th>
          <th className="py-2 font-semibold">Actual</th>
          <th className="py-2 text-right font-semibold">Queue</th>
        </tr>
      </thead>
      <tbody>
        {DIRECTIONS.map((direction) => {
          const desired = status.desired_signals[direction];
          const actual = status.actual_signals[direction];
          const mismatch = desired !== actual;
          return (
            <tr key={direction} className="border-t border-white/5">
              <td className="py-2 font-medium text-slate-300">{direction}</td>
              <td className="py-2">
                <span className={cx("font-semibold", (SIGNAL_STYLES[desired] ?? SIGNAL_STYLES.RED).text)}>
                  {desired}
                </span>
              </td>
              <td className="py-2">
                <span className={cx("font-semibold", (SIGNAL_STYLES[actual] ?? SIGNAL_STYLES.RED).text)}>
                  {actual}
                </span>
                {mismatch && (
                  <span className="ml-2 text-[11px] font-semibold uppercase text-amber-300">
                    mismatch
                  </span>
                )}
              </td>
              <td className="py-2 text-right tabular-nums text-slate-300">
                {status.queues[direction] ?? 0}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ModePanel({ status }: { status: JunctionStatus }) {
  return (
    <Card
      title="Operating mode"
      actions={
        <Badge className={MODE_STYLES[status.mode] ?? MODE_STYLES.AUTOMATIC}>{status.mode}</Badge>
      }
    >
      <p className="text-sm text-slate-300">{MODE_DESCRIPTIONS[status.mode] ?? "Unknown mode."}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Current phase</dt>
          <dd className="font-semibold text-slate-100">{status.phase}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Phase ends in</dt>
          <dd className="font-semibold tabular-nums text-slate-100">
            {Math.max(status.green_remaining_seconds ?? 0, 0)}s
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Controller</dt>
          <dd className="font-semibold text-slate-100">{status.controller_status}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Sensors</dt>
          <dd className="font-semibold text-slate-100">{status.sensor_status ?? "UNKNOWN"}</dd>
        </div>
      </dl>
      {status.emergency?.active && (
        <div className="mt-4 rounded-lg border border-rose-500/50 bg-rose-500/10 p-3 text-sm text-rose-100">
          <p className="font-semibold">
            Emergency active from {status.emergency.direction ?? "unknown direction"}
          </p>
          {status.emergency.vehicle_id && (
            <p className="mt-0.5 text-xs opacity-80">Vehicle {status.emergency.vehicle_id}</p>
          )}
          {status.emergency.detected_at && (
            <p className="mt-0.5 text-xs opacity-80">
              Detected {new Date(status.emergency.detected_at).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export function QueueSummary({ status }: { status: JunctionStatus }) {
  const total = DIRECTIONS.reduce((sum, d) => sum + (status.queues[d] ?? 0), 0);
  const busiest = DIRECTIONS.reduce(
    (best, d) => ((status.queues[d] ?? 0) > (status.queues[best] ?? 0) ? d : best),
    DIRECTIONS[0],
  );
  return (
    <Card
      title="Queue pressure"
      subtitle={`${total} vehicles waiting · busiest approach is ${busiest}`}
    >
      <div className="space-y-2.5">
        {DIRECTIONS.map((direction) => {
          const count = status.queues[direction] ?? 0;
          const width = total > 0 ? Math.max((count / total) * 100, count > 0 ? 8 : 0) : 0;
          return (
            <div key={direction} className="flex items-center gap-3">
              <span className="w-14 text-[11px] font-semibold tracking-wide text-slate-400">
                {direction}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-sky-500/70 transition-all"
                  style={{ width: `${width}%` }}
                />
              </div>
              <span className="w-8 text-right text-sm font-semibold tabular-nums text-slate-100">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
