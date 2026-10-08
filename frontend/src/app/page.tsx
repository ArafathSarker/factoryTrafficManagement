"use client";

import Link from "next/link";

import { AlertsPanel } from "@/components/AlertsPanel";
import { HistoryFeed } from "@/components/HistoryFeed";
import {
  IntersectionView,
  ModePanel,
  QueueSummary,
  SignalStateTable,
} from "@/components/Intersection";
import { Banner, Card, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useApiSource, useHistory, useJunctionStatus, useJunctions } from "@/hooks/useTraffic";
import { API_BASE_URL } from "@/lib/config";
import type { HistoryEventType } from "@/lib/types";
import { cx } from "@/components/ui/theme";
import { useState } from "react";

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cx(
        "inline-block h-2 w-2 rounded-full",
        ok ? "bg-emerald-400" : "bg-rose-500 animate-pulse",
      )}
    />
  );
}

export default function DashboardPage() {
  const source = useApiSource();
  const junctions = useJunctions();
  const [junctionId, setJunctionId] = useState<string | null>(null);
  const [show, setShow] = useState<"actual" | "desired">("actual");
  const [filter, setFilter] = useState<HistoryEventType | "ALL">("ALL");

  const activeId = junctionId ?? junctions.data?.[0]?.junction_id ?? null;
  const status = useJunctionStatus(activeId);
  const history = useHistory(activeId, { limit: 60, eventType: filter === "ALL" ? undefined : filter });

  const simulated = source === "mock";

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-50">
            Factory Traffic Management
          </h1>
          <p className="text-xs text-slate-400">
            Live view of junction signals, queues and controller health.{" "}
            {status.lastUpdated && `Updated ${new Date(status.lastUpdated).toLocaleTimeString()}`}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={cx(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-semibold",
              simulated
                ? "border-violet-500/40 bg-violet-500/15 text-violet-200"
                : "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
            )}
          >
            <StatusDot ok />
            {simulated ? "Simulated backend" : `Live · ${API_BASE_URL}`}
          </span>
        </div>
      </header>

      {simulated && (
        <Banner
          tone="warning"
          title="Showing simulated data"
          action={
            <button
              onClick={() => window.location.reload()}
              className="rounded border border-white/20 px-2 py-1 text-[11px] font-semibold hover:bg-white/10"
            >
              Reconnect
            </button>
          }
        >
          The backend at <span className="font-mono">{API_BASE_URL}</span> could not be reached, so
          the dashboard fell back to its built-in simulator. Restart the backend to switch back.
        </Banner>
      )}

      {(junctions.error || status.error) && (
        <Banner tone="critical" title="Dashboard data is unavailable">
          {junctions.error ?? status.error}
        </Banner>
      )}

      <nav className="flex flex-wrap gap-2">
        {(junctions.data ?? []).map((junction) => (
          <button
            key={junction.junction_id}
            onClick={() => setJunctionId(junction.junction_id)}
            className={cx(
              "rounded-lg border px-3 py-2 text-xs font-semibold transition",
              junction.junction_id === activeId
                ? "border-sky-500/50 bg-sky-500/15 text-sky-100"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
            )}
          >
            Junction {junction.junction_id}
            {junction.name ? ` · ${junction.name}` : ""}
          </button>
        ))}
        {junctions.loading && !junctions.data && <Skeleton className="h-9 w-40" />}
      </nav>

      {junctions.data && junctions.data.length === 0 && (
        <EmptyState message="No junctions are registered on the backend yet." />
      )}

      {status.data && activeId && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card
              title={`Junction ${activeId}`}
              subtitle={show === "actual" ? "Controller-confirmed signal state" : "State the backend wants"}
              actions={
                <div className="flex gap-1 rounded-lg border border-white/10 p-0.5">
                  {(["actual", "desired"] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() => setShow(value)}
                      className={cx(
                        "rounded px-2 py-1 text-[11px] font-semibold capitalize",
                        show === value ? "bg-white/10 text-slate-100" : "text-slate-400",
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              }
            >
              <IntersectionView status={status.data} show={show} />
              <div className="mt-4">
                <SignalStateTable status={status.data} />
              </div>
              <div className="mt-4 flex gap-2">
                <Link
                  href={`/junctions/${activeId}`}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-white/10"
                >
                  Open junction detail
                </Link>
              </div>
            </Card>
            <HistoryFeed
              entries={history.data ?? []}
              loading={history.loading}
              error={history.error}
              filter={filter}
              onFilterChange={setFilter}
            />
          </div>
          <div className="space-y-4">
            <ModePanel status={status.data} />
            <QueueSummary status={status.data} />
            <AlertsPanel status={status.data} />
          </div>
        </div>
      )}

      {status.loading && !status.data && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Skeleton className="h-80" />
          <Skeleton className="h-64" />
        </div>
      )}
    </main>
  );
}