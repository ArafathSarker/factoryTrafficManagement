"use client";

import { MOCK_MODE } from "../config";
import { ApiError, type Transport } from "./errors";
import { createHttpTransport } from "./httpTransport";
import { MockBackend } from "../mock/mockBackend";

export type ApiSource = "live" | "mock";

type Listener = () => void;

type Mode = "auto" | "mock" | "live";

function resolveMode(): Mode {
  const value = MOCK_MODE.toLowerCase();
  if (value === "mock" || value === "true" || value === "1") return "mock";
  if (value === "live" || value === "false" || value === "0") return "live";
  return "auto";
}

class ApiClient {
  private liveTransport: Transport | null = null;
  private mockBackend: MockBackend | null = null;
  private mockTransport: Transport | null = null;
  private listeners = new Set<Listener>();
  private mode: Mode = resolveMode();
  private source: ApiSource = this.mode === "mock" ? "mock" : "live";
  private probeComplete = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSource(): ApiSource {
    return this.source;
  }

  getMode(): Mode {
    return this.mode;
  }

  isSimulated(): boolean {
    return this.source === "mock";
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private live(): Transport {
    if (!this.liveTransport) this.liveTransport = createHttpTransport();
    return this.liveTransport;
  }

  private mock(): Transport {
    if (!this.mockBackend) {
      this.mockBackend = new MockBackend();
      this.mockBackend.start();
    }
    if (!this.mockTransport) this.mockTransport = this.mockBackend.transport();
    return this.mockTransport;
  }

  private useMock(reason: string): Transport {
    const wasLive = this.source === "live";
    this.source = "mock";
    this.probeComplete = true;
    if (wasLive) {
      console.warn(
        `[dashboard] Backend unreachable (${reason}). Falling back to the built-in simulator.`,
      );
      this.emit();
    }
    return this.mock();
  }

  /**
   * Runs `operation` against the configured backend. In `auto` mode a network or
   * timeout failure permanently downgrades the session to the local simulator so
   * the dashboard stays demonstrable while the backend is down.
   */
  async call<T>(operation: (transport: Transport) => Promise<T>): Promise<T> {
    if (this.mode === "mock") return operation(this.mock());
    if (this.mode === "live") return operation(this.live());

    try {
      const result = await operation(this.live());
      this.probeComplete = true;
      this.source = "live";
      return result;
    } catch (error) {
      const retryable =
        error instanceof ApiError && (error.kind === "NETWORK" || error.kind === "TIMEOUT");
      if (!retryable) throw error;
      return operation(this.useMock(error.message));
    }
  }

  get probeDone(): boolean {
    return this.probeComplete;
  }
}

export const apiClient = new ApiClient();