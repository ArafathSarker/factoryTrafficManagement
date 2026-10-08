"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { apiClient, type ApiSource } from "../lib/api/client";
import { describeError } from "../lib/api/errors";
import {
  HISTORY_POLL_INTERVAL_MS,
  POLL_INTERVAL_MS,
} from "../lib/config";
import type { HistoryEntry, HistoryQuery, Junction, JunctionStatus } from "../lib/types";

export function useApiSource(): ApiSource {
  return useSyncExternalStore(
    useCallback((listener) => apiClient.subscribe(listener), []),
    useCallback(() => apiClient.getSource(), []),
    useCallback(() => "live" as ApiSource, []),
  );
}

interface PollState<T> {
  data: T | null;
  error: string | null;
  /** True only for the very first load; later failures keep the last good data. */
  loading: boolean;
  stale: boolean;
  lastUpdated: number | null;
  refresh: () => void;
}

function usePolledResource<T>(
  loader: () => Promise<T>,
  intervalMs: number,
  resourceKey: string,
): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const mounted = useRef(true);
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    try {
      const result = await loaderRef.current();
      if (!mounted.current) return;
      setData(result);
      setError(null);
      setLastUpdated(Date.now());
    } catch (caught) {
      if (!mounted.current) return;
      setError(describeError(caught));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    if (!intervalMs || intervalMs <= 0) return;
    const timer = setInterval(() => void run(), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, run, resourceKey]);

  return {
    data,
    error,
    loading,
    stale: Boolean(error) && data !== null,
    lastUpdated,
    refresh: () => void run(),
  };
}

export function useJunctions() {
  return usePolledResource<Junction[]>(
    () => apiClient.call((transport) => transport.listJunctions()),
    POLL_INTERVAL_MS * 5,
    "junctions",
  );
}

export function useJunctionStatus(junctionId: string | null) {
  return usePolledResource<JunctionStatus | null>(
    async () => {
      if (!junctionId) return null;
      return apiClient.call((transport) => transport.getStatus(junctionId));
    },
    POLL_INTERVAL_MS,
    `status:${junctionId ?? "none"}`,
  );
}

export function useHistory(junctionId: string | null, query: HistoryQuery = {}) {
  const { limit = 60, eventType, direction } = query;
  return usePolledResource<HistoryEntry[]>(
    async () => {
      if (!junctionId) return [];
      return apiClient.call((transport) =>
        transport.getHistory(junctionId, { limit, eventType, direction }),
      );
    },
    HISTORY_POLL_INTERVAL_MS,
    `history:${junctionId ?? "none"}:${limit}:${eventType ?? "all"}:${direction ?? "all"}`,
  );
}

export interface ActionState {
  pending: boolean;
  error: string | null;
  notice: string | null;
}

export function useAction() {
  const [state, setState] = useState<ActionState>({
    pending: false,
    error: null,
    notice: null,
  });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    if (mounted.current) setState({ pending: false, error: null, notice: null });
  }, []);

  const run = useCallback(
    async <T,>(
      operation: () => Promise<T>,
      successMessage?: string | ((result: T) => string),
    ): Promise<T | null> => {
      setState({ pending: true, error: null, notice: null });
      try {
        const result = await operation();
        if (mounted.current) {
          const notice =
            typeof successMessage === "function"
              ? successMessage(result)
              : (successMessage ?? null);
          setState({ pending: false, error: null, notice });
        }
        return result;
      } catch (error) {
        if (mounted.current) {
          setState({ pending: false, error: describeError(error), notice: null });
        }
        return null;
      }
    },
    [],
  );

  return { ...state, run, reset };
}