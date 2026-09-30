---
name: app-analysis
description: Read an unfamiliar web app's code to understand what it does and produce a route → selector → data-dependency map plus the 4–7 moments worth showing in a demo video. Use after intake and before seeding or scripting a product recording.
---

# App analysis

Goal: `work/<slug>/app-map.md`, the contract for seeding, scripting and recording. Everything
in it must come from the code and the rendered app, not from guesses based on names.

## 1. What the product is

Answer in five lines: who uses it, the job it does for them, the one moment where it clearly
beats the alternative (the "aha"), the main objects (e.g. projects, invoices, tickets), and the
primary flow a new user goes through. Sources: README, landing page, marketing copy in the repo,
navigation labels, the main routes' components.

## 2. Routes and screens

Enumerate routes from the framework's router (file-system routes, route tables, controllers).
For each candidate screen record:

- URL (with the params you will seed, e.g. `/projects/demo-alpha`)
- feature flags, roles or plans that gate it
- the component that renders it and its data loaders (API calls, server loaders, queries)
- what it needs to look alive: which tables/collections, how many rows, which date ranges,
  which computed fields (aggregates, charts) and how they are computed
- empty and loading states (so you can recognise them in a frame)

Follow the loaders into the code. A page title does not tell you where its numbers come from.
Distinguish data read live from raw tables and data read from precomputed or cached tables:
the second kind needs its own seed or a recompute job.

## 3. Selectors

For every element you will wait for, click, type into or highlight, pick a selector in this order:

1. `data-testid` / `data-test` that already exists
2. role + accessible name: `role=button[name="Create project"]`, `role=heading[name="Billing"]`
3. exact visible text that is unique on the page: `text="Weekly report"`
4. a stable attribute (`[href="/settings"]`, `[aria-label=…]`, `[name=email]`)

Never use generated class names, DOM positions (`nth-child`, `:nth-match`) or text that comes
from seed data you might change. Check that the rendered element really has the role you assume
(a card title is often a `div`, not a heading). Verify each selector is unique in the running
app before recording (see `record-scenes`, "probe selectors").

## 4. Auth, locale and display settings

- How does a user log in locally? Password form, dev login, magic link to a local mail catcher,
  seeded session? Note the demo user you will create in the seed.
- How are language, currency, theme and time zone chosen: cookie, local storage, user profile,
  `Accept-Language`, URL prefix? You will set them in the recorder (`cookies`, `localStorage`,
  `locale`, `timezoneId`, `initScript`) and in the seed. A language switch translates the UI, not
  the data: seeded names and descriptions must already be in the target language.
- Where does the UI show the signed-in identity (avatar menu, sidebar, settings)? Plan a mask.

## 5. The story moments

Choose 4–7 moments that prove the product's value to the audience in the brief. For each:
the claim (one sentence a viewer should remember), the screen and state that proves it, the
interaction that makes it vivid (a click, typing a search, opening a detail), and what data must
exist for it to look real. Prefer showing an outcome over showing settings.

## app-map.md template

```
# App map: <product>
## Product in five lines
## How to run (from inventory)            # commands, ports, services
## Auth                                   # demo user, login path, session strategy
## Display settings                       # locale/currency/theme/timezone mechanics
## Screens
| screen | url | gate | proof anchor (selector) | data it needs | notes |
## Story moments
| # | claim | screen/state | interaction | data dependency |
## Things to hide or mask                 # dev overlays, cookie banners, real identities, debug toolbars
```

## Gate

Every story moment has a URL, a verified-looking selector for its proof and a list of the data
it needs. Continue with `local-bootstrap`.
