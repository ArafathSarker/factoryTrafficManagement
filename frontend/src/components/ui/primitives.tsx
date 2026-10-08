import type { ReactNode } from "react";

import { cx } from "./theme";

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-xl border border-white/10 bg-slate-900/70 shadow-lg shadow-black/20 backdrop-blur",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("px-4 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Badge({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Banner({
  tone,
  title,
  children,
  action,
}: {
  tone: "info" | "warning" | "critical";
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: "border-sky-500/40 bg-sky-500/10 text-sky-100",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    critical: "border-rose-500/50 bg-rose-500/10 text-rose-100",
  } as const;
  return (
    <div
      role={tone === "critical" ? "alert" : "status"}
      className={cx(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
        tones[tone],
      )}
    >
      <div>
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-[13px] opacity-90">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-400">
      {message}
    </p>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-white/5", className)} />;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "default",
  type = "button",
  title,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger" | "ghost";
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  const variants = {
    default: "border-white/15 bg-white/5 text-slate-100 hover:bg-white/10",
    primary: "border-sky-500/50 bg-sky-500/20 text-sky-100 hover:bg-sky-500/30",
    danger: "border-rose-500/50 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30",
    ghost: "border-transparent bg-transparent text-slate-300 hover:bg-white/5",
  } as const;
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500/60";