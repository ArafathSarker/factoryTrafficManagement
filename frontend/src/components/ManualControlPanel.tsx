"use client";

import { useState } from "react";

import { useAction } from "@/hooks/useTraffic";
import { apiClient } from "@/lib/api/client";
import { DIRECTIONS, type Direction, type JunctionStatus } from "@/lib/types";
import { Banner, Button, Card, Field, inputClass } from "./ui/primitives";
import { cx, MODE_STYLES } from "./ui/theme";

export function ManualControlPanel({
  junctionId,
  status,
}: {
  junctionId: string;
  status: JunctionStatus | null;
}) {
  const [direction, setDirection] = useState<Direction>("NORTH");
  const [duration, setDuration] = useState("15");
  const action = useAction();

  const offline = status ? status.controller_status !== "ONLINE" : false;
  const isManual = status?.mode === "MANUAL";

  async function send(command: string, extra: Record<string, unknown> = {}) {
    await action.run(
      () =>
        apiClient.call((transport) =>
          transport.sendCommand(junctionId, { command, ...extra }),
        ),
      `Command ${command} accepted by the backend`,
    );
  }

  return (
    <Card
      title="Manual control"
      subtitle="Requests are executed by the backend through its safe-transition logic."
      actions={
        isManual ? (
          <span
            className={cx(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
              MODE_STYLES.MANUAL,
            )}
          >
            Override active
          </span>
        ) : null
      }
    >
      <div className="space-y-4">
        {offline && (
          <Banner tone="critical" title="Controller offline">
            Manual signal requests are rejected while the junction controller cannot be reached.
          </Banner>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Approach">
            <select
              className={inputClass}
              value={direction}
              onChange={(event) => setDirection(event.target.value as Direction)}
              disabled={action.pending || offline}
            >
              {DIRECTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hold green for (s)" hint="Informational: the backend owns timing.">
            <input
              className={inputClass}
              type="number"
              min={5}
              max={120}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              disabled={action.pending}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={action.pending || offline}
            onClick={() => void send("MANUAL_GREEN_REQUEST", { direction })}
          >
            Request {direction} green
          </Button>
          <Button
            disabled={action.pending || offline}
            onClick={() => void send("MANUAL_YELLOW_REQUEST", { direction })}
          >
            Hold yellow
          </Button>
          <Button
            variant="danger"
            disabled={action.pending || offline}
            onClick={() => void send("MANUAL_ALL_RED_REQUEST")}
          >
            All red
          </Button>
          <Button
            variant="ghost"
            disabled={action.pending}
            onClick={() => void send("RETURN_TO_AUTOMATIC")}
          >
            Return to automatic
          </Button>
        </div>

        {action.error && (
          <Banner tone="warning" title="Command rejected">
            {action.error}
          </Banner>
        )}
        {action.notice && (
          <Banner tone="info" title={action.notice}>
            Watch the intersection view: the backend decides the real transition sequence.
          </Banner>
        )}
      </div>
    </Card>
  );
}