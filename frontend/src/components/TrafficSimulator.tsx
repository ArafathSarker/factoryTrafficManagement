"use client";

import { useState } from "react";

import { useAction } from "@/hooks/useTraffic";
import { apiClient } from "@/lib/api/client";
import {
  DIRECTIONS,
  VEHICLE_TYPES,
  type DeviceType,
  type Direction,
  type JunctionStatus,
  type SensorEventType,
  type SignalState,
  type VehicleType,
} from "@/lib/types";
import { Badge, Banner, Button, Card, Field, inputClass } from "./ui/primitives";

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function TrafficSimulator({
  junctionId,
  status,
}: {
  junctionId: string;
  status: JunctionStatus | null;
}) {
  const [direction, setDirection] = useState<Direction>("NORTH");
  const [eventType, setEventType] = useState<SensorEventType>("VEHICLE_ARRIVED");
  const [vehicleType, setVehicleType] = useState<VehicleType>("TRUCK");
  const [vehicleId, setVehicleId] = useState(() => randomId("VH"));
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [lastSequence, setLastSequence] = useState(1);

  const [deviceType, setDeviceType] = useState<DeviceType>("SIGNAL_CONTROLLER");
  const [deviceStatus, setDeviceStatus] = useState("OFFLINE");
  const [actualState, setActualState] = useState<SignalState>("GREEN");

  const vehicleAction = useAction();
  const deviceAction = useAction();

  async function submitVehicle(reuseEventId?: string) {
    const eventId = reuseEventId ?? randomId("evt");
    const result = await vehicleAction.run(
      () =>
        apiClient.call((transport) =>
          transport.sendSensorEvent({
            event_id: eventId,
            junction_id: junctionId,
            direction,
            event_type: eventType,
            vehicle_id: vehicleId,
            vehicle_type: vehicleType,
            sequence_no: lastSequence,
            timestamp: new Date().toISOString(),
          }),
        ) as Promise<{ accepted: boolean; duplicate?: boolean; rejected_reason?: string }>,
      (response) =>
        response.duplicate
          ? `Duplicate event ${eventId} ignored, queue unchanged`
          : `Sensor event ${eventId} accepted`,
    );
    if (result) {
      setLastEventId(eventId);
      setLastSequence((value) => value + 1);
      if (eventType === "VEHICLE_ARRIVED") setVehicleId(randomId("VH"));
    }
  }

  async function sendControllerEvent(body: Record<string, unknown>) {
    const result = await deviceAction.run(
      () =>
        apiClient.call((transport) => transport.sendControllerEvent(body)) as Promise<{
          accepted: boolean;
          duplicate?: boolean;
          reason?: string;
        }>,
      (response) =>
        response.accepted
          ? "Controller event accepted"
          : (response.reason ?? "Controller event ignored"),
    );
    return result;
  }

  return (
    <Card
      title="Traffic simulation"
      subtitle="Drive the backend without physical hardware."
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Direction">
            <select
              className={inputClass}
              value={direction}
              onChange={(event) => setDirection(event.target.value as Direction)}
            >
              {DIRECTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Event">
            <select
              className={inputClass}
              value={eventType}
              onChange={(event) => setEventType(event.target.value as SensorEventType)}
            >
              <option value="VEHICLE_ARRIVED">Vehicle arrived</option>
              <option value="VEHICLE_CLEARED">Vehicle cleared</option>
            </select>
          </Field>
          <Field label="Vehicle type">
            <select
              className={inputClass}
              value={vehicleType}
              onChange={(event) => setVehicleType(event.target.value as VehicleType)}
            >
              {VEHICLE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vehicle ID">
            <input
              className={inputClass}
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={vehicleAction.pending}
            onClick={() => void submitVehicle()}
          >
            Send sensor event
          </Button>
          <Button
            disabled={vehicleAction.pending || !lastEventId}
            title="Resend the exact same event_id to prove idempotency"
            onClick={() => void submitVehicle(lastEventId ?? undefined)}
          >
            Resend duplicate event
          </Button>
          <Button
            disabled={vehicleAction.pending}
            onClick={() => {
              setVehicleType("EMERGENCY");
              setEventType("VEHICLE_ARRIVED");
              setVehicleId(randomId("VH"));
            }}
          >
            Prepare emergency vehicle
          </Button>
        </div>

        {vehicleAction.error && (
          <Banner tone="warning" title="Sensor event rejected">
            {vehicleAction.error}
          </Banner>
        )}
        {vehicleAction.notice && !vehicleAction.error && (
          <Banner tone="info" title={vehicleAction.notice} />
        )}

        <div className="border-t border-white/10 pt-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Controller & device events
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Device">
              <select
                className={inputClass}
                value={deviceType}
                onChange={(event) => setDeviceType(event.target.value as DeviceType)}
              >
                <option value="SIGNAL_CONTROLLER">Signal controller</option>
                <option value="SIGNAL">Signal head</option>
                <option value="SENSOR">Sensor</option>
              </select>
            </Field>
            <Field label="Status">
              <select
                className={inputClass}
                value={deviceStatus}
                onChange={(event) => setDeviceStatus(event.target.value)}
              >
                <option value="ONLINE">ONLINE</option>
                <option value="OFFLINE">OFFLINE</option>
                <option value="DEGRADED">DEGRADED</option>
              </select>
            </Field>
            <Field label="Reported signal state">
              <select
                className={inputClass}
                value={actualState}
                onChange={(event) => setActualState(event.target.value as SignalState)}
              >
                <option value="GREEN">GREEN</option>
                <option value="YELLOW">YELLOW</option>
                <option value="RED">RED</option>
              </select>
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={deviceAction.pending}
              onClick={() =>
                void sendControllerEvent({
                  junction_id: junctionId,
                  device_type: deviceType,
                  direction,
                  status: deviceStatus,
                  actual_state: actualState,
                })
              }
            >
              Report device status
            </Button>
            <Button
              variant="primary"
              disabled={deviceAction.pending || !status?.pending_command}
              title={
                status?.pending_command
                  ? `Acknowledge ${status.pending_command.command_id}`
                  : "No pending command to acknowledge"
              }
              onClick={() => {
                const pending = status?.pending_command;
                if (!pending) return;
                void sendControllerEvent({
                  command_id: pending.command_id,
                  junction_id: junctionId,
                  status: "ACK",
                  direction: pending.direction ?? direction,
                  actual_state: pending.requested_state ?? actualState,
                });
              }}
            >
              Acknowledge pending command
            </Button>
            <Button
              variant="danger"
              disabled={deviceAction.pending || !status?.pending_command}
              onClick={() => {
                const pending = status?.pending_command;
                if (!pending) return;
                void sendControllerEvent({
                  command_id: pending.command_id,
                  junction_id: junctionId,
                  status: "NACK",
                  direction: pending.direction ?? direction,
                });
              }}
            >
              Reject pending command
            </Button>
          </div>

          {deviceAction.error && (
            <div className="mt-3">
              <Banner tone="warning" title="Controller event rejected">
                {deviceAction.error}
              </Banner>
            </div>
          )}

          {status?.pending_command && (
            <p className="mt-3 text-xs text-slate-400">
              Waiting on{" "}
              <span className="font-mono text-slate-200">{status.pending_command.command_id}</span>{" "}
              for {status.pending_command.direction} →{" "}
              {status.pending_command.requested_state}.
            </p>
          )}
        </div>

        <p className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <Badge className="border-white/10 bg-white/5 text-slate-400">Tip</Badge>
          Resending a duplicate event_id must not change queue counts.
        </p>
      </div>
    </Card>
  );
}