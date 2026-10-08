import type { ActiveAlert, JunctionStatus } from "@/lib/types";
import { Badge, Card, EmptyState } from "./ui/primitives";
import { cx, DEVICE_STYLES } from "./ui/theme";

function derivedAlerts(status: JunctionStatus): ActiveAlert[] {
  const alerts: ActiveAlert[] = [...(status.alerts ?? [])];
  const mismatched = (Object.keys(status.actual_signals) as Array<keyof typeof status.actual_signals>)
    .filter((direction) => status.desired_signals[direction] !== status.actual_signals[direction])
    .map((direction) => direction as string);
  if (mismatched.length && !alerts.some((a) => a.code === "STATE_MISMATCH")) {
    alerts.push({
      code: "STATE_MISMATCH",
      severity: "WARNING",
      message: `Desired state differs from controller-confirmed state on ${mismatched.join(", ")}.`,
      direction: mismatched[0] as ActiveAlert["direction"],
    });
  }
  return alerts;
}

export function AlertsPanel({ status }: { status: JunctionStatus }) {
  const alerts = derivedAlerts(status);
  const severityStyles = {
    CRITICAL: "border-rose-500/50 bg-rose-500/10 text-rose-100",
    WARNING: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    INFO: "border-sky-500/40 bg-sky-500/10 text-sky-100",
  } as const;

  return (
    <Card
      title="Active alerts"
      actions={
        <Badge className={DEVICE_STYLES[status.controller_status] ?? DEVICE_STYLES.UNKNOWN}>
          Controller {status.controller_status}
        </Badge>
      }
    >
      {alerts.length === 0 ? (
        <EmptyState message="No active alerts. All devices are reporting normally." />
      ) : (
        <ul className="space-y-2">
          {alerts.map((alert, index) => (
            <li
              key={`${alert.code}-${index}`}
              className={cx(
                "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm",
                severityStyles[alert.severity] ?? severityStyles.INFO,
              )}
            >
              <span>
                <span className="font-semibold">{alert.code}</span>
                {alert.direction ? (
                  <span className="ml-2 text-[11px] font-semibold uppercase">{alert.direction}</span>
                ) : null}
                <span className="ml-2 opacity-90">{alert.message}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {status.pending_command && (
        <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/60 p-3 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Pending controller command
          </p>
          <p className="mt-1 font-mono text-xs text-slate-200">
            {status.pending_command.command_id}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Requested {status.pending_command.requested_state ?? "?"} on{" "}
            {status.pending_command.direction ?? "?"} · issued{" "}
            {status.pending_command.issued_at
              ? new Date(status.pending_command.issued_at).toLocaleTimeString()
              : "unknown"}
            {status.pending_command.expires_at
              ? ` · expires ${new Date(status.pending_command.expires_at).toLocaleTimeString()}`
              : ""}
          </p>
        </div>
      )}
    </Card>
  );
}