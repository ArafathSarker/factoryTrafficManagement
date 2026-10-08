# Factory Traffic Management — Frontend

Next.js 16 (App Router) + React 19 + Tailwind v4 dashboard for the factory traffic-control
backend. It is a **pure consumer** of the backend APIs: it never decides phase sequencing or
signal states on its own.

## Run

```bash
cp .env.example .env.local   # already present
npm install
npm run dev                  # http://localhost:3000
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8080/api` | Backend base URL |
| `NEXT_PUBLIC_MOCK_MODE` | `auto` | `auto` (try backend, fall back to simulator), `live` (backend only), `mock` (simulator only) |
| `NEXT_PUBLIC_POLL_INTERVAL_MS` | `1000` | Status polling interval |
| `NEXT_PUBLIC_HISTORY_POLL_INTERVAL_MS` | `2000` | History polling interval |
| `NEXT_PUBLIC_REQUEST_TIMEOUT_MS` | `8000` | Per-request timeout |

`auto` mode is what makes the dashboard demonstrable before the backend exists: on the first
network failure or timeout the session falls back to the built-in simulator and shows a
persistent “Simulated backend” banner. Reloading the page re-probes the real backend.

## Docker

Built automatically by the root `docker-compose.yml` using the Next.js `standalone` output:

```bash
docker compose up --build        # dashboard on http://localhost:3000
```

`NEXT_PUBLIC_*` values are inlined at **build** time, so `NEXT_PUBLIC_API_BASE_URL` is passed as a
build argument. It must be reachable from the browser, not from inside the container network.

## Screens

- `/` — overview: junction switcher, intersection view, desired/actual toggle, queue pressure,
  mode panel, alerts, recent activity with event-type filter.
- `/junctions/[id]` — detail: everything above plus manual control, traffic simulation
  (arrivals, clearances, emergency vehicles, device status, ACK/NACK), pending-command view and
  the list of safety invariants the backend enforces.

## Structure

```
src/lib/types.ts            domain types shared with the backend contract
src/lib/config.ts           env-driven configuration
src/lib/api/errors.ts       ApiError taxonomy + Transport interface
src/lib/api/httpTransport.ts  fetch client, timeouts, response normalisation
src/lib/api/client.ts       transport selection (live / mock / auto-fallback)
src/lib/mock/mockBackend.ts in-browser simulator implementing the same Transport
src/hooks/useTraffic.ts     polling hooks + mutation state
src/components/*            presentational components (server-state driven)
src/app/*                   routes
```

## Design decisions

- **Polling, not WebSocket/SSE.** The assessment allows either. Polling keeps the backend
  contract unchanged (no new SSE endpoint needed) and every panel already degrades gracefully
  when a request fails. Swap `usePolledResource` for an SSE subscription later without
  touching components.
- **Transport abstraction.** UI code depends on the `Transport` interface, never on `fetch`,
  so the simulator is a drop-in replacement. The backend can later be driven over MQTT with no
  frontend change.
- **Defensive normalisation.** `httpTransport` tolerates camelCase or snake_case payloads, list
  or `{data: [...]}` envelopes, missing optional fields, and clamps impossible values
  (e.g. negative queue counts render as 0) instead of crashing the UI.
- **Errors are states, not exceptions.** Polling keeps the last good snapshot and flags it as
  stale; a failed mutation shows an inline banner and never leaves the UI in a pending state.
- **Manual control is command-oriented.** Buttons send `MANUAL_GREEN_REQUEST`,
  `MANUAL_ALL_RED_REQUEST`, `RETURN_TO_AUTOMATIC`, etc.; the backend chooses the safe
  transition. The client has no local signal state.
- **Safety invariants are documented in the UI**, not enforced in it. The dashboard shows
  desired vs controller-confirmed state separately so an unconfirmed command is always visible.

## API contract consumed

```
GET  /api/junctions
GET  /api/junctions/:id
GET  /api/junctions/:id/status
GET  /api/junctions/:id/history?limit=&event_type=&direction=
POST /api/junctions/:id/commands
POST /api/sensor-events
POST /api/controller-events
```

## Verification performed

- `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass.
- The simulator was exercised headlessly: duplicate `event_id` leaves queue counts unchanged,
  orphan `VEHICLE_CLEARED` is rejected, emergency preemption and manual requests never produce
  conflicting GREENs, controller `OFFLINE` forces `FAILURE` and rejects manual commands,
  unknown ACKs are rejected, valid ACKs clear the pending command, and history is recorded.
- The HTTP transport was exercised against a stub backend using the payloads from the
  specification, including 404 handling and unreachable-backend detection.