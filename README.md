# FlowEngine

Multi-channel marketing & sales automation platform — email campaigns, WhatsApp messaging, visual automations, and a sales pipeline in one workspace. Built with **Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui + Prisma + Turso (libSQL)**.

## Features

- **Email campaigns** — compose, schedule and dispatch with per-recipient tracking (sent / opened / clicked / bounced), evidence envelopes for every message
- **WhatsApp messaging** — campaigns and template previews with an authentic chat mockup, WhatsApp Cloud API support
- **Automations (sequences)** — trigger-based flows (contact created, added to list, tagged) with wait steps, tagging, field updates and multi-channel sends; lease-based execution queue with retries and dead-lettering
- **Contacts & lists** — 40+ fields, lead scoring, lifecycle stages, tags, segments with a rule builder, CSV import
- **Sales pipeline** — drag-and-drop kanban deals with weighted forecasts
- **Analytics** — engagement timeseries, channel mix, funnel and pipeline dashboards powered by an append-only event stream
- **API keys & webhooks** — programmatic subscribe/track endpoints, open/click tracking pixels, unsubscribe links
- **Demo data lifecycle** — one-click **Load demo data** and **Remove demo data** (with confirmation) so any fresh workspace can be explored and reset instantly

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Next.js 16 app (Vercel)                            │
│  ├─ App Router UI (10 views, shadcn/ui)             │
│  ├─ /api/* route handlers (auth, CRUD, analytics)   │
│  ├─ In-process automation runner (src/lib/runner.ts)│
│  │   lease-based queue · retries · evidence events  │
│  └─ /api/engine/tick  ← Vercel Cron (every minute)  │
└───────────────────────┬─────────────────────────────┘
                        │ Prisma + libSQL adapter
                        ▼
              ┌──────────────────┐
              │  Turso database  │
              └──────────────────┘
```

The automation engine runs **inside the Next.js server** — no sidecar service required:

1. **Opportunistic ticks** — after any action that enqueues work (campaign send, sequence enrollment), an `after()` hook processes the queue immediately in the same serverless invocation.
2. **Cron tick** — `vercel.json` schedules `GET /api/engine/tick` every minute for time-based steps (waits, scheduled campaigns). Authenticated via `Authorization: Bearer $CRON_SECRET`, which Vercel sends automatically when the env var is set.
3. **Optional external engine** — the FastAPI sidecar in `mini-services/automation-engine/` can still be self-hosted; set `ENGINE_URL` and the app will prefer it and fall back to the in-process runner if unreachable.

Jobs are claimed with a `pending → running` compare-and-set plus a 90s lease, so multiple instances (or the external engine and the in-process runner) can never double-send.

## Deploy to Vercel

### 1. Create the database (Turso)

```bash
# Install the Turso CLI: https://docs.turso.tech/cli/introduction
turso db create flowengine
turso db show flowengine --url          # → TURSO_DATABASE_URL
turso db tokens create flowengine       # → TURSO_AUTH_TOKEN
```

### 2. Push the schema

```bash
git clone https://github.com/faisukhan01/email.git flowengine && cd flowengine
bun install
cp .env.example .env    # fill in the values from step 1
bun run db:push         # creates all tables in Turso
```

### 3. Import to Vercel

1. Push this repo to GitHub and import it at [vercel.com/new](https://vercel.com/new)
2. Framework preset **Next.js** is detected automatically; the build command runs `prisma generate` (also wired via `postinstall`)
3. Add the environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | ✅ | `libsql://…turso.io` URL from step 1 |
| `TURSO_AUTH_TOKEN` | ✅ | Turso auth token from step 1 |
| `JWT_SECRET` | ✅ | Long random string (`openssl rand -base64 32`) — signs sessions & encrypts integration secrets. The app refuses to boot in production without it |
| `CRON_SECRET` | ✅ (recommended) | Long random string — Vercel Cron sends it as a bearer token to `/api/engine/tick` |
| `ENGINE_SECRET` | recommended | Shared secret for engine endpoints & the optional external engine |
| `ENGINE_URL` | — | **Leave unset on Vercel.** Only for self-hosted external engine |

4. Deploy. The cron in `vercel.json` is registered automatically.

> **Note:** Vercel Hobby plans run cron jobs once per day; Pro runs the every-minute schedule. Regardless of plan, normal usage (sends, enrollments) is processed instantly by the opportunistic ticks, so sequences and campaigns work out of the box on Hobby too.

### 4. Verify the deployment

- Open the deployed URL → sign in or **create an account** (registration is built in)
- Dashboard → **Load demo data** → explore → **Remove demo data** to reset
- Settings → Engine tab → status should show **online · built-in in-process runner**

## Local development

```bash
bun install
cp .env.example .env          # point TURSO_* at your Turso db (or a local file: db)
bun run db:push
bun run dev                   # http://localhost:3000
```

Optional external engine (not required — the in-process runner covers everything):

```bash
cd mini-services/automation-engine && bun run dev   # FastAPI sidecar on :3030
```

## Demo account

A pre-seeded demo workspace is available in shared environments:

```
email:    demo@flowengine.app
password: demo12345
```

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Development server on :3000 |
| `bun run build` | `prisma generate` + production build |
| `bun run lint` | ESLint |
| `bun run db:push` | Push `prisma/schema.prisma` to the database |
