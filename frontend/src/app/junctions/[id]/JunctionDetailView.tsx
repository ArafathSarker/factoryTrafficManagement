"use client";

import Link from "next/link";
import { useState } from "react";

import { AlertsPanel } from "@/components/AlertsPanel";
import { HistoryFeed } from "@/components/HistoryFeed";
import {
  IntersectionView,
  ModePanel,
  QueueSummary,
  SignalStateTable,
} from "@/components/Intersection";
import { ManualControlPanel } from "@/components/ManualControlPanel";
import { TrafficSimulator } from "@/components/TrafficSimulator";
import { Badge, Banner, Card, EmptyState, Skeleton } from "@/components/ui/primitives";
import { cx, DEVICE_STYLES, MODE_STYLES } from "@/components/ui/theme";
import { useApiSource, useHistory, useJunctionStatus } from "@/hooks/useTraffic";
import { API_BASE_URL } from "@/lib/config";
import type { HistoryEventType } from "@/lib/types";

export function JunctionDetailView({ junctionId }: { junctionId: string }) {
  const source = useApiSource();
  const status = useJunctionStatus(junctionId);
  const [show, setShow] = useState<"actual" | "desired">("actual");
  const [filter, setFilter] = useState<HistoryEventType | "ALL">("ALL");
  const history = useHistory(junctionId, {
    limit: 80,
    eventType: filter === "ALL" ? undefined : filter,
  });

  const simulated = source === "mock";

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-xs font-semibold text-sky-300 hover:underline">
            ← All junctions
          </Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-50">
            Junction {junctionId}
          </h1>
        </div>
        {status.data && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={MODE_STYLES[status.data.mode] ?? MODE_STYLES.AUTOMATIC}>
              {status.data.mode}
            </Badge>
            <Badge
              className={DEVICE_STYLES[status.data.controller_status] ?? DEVICE_STYLES.UNKNOWN}
            >
              Controller {status.data.controller_status}
            </Badge>
            <Badge
              className={
                simulated
                  ? "border-violet-500/40 bg-violet-500/15 text-violet-200"
                  : "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
              }
            >
              {simulated ? "Simulated backend" : `Live · ${API_BASE_URL}`}
            </Badge>
          </div>
        )}
      </header>

      {status.error && (
        <Banner tone="critical" title={`Cannot read junction ${junctionId}`}>
          {status.error} The dashboard keeps running and recovers automatically once the backend
          responds again.
        </Banner>
      )}

      {status.loading && !status.data && <Skeleton className="h-96" />}

      {!status.loading && !status.data && !status.error && (
        <EmptyState message={`No data returned for junction ${junctionId}.`} />
      )}

      {status.data && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card
              title="Signal state"
              subtitle={
                show === "actual"
                  ? "Actual state confirmed by the physical controller"
                  : "Desired state requested by the backend"
              }
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
            </Card>

            <ManualControlPanel junctionId={junctionId} status={status.data} />
            <TrafficSimulator junctionId={junctionId} status={status.data} />
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
            <Card title="Safety invariants" subtitle="Enforced by the backend domain engine">
              <ul className="space-y-2 text-xs text-slate-300">
                <li>• Conflicting phases never hold GREEN together.</li>
                <li>• Every change passes through YELLOW and ALL RED.</li>
                <li>• Manual and emergency requests use the same transition path.</li>
                <li>• A requested state is not shown as confirmed until the controller ACKs.</li>
              </ul>
            </Card>
          </div>
        </div>
      )}
    </main>
  );
}