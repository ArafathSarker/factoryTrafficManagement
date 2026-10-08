export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8080/api";

export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE ?? "auto";

export const POLL_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? 1000);

export const HISTORY_POLL_INTERVAL_MS = Number(
  process.env.NEXT_PUBLIC_HISTORY_POLL_INTERVAL_MS ?? 2000,
);

export const REQUEST_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_REQUEST_TIMEOUT_MS ?? 8000);