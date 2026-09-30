---
name: demo-seed-data
description: Create realistic, fully synthetic and deterministic demo data so every screen in a product video looks alive — invented identities, coherent stories, time-relative dates, the whole dependency graph including aggregates — with a manifest for cleanup. Use after the app runs locally and before recording.
---

# Demo seed data

Goal: every screen in the story renders believable, non-empty, invented data, and you can remove
it again. A populated table next to an empty chart is not done.

## Principles

1. **Invented, never copied.** Names, e-mails, companies, addresses, amounts and free text are
   made up. Use reserved domains (`example.com`, `example.org`) and fictional companies. Never
   pull rows from any real database, export or log; at most derive shapes (column types, typical
   ranges) from the schema and the code.
2. **Deterministic.** Seed a fixed random generator (`faker.seed(42)`, `random.seed(42)`), use
   fixed identifiers for anything a scene navigates to (`/projects/demo-alpha`,
   `order DEMO-1042`) so selectors and URLs stay stable across re-seeds.
3. **A story, not noise.** Data should tell the narrative in `storyboard.md`: a clear trend, one
   thing that needs attention, one success. Controlled variation beats uniform random numbers.
4. **Time-relative.** Anchor dates to "today" when the seed runs (last 30–90 days of history,
   something due tomorrow, activity from this morning) so the demo does not age. Respect the
   app's time zone.
5. **In the target language.** Seeded labels, names and descriptions are in the brief's language;
   the UI language switch does not translate them.
6. **The whole dependency graph.** If a dashboard reads precomputed tables (aggregates, caches,
   search indexes, materialized views), run the app's own recompute job after inserting base
   rows, or seed those tables consistently with the base rows. Check totals add up.

## How to insert

Prefer, in this order:

1. The project's own seed/fixture/factory tooling (e.g. `db:seed`, factories used by tests),
   extended with a demo scenario file under `work/<slug>/seed/` or passed via env.
2. The app's public or internal API (creates rows exactly as real usage would, including
   side effects such as denormalized counters).
3. The ORM from a script run inside the project (`tsx`, `python -m`, `rails runner`, `artisan tinker`).
4. Raw SQL, only when the above cannot express it; then follow the schema and constraints exactly.

Keep the seed script in `work/<slug>/seed/` and make it idempotent (upsert or delete-then-insert
of rows it owns). Mark everything it creates (a demo tenant/org/workspace, an id prefix such as
`demo-`, or a dedicated database) so cleanup is exact.

## Photos and files

Screens full of placeholder images or real people look wrong. In this order:

1. the project's own seed assets (check they show no real people or customers),
2. synthetic photos: describe each in `seed/images.json` and run
   `node scripts/images.mjs work/<slug>/seed/images.json` (OpenAI Images, cached by prompt;
   ask for no people, faces, text or logos, and say in the report that they are synthetic),
3. never photos scraped from the web or from real customer data.

Convert them to JPEG around 1600 px before uploading them through the app's own models or
uploaders. Logos of real customers found on a marketing site never go into a video.

## Seed scripts that run inside the app

Scripts run through the framework's runner (`rails runner`, `artisan tinker`, `manage.py
shell`) share a global namespace with the framework: a helper named like a DSL method
(`configure`, `set`, `get`, `post`, `helpers`) can be silently shadowed. Keep helpers in a
module or give them unmistakable names, and print what each settings write actually stored.
Reset what a recording changes (a booking, a sign-up, a status) through scene `hooks` so any
scene can be re-recorded on its own.

## Demo user and access

Create one demo user with the role that sees the whole story (often an admin of a demo
organization). Give it a believable invented name and an `@example.com` address. Enable the
feature flags or plan the story needs for that user/org only. Record the login in `bootstrap.md`.

## Render-ready acceptance

For every screen in the story, after seeding:

1. open it in the running app (scripted screenshot scene, see `record-scenes`),
2. wait for the data, not just the page title (a loading skeleton can sit under a real heading),
3. confirm the proof anchor is visible and populated: rows in tables, marks in charts, numbers
   that are not `0`, `—`, `NaN` or raw translation keys,
4. check the claims you will narrate are literally visible (if the voice says "three overdue
   invoices", three overdue invoices are on screen).

Fix the seed until every screen passes. Commit nothing to the project.

Also configure the tenant the way a real customer would: the product's brand colours and logo
if it supports tenant theming, feature flags on for the story, placeholder or "not implemented"
menu entries off, help tips and onboarding dialogs dismissed for the demo user.

## seed-manifest.json

```json
{
  "anchorDate": "2026-01-15",
  "randomSeed": 42,
  "owner": { "kind": "organization", "id": "demo-org" },
  "demoUser": { "email": "alex.morgan@example.com", "role": "admin" },
  "created": { "users": 12, "projects": 6, "invoices": 148 },
  "fixedIds": { "project": "demo-alpha", "invoice": "DEMO-1042" },
  "cleanup": "node work/<slug>/seed/seed.mjs --remove  (or: docker compose -p demo-<slug> down -v)"
}
```

## Gate

All story screens pass render-ready acceptance and `seed-manifest.json` describes how to remove
the data. Continue with `storyboard-and-script`.
