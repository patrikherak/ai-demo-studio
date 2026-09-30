---
name: project-intake
description: Locate a project on disk or clone it from a git remote into an isolated working copy, then inventory its stack, services, env templates, migrations and seeds. Use at the start of a demo-video job or whenever you must understand how an unfamiliar repository is built and run.
---

# Project intake

Goal: an isolated, runnable copy of the project and a written map of what it is made of.

## 1. Find the project

- The user gave a path: verify it exists and is the project root (a README, a manifest such as
  `package.json`, `pyproject.toml`, `Gemfile`, `go.mod`, `composer.json`, or a compose file).
  If they gave a vague name, search likely roots (`~/code`, `~/projects`, `~/src`, `~/dev`, the
  current directory) with `find <root> -maxdepth 3 -name .git -type d` and confirm with the user
  only when several candidates match.
- The user gave a URL: use it as is. For private https repos set `GIT_TOKEN` in `.env`
  (read-only scope). For SSH URLs the local SSH agent is used.
- Monorepo: identify which app to film (look at `apps/*`, `packages/*`, workspace config) and
  write that decision into `brief.md`.

## 2. Make the working copy

```bash
SRC=$(bash scripts/prepare-project.sh <path-or-url> <slug> [--ref <branch|tag|sha>])
```

- Local git repo → a detached `git worktree` of HEAD (or `--ref`). Uncommitted changes are
  not included; if the user wants exactly what is on disk, re-run with `--copy`.
- Local non-git folder → an `rsync` copy without dependencies, build output and `.env` files.
- URL → a shallow clone.

Never work inside the original folder. Remember the worktree for cleanup
(`git -C <original> worktree remove <path>`).

## 3. Inventory

```bash
node scripts/inventory.mjs "$SRC" > work/<slug>/inventory.md
```

Then read, in this order, and add findings to `inventory.md`:

1. `README*`, `CONTRIBUTING*`, `DEVELOPMENT*`, `docs/` setup pages, `AGENTS.md`/`CLAUDE.md`
   of the project (they often contain the exact local setup).
2. Env templates (`.env.example` and friends): which keys are required to boot, which are
   optional integrations.
3. Compose files and Dockerfiles: which services the app expects (database, cache, queue,
   object storage, mail).
4. Package scripts / Makefile targets: `dev`, `build`, `start`, `db:*`, `migrate`, `seed`.
5. Existing seeds, fixtures, factories and e2e tests: they are the best source of valid data
   shapes and of stable selectors.
6. Version pins (`.nvmrc`, `.tool-versions`, `engines`, `python_requires`).

## 4. Classify external dependencies

For every external service the app talks to, decide how the demo will run without it:

| Kind | Default strategy |
|---|---|
| database / cache / queue | run locally (compose or a local binary) |
| auth provider (OAuth, SSO, magic link) | use the app's local/dev auth, a seeded password user, a test mode, or a session injected through the recorder's `setup` steps |
| payments | the provider's test mode keys if the user supplies them, otherwise hide the flow |
| e-mail / SMS | a local catcher (e.g. Mailpit) or a disabled transport |
| maps, AI, search, analytics | test keys from the user, a stub, a feature flag off, or leave the area out of the story |
| object storage | local MinIO or the filesystem driver |

Write the table for this project into `inventory.md`. If the core value of the product depends
on a paid external API and no key is available, tell the user what you need before bootstrapping.

## Gate

`work/<slug>/source` exists, `inventory.md` lists how to run the app, its services, required
env keys and the dependency strategy. Continue with `app-analysis`.
