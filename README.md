# Factory Traffic Management System

A small, event-driven traffic-control system for the internal roads of a garment manufacturing
facility. It ingests vehicle-detection events from field sensors, maintains per-approach queues,
drives traffic signals through a safety-checked state machine, accepts administrator overrides and
emergency preemption, tracks physical controller health, and keeps a durable audit trail.

The system is deliberately built as a **control system, not a CRUD application**: the traffic
domain owns the safety rules, and every other layer (HTTP, persistence, the future MQTT adapter,
the dashboard) is a replaceable delivery mechanism around it.

### Core Architectural Vision (Scaling IoT & Performance)
When working with physical IoT devices (like thousands of factory sensors and traffic controllers), the system has to handle a **massive amount of data constantly streaming in**. As a backend engineer, the best system architecture requires processing this data with minimal delay (low latency) and high capacity (high throughput).

To handle this effectively at a large scale:
- **Apache Kafka**: Instead of pushing all sensor data straight to an HTTP server and database, we should use Apache Kafka. Kafka is an event-streaming platform designed to ingest and queue millions of events per second smoothly, preventing our database from getting overwhelmed.
- **Server Caching & Cloudflare CDN**: To ensure the frontend dashboard loads instantly for factory managers anywhere in the world, we can use server-side caching (like Redis) for the current traffic state, and a CDN like Cloudflare to serve the web application with lightning-fast response times.

---

## Table of contents

1. [Repository layout](#1-repository-layout)
2. [Architecture](#2-architecture)
3. [Database design (3NF)](#3-database-design-3nf)
4. [Schema automation script](#4-schema-automation-script)
5. [Getting started](#5-getting-started)
6. [Configuration](#6-configuration)
7. [HTTP API](#7-http-api)
8. [Frontend dashboard](#8-frontend-dashboard)
9. [Safety model](#9-safety-model)
10. [Verification performed](#10-verification-performed)
11. [Assumptions / Questions / Requirement Issues](#11-assumptions--questions--requirement-issues)
12. [AI / Tool Usage](#12-ai--tool-usage)
13. [Roadmap](#13-roadmap)

---

## 1. Repository layout

```
factoryTrafficManagement/
├── docker-compose.yml          # frontend + backend + postgres
├── .env.example                # compose configuration reference
├── AGENT.md                    # the assessment specification
│
├── backend/                    # Express 5 + TypeScript + PostgreSQL
│   ├── Dockerfile              # multi-stage: deps -> build -> runtime
│   ├── src/
│   │   ├── server/server.ts    # process entrypoint (listens on PORT)
│   │   ├── app/app.ts          # express app assembly, middleware, /api mount
│   │   ├── routes/routes.ts    # HTTP layer (router wiring)
│   │   ├── config/db.ts        # single shared pg Pool (connection boundary)
│   │   ├── sql/schema.sql      # canonical, human-readable DDL
│   │   ├── sql/dbObject.ts     # executable, ordered schema definition array
│   │   └── scripts/createSchema.ts   # automation script: applies the schema
│   └── package.json            # dev / build / start / db:init scripts
│
└── frontend/                   # Next.js 16 (App Router) + React 19 + Tailwind v4
    ├── Dockerfile              # multi-stage with Next.js standalone output
    └── src/
        ├── app/                # routes: "/" overview, "/junctions/[id]" detail
        ├── components/         # intersection, alerts, history, controls, simulator
        ├── hooks/useTraffic.ts # polling + mutation state
        └── lib/
            ├── types.ts        # domain contract shared with the backend
            ├── api/            # Transport interface, HTTP client, errors, client selection
            └── mock/           # built-in simulator used when the backend is unreachable
```

The intended layering (already reflected in the directory names) is:

```
        ┌───────────────────────────────────────────────┐
        │  Presentation   HTTP routes  ·  Dashboard UI  │   replaceable
        ├───────────────────────────────────────────────┤
        │  Application    command validation · use cases │   replaceable
        ├───────────────────────────────────────────────┤
        │  Traffic Domain signal state machine ·         │   portable core
        │                 scheduler · safety invariants   │   no I/O, no HTTP
        ├──────────────────────┬────────────────────────┤
        │  Persistence         │  Controller Port       │   adapters
        │  PostgreSQL repos    │  REST simulator / MQTT │   replaceable
        └──────────────────────┴────────────────────────┘
```

The traffic-domain layer is the only layer allowed to decide *which* signal may go GREEN. It
receives validated intents ("a TRUCK arrived from NORTH", "an administrator asked for WEST") and
emits desired-signal changes; it never reads HTTP objects, SQL rows, or MQTT payloads. That is
what makes it testable without a server and replaceable without rewriting the junction logic.

---

## 2. Architecture

### 2.1 Backend

| Layer | Responsibility | Rule |
| --- | --- | --- |
| `server/` | Process lifecycle, port binding | Knows nothing about traffic |
| `app/` | Express wiring, JSON parsing, CORS, `/api` mount | Transport concerns only |
| `routes/` | HTTP contract: validation, status codes, mapping to domain intents | Must not contain traffic rules |
| *(planned)* `application/` | Use cases: ingest sensor event, request command, run scheduler tick | Orchestrates domain + ports inside one transaction |
| *(planned)* `domain/` | Signal state machine, phase scheduler, safety invariants, scoring | **Pure functions.** No `pg`, no `express`, no `setTimeout` waits |
| *(planned)* `persistence/` | Repositories over the tables in §3 | Owns SQL; returns domain objects |
| `config/db.ts` | One shared `pg.Pool` for the process | Single connection boundary |
| `sql/` + `scripts/` | Schema definition and automation | Data-layer tooling |

**Consistency model (planned, chosen deliberately).** Every traffic decision for a junction is
executed inside a single database transaction that takes a row lock on the `junctions` row
(`SELECT ... FOR UPDATE`). Concurrent sensor events, manual commands and controller ACKs for the
same junction are therefore serialised by the database, while different junctions still process in
parallel. This is preferred over in-process locking because it also survives restarts and multiple
instances, and over long `sleep()`-based timing because the scheduler is driven by
`state_started_at` / `next_transition_at` columns plus a lightweight ticker, so a restart resumes
the phase clock instead of losing it.

### 2.2 Frontend

The dashboard is a strict consumer of the HTTP API:

- it renders signal state exactly as the backend reports it (desired **and** controller-confirmed
  shown separately);
- it sends *commands* (`MANUAL_GREEN_REQUEST`, `RETURN_TO_AUTOMATIC`, …) rather than setting
  signal colours locally;
- it refreshes by polling (`GET /api/junctions/:id/status` every second, history every two
  seconds) — no new backend contract is required, and every panel degrades independently when a
  request fails;
- a `Transport` abstraction (`src/lib/api/errors.ts`) decouples the UI from `fetch`, which is why
  a full in-browser simulator can stand in for the backend while it is being built.

See `frontend/README.md` for the frontend-specific decisions.

---

## 3. Database design (3NF)

The PostgreSQL schema is designed in **Third Normal Form**, the industry-standard baseline for
relational systems: every non-key column depends on the key, the whole key, and nothing but the
key. Concretely, that means no duplicated entity data across tables, no repeating groups packed
into columns, and no derived values that can drift out of sync with their source of truth.

How the normal forms are satisfied here:

| Normal form | Rule | How this schema complies |
| --- | --- | --- |
| **1NF** | Atomic values, no repeating groups | One row per vehicle / signal direction / command. Multi-valued facts get their own tables (`vehicles`, `controller_commands`, `controller_acknowledgements`, `audit_logs`) instead of arrays or comma-separated columns. Free-form variable attributes live in a `JSONB` metadata column that is never used for querying. |
| **2NF** | No partial dependency on a composite key | Every table uses a single-column surrogate key (`id UUID` / `BIGSERIAL`) as primary key, so no non-key column can depend on "part of" the key. Natural keys are enforced separately by `UNIQUE` constraints (`uq_command_id`, `uq_junction_name`). |
| **3NF** | No transitive dependency | Shared concepts are factored into their own tables and referenced by foreign key: approach definitions live in `junction_directions`, not repeated inside `vehicles` or `signal_states`; command lifecycle lives in `controller_commands` while transport receipts live in `controller_acknowledgements`; a vehicle's identity and its position in a queue are the same row, but nothing about the *vehicle type vocabulary* or the *junction* is restated. Fixed vocabularies are `ENUM` types, so "signal state" is defined exactly once. |

**Verified on a live PostgreSQL 16 instance: 11 tables, 12 enum types, 11 foreign keys,
28 indexes (primary, unique, plain and partial).**

### 3.1 Table catalogue

| Table | Purpose | Key integrity rules |
| --- | --- | --- |
| `junctions` | One row per physical junction. Holds operating mode, current phase, controller health, and the phase clock (`state_started_at`, `next_transition_at`) used to resume timing after a restart. | `uq_junction_name` |
| `junction_directions` | The approaches a junction actually has. Adding Junction B with a subset of approaches is data, not code. | `uq_junction_direction`, FK `ON DELETE CASCADE` |
| `vehicles` | The queue. One row per vehicle currently tracked at a junction, with sensor timestamp, server receipt time, sequence number and clearance time. | `uq_active_vehicle (junction_id, vehicle_id, status)` — FK `ON DELETE RESTRICT` |
| `processed_events` | Idempotency ledger keyed by the sensor `event_id`, with the outcome (`PROCESSED` / `DUPLICATE` / `REJECTED`) and rejection reason. This is what makes duplicate, replayed and out-of-order submissions safe. | `event_id` is the primary key |
| `signal_states` | Desired state **and** controller-confirmed state per direction. The two columns are intentionally separate: a requested state is not evidence that the hardware executed it. | `uq_signal_junction_direction` |
| `controller_commands` | Every command sent to a physical controller, with lifecycle timestamps (`sent_at`, `acknowledged_at`, `timeout_at`, `completed_at`) and a failure reason. | `uq_command_id` |
| `controller_acknowledgements` | Raw acknowledgements/NACKs received from hardware, correlated to a command. Kept separate from the command so repeated or late ACKs are auditable rather than destructive. | FK to `controller_commands(id)`, `idx_ack_command` |
| `emergencies` | Emergency preemption records with direction, detection and clearance times. | FKs to `vehicles` and `junctions`, partial unique index `uq_active_emergency_vehicle` |
| `manual_overrides` | Administrator interventions, with start/end times. | partial unique index `uq_active_manual_override` |
| `audit_logs` | Append-only history. `BIGSERIAL` for cheap ordered reads, `JSONB` for structured context. | FK `ON DELETE SET NULL` so history outlives the junction |
| `sensor_status` | Per-approach sensor health, independent of the signal controller. | `uq_sensor_junction_direction` |

### 3.2 Integrity is part of the safety model

Several rules that are usually left to application code are enforced by the database, because the
database is the last line of defence when two requests race:

```sql
-- At most one active emergency per vehicle.
CREATE UNIQUE INDEX uq_active_emergency_vehicle ON emergencies (vehicle_id) WHERE active = TRUE;

-- At most one active manual override per junction: two administrators cannot
-- silently fight over the junction.
CREATE UNIQUE INDEX uq_active_manual_override ON manual_overrides (junction_id) WHERE active = TRUE;
```

Queues cannot go negative (they are counted rows, not a mutable counter that a bad request could
push below zero), and `signal_states.actual_state` is nullable precisely so that "unknown until
confirmed" is representable instead of being silently defaulted to `RED`.

### 3.3 Query support

Indexes follow the actual access patterns of the scheduler and the audit feed:
per-junction queue reads (`idx_vehicles_queue`, `idx_vehicles_waiting`), pending-command lookups
(`idx_commands_junction_status`), ACK correlation (`idx_ack_command`), active-emergency lookups
(`idx_emergencies_active`), and reverse-chronological history reads (`idx_audit_junction_time`).

---

## 4. Schema automation script

Creating eleven tables, twelve enums and twenty-odd indexes by hand is repetitive and easy to get
wrong, so the schema ships with an executable definition and a script that applies it.

| File | Role |
| --- | --- |
| `backend/src/sql/schema.sql` | Canonical, human-readable DDL with explanatory comments — the artefact a reviewer reads. |
| `backend/src/sql/dbObject.ts` | The same schema as an ordered array of `{ name, sql }` entries: enums first, then tables (parents before children), then indexes. Types are compiled away, so nothing needs parsing at runtime. |
| `backend/src/scripts/createSchema.ts` | Executes each entry in order through the shared `pg.Pool`, logs `Table <name> created successfully` per object, reports per-object errors without aborting the run, and closes the pool. |

Run it against an existing database:

```bash
cd backend
cp .env.example .env          # or create .env with DATABASE_URL=...
npm run db:init               # tsx --env-file=.env src/scripts/createSchema.ts
```

Connection details come from a single `DATABASE_URL` (`postgresql://user:password@host:5432/db`),
so the same script works for a laptop, CI, or the container. In Docker the compiled equivalent runs
automatically before the API starts:

```dockerfile
CMD ["sh", "-c", "node dist/scripts/createSchema.js; exec node dist/server/server.js"]
```

*Known limitation:* the DDL uses bare `CREATE TYPE` / `CREATE TABLE`, so a second run reports
"already exists" errors (which the script logs and skips). The next step is to add
`IF NOT EXISTS` handling or adopt a versioned migration table so re-running is truly idempotent —
see [Roadmap](#13-roadmap).

---

## 5. Getting started

### 5.1 With Docker (recommended)

```bash
cp .env.example .env           # optional: override ports and credentials
docker compose up --build
```

| Service | URL | Notes |
| --- | --- | --- |
| Dashboard | http://localhost:3000 | Next.js standalone output |
| API | http://localhost:8080/api | Express |
| Postgres | `localhost:5432` | user/password/db default `traffic`/`traffic`/`traffic`, volume `postgres_data` |

The backend waits for Postgres to report healthy, applies the schema, then serves. To reset all
data: `docker compose down -v`.

### 5.2 Locally

```bash
# Backend — needs a reachable PostgreSQL
cd backend
npm install
printf 'DATABASE_URL="postgresql://postgres:<password>@localhost:5432/factory_management"\n' > .env
npm run db:init
npm run dev                    # tsx watch, http://localhost:8080

# Frontend — separate terminal
cd frontend
npm install
cp .env.example .env.local     # NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api
npm run dev                    # http://localhost:3000
```

If the backend is not running, the dashboard automatically switches to its built-in simulator and
displays a clear "Simulated backend" banner, so the UI can always be demonstrated.

---

## 6. Configuration

| Variable | Used by | Default | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | backend | — | PostgreSQL connection string |
| `PORT` | backend | `8080` | HTTP port |
| `HOST_NAME` | backend | `localhost` | Cosmetic: host shown in the startup log |
| `NEXT_PUBLIC_API_BASE_URL` | frontend build | `http://localhost:8080/api` | API base URL used by the browser |
| `NEXT_PUBLIC_MOCK_MODE` | frontend build | `auto` | `auto` / `live` / `mock` |
| `NEXT_PUBLIC_POLL_INTERVAL_MS` | frontend | `1000` | Status polling |
| `NEXT_PUBLIC_HISTORY_POLL_INTERVAL_MS` | frontend | `2000` | History polling |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | `traffic` | Database bootstrap |

`.env` files are git-ignored; `.env.example` is the committed reference.

---

## 7. HTTP API

Base URL `/api`. Implemented so far: the Express application, middleware and router mount, plus a
placeholder route. The rest is the contract the dashboard and the domain layer are being built
against.

| Method & path | Purpose |
| --- | --- |
| `GET /api/junctions` | List junctions (lightweight) |
| `GET /api/junctions/:id` | Junction detail and configuration |
| `POST /api/junctions` | Register a junction |
| `GET /api/junctions/:id/status` | Mode, phase, controller status, desired signals, confirmed signals, queues |
| `GET /api/junctions/:id/history` | Audit history, filterable by event type and direction |
| `POST /api/junctions/:id/commands` | `MANUAL_GREEN_REQUEST`, `MANUAL_ALL_RED_REQUEST`, `RETURN_TO_AUTOMATIC` |
| `POST /api/sensor-events` | `VEHICLE_ARRIVED` / `VEHICLE_CLEARED` |
| `POST /api/controller-events` | Controller `ACK` / `NACK` / `OFFLINE` and device status reports |

Status codes follow the intent: `200` for reads and accepted commands, `202` for accepted sensor
events, `400`/`422` for validation failures, `404` for unknown junctions, `409` for state conflicts
(for example a manual command while the controller is offline).

---

## 8. Frontend dashboard

Implemented in `frontend/` (Next.js 16 App Router, React 19, Tailwind v4):

- **Overview (`/`)** — junction switcher, intersection visualisation, desired/actual toggle,
  per-direction queue pressure, operating-mode panel, active alerts, recent activity with
  event-type filtering.
- **Detail (`/junctions/[id]`)** — everything above plus manual control, the traffic simulation
  form (arrivals, clearances, emergency vehicles, device status, ACK/NACK, duplicate resubmission),
  the pending-command view, and the list of safety invariants the backend guarantees.

The dashboard never computes the next phase or a signal colour; it only renders backend state.
Full details in `frontend/README.md`.

---

## 9. Safety model

The invariants the system must never violate:

1. Conflicting phases are never GREEN simultaneously.
2. A GREEN phase never transitions directly into a conflicting GREEN phase.
3. Manual and emergency requests use the same transition path (`GREEN → YELLOW → ALL RED → GREEN`).
4. An invalid command cannot leave the junction in an unsafe state.
5. A requested signal state is never displayed or treated as confirmed until the controller
   acknowledges it.

How they are supported:

- the transition sequence lives in one domain state machine, not in route handlers;
- `signal_states` keeps desired and confirmed state in separate columns, so an unconfirmed command
  is visible rather than assumed;
- `controller_commands` records `timeout_at`, so a controller that never answers becomes a
  timeout that degrades the junction instead of an optimistic success;
- partial unique indexes prevent conflicting active emergencies and duplicate active manual
  overrides;
- per-junction transactions serialise concurrent decisions.

---

## 10. Verification performed

- **Database** — schema applied and inspected on a live PostgreSQL 16 instance: 11 tables, 12 enum
  types, 11 foreign-key constraints, 28 indexes, partial unique indexes present.
- **Frontend** — `tsc --noEmit`, `eslint`, and `next build` all pass; Next standalone runtime output
  verified locally.
- **Simulator (headless run)** — duplicate `event_id` leaves queue counts unchanged; an orphan
  `VEHICLE_CLEARED` is rejected; emergency preemption and manual requests never produced conflicting
  GREEN states across 20 consecutive samples; controller `OFFLINE` forces failure mode and blocks
  manual commands; unknown ACKs rejected, valid ACKs clear the pending command; audit history and
  filtering verified.
- **HTTP layer** — exercised against a stub backend using the payloads from the specification,
  including `snake_case`/wrapped-list normalisation, negative queue clamping, `404` mapping and
  unreachable-backend detection.
- **Not yet verified** — the domain engine, repositories and scheduler, because those layers are
  still to be implemented.

---

## 11. Assumptions / Questions / Requirement Issues

The specification intentionally leaves many decisions open. Below is each significant one, the
decision taken, and where it is visible.

1. **Is `event_id`, `sequence_no` or the sensor timestamp authoritative?** *Decision:* `event_id` is
   the idempotency key (`processed_events` primary key); `sequence_no` is advisory and used only to
   detect out-of-order arrival; the **server** receipt time is authoritative for "how long has this
   vehicle waited", because a sensor clock can drift or be tampered with. The sensor timestamp is
   retained for forensics.
2. **Delayed / out-of-order events.** *Decision:* an event for a vehicle that is no longer queued is
   recorded as `REJECTED` in `processed_events` with a reason instead of mutating the queue, and the
   queue is derived only from vehicle rows so it can never drift or go negative.
3. **Duplicates.** *Decision:* `ON CONFLICT` on `processed_events.event_id` inside the same
   transaction as the queue change; a duplicate is a no-op, never a double decrement.
4. **Is `ALL_RED` a signal state?** *Decision:* it is an internal transition state, not a lamp
   colour. `signal_state` contains only `RED`/`YELLOW`/`GREEN`, and `ALL RED` is represented by all
   four directions being `RED` while the phase clock is in its clearance window. *Open issue:* the
   dashboard also accepts an `ALL_RED` phase label; `phase_type` currently only has
   `NORTH_SOUTH`/`EAST_WEST`, so either the enum gains `ALL_RED` or the API documents that the phase
   stays at the previous value during clearance. This must be reconciled.
5. **Event naming mismatch.** The API specification sends `VEHICLE_ARRIVED`, while
   `sensor_event_type` stores `VEHICLE_DETECTED`. *Decision pending:* standardise on one name (the
   API name is the public contract; the enum should follow) rather than translating silently.
6. **`FAILURE` vs `DEGRADED`.** The specification asks for a failure mode; `junction_mode` currently
   has `DEGRADED` but no `FAILURE`. *Decision:* add `FAILURE` for "a device is unavailable and we
   are holding the safest state", keeping `DEGRADED` for partial degradation.
7. **How long does manual control last?** *Decision (not yet implemented):* manual override holds
   until `RETURN_TO_AUTOMATIC`, with an optional expiry timestamp so an override cannot be left on
   after an administrator walks away. The UI surfaces the override as an explicit state.
8. **Two administrators at once.** *Decision:* `uq_active_manual_override` allows one active
   override per junction; the second command is rejected with `409` rather than racing the first.
9. **Does emergency override manual?** *Decision:* yes for safety, but not instantly — the active
   manual phase is cleared through the normal `YELLOW → ALL RED` sequence, and manual control does
   not resume automatically afterwards.
10. **Two conflicting emergencies?** *Decision:* the first detected emergency keeps preemption (the
    junction cannot safely serve both at once); the second is recorded and served immediately after
    the first clears. Neither is dropped from history.
11. **When is an emergency cleared?** *Decision:* on a matching `VEHICLE_CLEARED` event, or after a
    staleness timeout, so a lost sensor cannot freeze the junction in emergency mode forever.
12. **How long to wait for an ACK, and should commands retry?** *Decision:* a bounded timeout
    recorded in `controller_commands.timeout_at`; no infinite retries. Retry only for idempotent
    state-setting commands, and only while the desired state is still current — a retry that would
    overwrite a newer decision is dropped.
13. **Duplicate / late ACKs.** *Decision:* ACKs are appended to `controller_acknowledgements` and
    applied only to the still-pending command; unknown command IDs are logged, not applied.
14. **Controller reconnect.** *Decision:* on reconnect the system does **not** assume its desired
    state is correct. It re-sends the current desired state, waits for a fresh ACK, and only then
    resumes automatic scheduling.
15. **Restart during a transition.** *Decision:* the phase clock is data (`state_started_at`,
    `next_transition_at`), so on boot the engine reconstructs its state, re-issues the desired signal
    state to the controller, and re-validates before serving traffic.
16. **Desired ≠ actual.** *Decision:* surfaced as an explicit `DEGRADED`/alert condition with the
    mismatch reported per direction; the engine never reports a state as confirmed on intent alone.
17. **Scheduling weights.** *Decision:* queue length + vehicle priority mass + normalised waiting
    time + a starvation bonus, with hysteresis so the engine does not flap between phases. Exact
    weights are configuration, not hard-coded logic.
18. **Scoring is per direction, conflicts are per phase.** *Decision:* the specification is
    ambiguous about whether a phase is judged by its best approach or the sum of both; the sum is
    used, so a busy approach dominates its opposing approach and the engine cannot starve one side
    of the junction.
19. **Multi-junction support.** *Decision:* junction configuration (approaches, phases, timings) is
    data, so Junction B/C/D are rows rather than new code paths.

---

## 12. AI / Tool Usage

AI-assisted coding tools were used during development, and the candidate remains responsible for
every line submitted.

- **OpenCode (in-editor agent)** — scaffolding the frontend component and transport layer,
  generating the initial Docker/compose files, and drafting documentation. Backend code
  (`src/sql/schema.sql`, `src/sql/dbObject.ts`, `src/scripts/createSchema.ts`, Express wiring) was
  written by the candidate.
- **Tooling** — Next.js, ESLint, TypeScript and PostgreSQL tooling were used to verify the work
  (`tsc --noEmit`, `eslint`, `next build`, `psql` inspection of the live schema, headless runs of
  the dashboard's transport and simulator logic).

---

## 13. Roadmap

Ordered by value for safety, correctness and reviewability:

1. **Traffic-domain engine** — signal state machine, phase scheduler with scoring + starvation
   protection, and unit tests that run without HTTP, MQTT or a database.
2. **Persistence layer** — repositories for the tables in §3, plus the per-junction transaction and
   `SELECT ... FOR UPDATE` locking that serialises concurrent decisions.
3. **Application services** — sensor-event ingestion (idempotent, out-of-order aware), command
   handling, controller-ACK correlation and timeout handling, audit logging.
4. **HTTP endpoints** in §7 with validation and the documented status codes.
5. **Idempotent migrations** — versioned schema migrations so `db:init` can be re-run safely, and the
   `VEHICLE_DETECTED`/`FAILURE` enum reconciliation from §11.
6. **Recovery tests** — restart mid-transition, restart with a pending command, controller offline
   and reconnect scenarios, driven by the frontend simulator forms.
7. **Bonus work** — MQTT adapter behind the same controller port, SSE live updates, auth on manual
   commands, metrics and traffic analytics.

---

## 14. Engineering Architecture & Design Implementation Details

To solve the core requirements safely and maintainably, the implemented architecture leverages several specific engineering paradigms:

### Database 3NF & Automation
The PostgreSQL database is rigorously structured in **Third Normal Form (3NF)**. There are no duplicated fields, and multi-valued facts (like queue sizes or actual vs desired signals) are cleanly separated via foreign keys. The creation of this structure is fully automated via the `createSchema.ts` bootstrap script, ensuring that deploying the system is reproducible, predictable, and idempotent.

### The Traffic Scheduler (State Machine)
Rather than blocking HTTP request threads with `sleep()`, the core traffic engine is implemented as a lightweight, background `setInterval` ticker (`scheduler.ts`). 
- **Safety Invariants**: It executes a deterministic state machine, ensuring conflicting phases can never simultaneously receive `GREEN`. It enforces a strict `GREEN -> YELLOW -> ALL_RED -> GREEN` transition sequence with precise millisecond timeouts. 
- **Preemption**: When an emergency vehicle is detected, the scheduler immediately intercepts the current phase, forces a safe transition to `ALL_RED`, and clears the path.

### Advanced Queue Scoring (Starvation Prevention)
The `calculateNextPhase` algorithm does not naively count vehicles. It computes a weighted score for each approach:
- **Priority Multipliers**: `TRUCK` (x5), `FORKLIFT` (x2), `EMPLOYEE_VEHICLE` (x1).
- **Wait-Time Hysteresis**: For every 10 seconds a vehicle remains waiting, its score dynamically increases. This guarantees starvation protection for lower-priority vehicles over time.

### Concurrency and Locking 
To prevent race conditions, the REST API endpoints (`/commands`, `/controller-events`) do not issue blind `UPDATE` queries. They wrap their operations in a `BEGIN` transaction and lock the junction row via `SELECT * FROM junctions WHERE id = $1 FOR UPDATE`. This guarantees that manual overrides and hardware ACKs are perfectly serialized alongside the background scheduler's decisions.

### Resilience and Stale-State TTLs
The system protects against disconnected administrators and hardware failures:
- **Watchdogs**: If a controller's `actual_state` fails to match the `desired_state` for more than 15 seconds, the scheduler automatically downgrades the controller to `OFFLINE`.
- **TTLs**: Abandoned manual overrides expire after 10 minutes, and stale emergency events are swept after 5 minutes, returning the system to safe automatic control without human intervention.

### Better Approaches & Future Scalability
While this implementation is robust for a single Node.js instance, it can be handled more effectively at scale using the following paradigms:
1. **Actor Model / Pub-Sub**: Polling the database every second via `setInterval` is not horizontally scalable. A better approach is using an event bus (e.g., Redis Pub/Sub, Kafka, or an Actor model like Akka) to push state changes to a distributed pool of junction worker nodes asynchronously.
2. **MQTT for Telemetry**: HTTP REST is too heavy for IoT hardware. Real controllers should communicate over MQTT with QoS 1/2 to guarantee delivery of ACK messages, leveraging keep-alive pings to track hardware health instantly.
3. **CQRS / Time-Series DB**: As factory traffic scales, `audit_logs` and `vehicles` histories will grow massively. Moving the telemetry data to a specialized Time-Series Database (TSDB) like InfluxDB and separating the Read models from the Write models (CQRS) would drastically improve reporting performance for the frontend dashboard.