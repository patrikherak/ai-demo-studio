---
name: local-bootstrap
description: Bring an unfamiliar project up locally and completely (services, env, dependencies, migrations, build, server) with no production credentials, and write reproducible up/down commands. Use before seeding and recording a demo, or whenever an app must run on this machine from a fresh checkout.
---

# Local bootstrap

Goal: the app runs on this machine from `work/<slug>/source`, talks only to local services, and
`work/<slug>/bootstrap.md` lists the exact commands to start, check and stop it.

## 1. Toolchain

Match the project's pinned versions (`.nvmrc`, `.tool-versions`, `engines`, `python_requires`).
Prefer a version manager already on the machine (`fnm`, `nvm`, `mise`, `asdf`, `pyenv`, `uv`).
Use the project's package manager (lockfile decides: `pnpm-lock.yaml` → pnpm, `yarn.lock` →
yarn, `bun.lock*` → bun, else npm; `uv.lock`/`poetry.lock`/`requirements*.txt` for Python).
Enable Corepack for pnpm/yarn when needed (`corepack enable`). Do not install system packages
with sudo; if something is truly missing, report exactly what and why.

## 2. Services

- Compose file present: start only the services the app needs, detached, with a project name
  scoped to the job so you can remove them later:
  `docker compose -p demo-<slug> -f <file> up -d <db> <cache> …`
- No compose file: start throwaway containers with explicit names and non-default host ports
  to avoid clashes, for example
  `docker run -d --name demo-<slug>-pg -e POSTGRES_PASSWORD=demo -e POSTGRES_DB=app -p 55432:5432 postgres:16`
  (pick the major version the project expects).
- Wait for readiness (`pg_isready`, `redis-cli ping`, an HTTP health endpoint) instead of
  sleeping a fixed time.

## 3. Environment

Create the app's env file from its template (`cp .env.example .env.local` or whatever the
framework reads). Fill it for local use only:

- database/cache URLs → the local services from step 2
- secrets the app generates or signs with (session secret, JWT secret, encryption key) → fresh
  random values (`openssl rand -hex 32`)
- external integrations → test-mode keys supplied by the user, a local stub, or disabled; never
  keys that reach production accounts
- `NODE_ENV`/`APP_ENV` → development unless the demo needs production rendering (see step 5)
- analytics, error reporting, telemetry → off

Record every key you set and why in `bootstrap.md` (values of secrets excluded).

## 4. Install, migrate, build

Run the project's own commands: install dependencies, generate clients (e.g. ORM codegen),
apply migrations against the local database, compile assets. Prefer documented scripts
(`db:migrate`, `migrate`, `prisma migrate deploy`, `alembic upgrade head`, `rails db:prepare`,
`php artisan migrate`) over hand-written SQL. If a migration fails, read the error, fix the local
setup (missing extension, wrong database version, missing env key) and retry; do not edit
migrations to make them pass.

## 5. Run the server

- Development server is fine for most demos, but hide dev-only overlays when recording
  (framework error/indicator overlays, debug toolbars, hot-reload toasts) via the scene's `hide`.
- If dev mode is slow, janky or shows overlays you cannot hide, build and run the production
  server locally (`build` + `start`) for the recording session.
- Start the server in the background with its output in `work/<slug>/server.log`, record the
  PID, and poll the health URL until it answers 200.

```bash
( cd work/<slug>/source && PORT=3100 nohup <start command> > ../server.log 2>&1 & echo $! > ../server.pid )
for i in $(seq 1 60); do curl -fsS -o /dev/null http://localhost:3100 && break; sleep 2; done
```

## 6. Smoke test

Open the main routes from `app-map.md` headlessly (a throwaway recorder scene with only `goto`,
`waitFor` and `screenshot` steps works well) and look at the screenshots. Fix crashes, missing
env keys and 500s now; they will not fix themselves later.

## bootstrap.md template

```
# Bootstrap: <slug>
## Services           # container names, ports, how to check readiness
## Env                # keys set and why (no secret values)
## Commands
up:    …
check: curl -fsS http://localhost:<port>/<health>
down:  kill $(cat work/<slug>/server.pid); docker compose -p demo-<slug> down -v
## Demo user          # login, password (demo only), role
## Known issues       # anything you worked around
```

## Gate

The health check passes, the main routes render without errors, and `bootstrap.md` lets someone
else reproduce the setup. Continue with `demo-seed-data`.
