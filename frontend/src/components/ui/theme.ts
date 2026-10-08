import type { DeviceStatus, Mode, SignalState } from "@/lib/types";

export const SIGNAL_STYLES: Record<SignalState, { lamp: string; text: string; ring: string }> = {
  GREEN: {
    lamp: "bg-emerald-500 shadow-[0_0_18px_rgba(16,185,129,0.85)]",
    text: "text-emerald-300",
    ring: "border-emerald-500/60",
  },
  YELLOW: {
    lamp: "bg-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.85)]",
    text: "text-amber-300",
    ring: "border-amber-400/60",
  },
  RED: {
    lamp: "bg-rose-600 shadow-[0_0_18px_rgba(225,29,72,0.7)]",
    text: "text-rose-300",
    ring: "border-rose-600/50",
  },
  ALL_RED: {
    lamp: "bg-rose-600",
    text: "text-rose-300",
    ring: "border-rose-600/50",
  },
};

export const MODE_STYLES: Record<string, string> = {
  AUTOMATIC: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  MANUAL: "bg-violet-500/15 text-violet-300 border-violet-500/40",
  EMERGENCY: "bg-rose-500/20 text-rose-200 border-rose-500/60 animate-pulse",
  FAILURE: "bg-amber-500/20 text-amber-200 border-amber-500/60",
  DEGRADED: "bg-amber-500/15 text-amber-200 border-amber-500/40",
};

export const DEVICE_STYLES: Record<DeviceStatus, string> = {
  ONLINE: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  OFFLINE: "bg-rose-500/15 text-rose-300 border-rose-500/40",
  DEGRADED: "bg-amber-500/15 text-amber-200 border-amber-500/40",
  WARNING: "bg-amber-500/15 text-amber-200 border-amber-500/40",
  UNKNOWN: "bg-slate-500/15 text-slate-300 border-slate-500/40",
};

export const MODE_DESCRIPTIONS: Record<Mode, string> = {
  AUTOMATIC: "Scheduler picks the next phase from live queue demand.",
  MANUAL: "Administrator override. Safe transitions still apply.",
  EMERGENCY: "Emergency vehicle is preempting traffic through a safe transition.",
  FAILURE: "A device is unavailable. Signals are held in the safest known state.",
  DEGRADED: "Running with reduced capability.",
};

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}