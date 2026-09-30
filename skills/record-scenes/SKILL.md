---
name: record-scenes
description: Record demo-video scenes with the config-driven Playwright recorder — logged-in sessions without filming the login, animated cursor, callout legends, highlight rings, typing, masking of identities, hiding dev overlays, audio-sized scene length, strict selector checks. Use to capture every storyboard scene after narration is generated (or for silent videos).
---

# Record scenes

Goal: one raw take per scene in `work/<slug>/raw/` with **zero misses**, each showing its proof
while its narration plays. Tools: `bash scripts/setup-tools.sh && source .tools/env.sh`.

```bash
node scripts/record.mjs work/<slug>/scenes/02-board.json
```

Exit code 0 = usable take. Exit code 2 = at least one `MISS` (selector not found in time): the
take is not usable; fix the selector or the data and record again. Each take writes
`<output>.json` next to the video with `startSec` (where the scene starts after loading),
`sceneSec`, misses and screenshots.

## Scene file

```json
{
  "id": "02-board",
  "baseUrl": "http://localhost:3100",
  "output": "../raw/02-board.webm",
  "viewport": { "width": 1600, "height": 1000 },
  "deviceScaleFactor": 2,
  "colorScheme": "light",
  "locale": "en-US",
  "timezoneId": "Europe/London",
  "storageState": "../auth/state.json",
  "cookies": [{ "name": "lang", "value": "en" }],
  "localStorage": { "theme": "light" },
  "hide": ["nextjs-portal", "#cookie-banner", "[data-dev-toolbar]"],
  "mask": [{ "selector": "[data-testid=user-email]", "text": "alex.morgan@example.com" }],
  "maskText": [{ "find": "real.person@company.test", "replace": "alex.morgan@example.com" }],
  "accent": "#2563eb",
  "narration": ["s02-board"],
  "steps": [
    { "goto": "/projects", "waitFor": "role=heading[name=\"Projects\"]" },
    { "waitForGone": ".skeleton" },
    { "mark": true },
    { "highlight": { "selector": "role=columnheader[name=\"Health\"]", "ms": 2200 } },
    { "legend": { "title": "Live project health", "text": "Red means a deadline is at risk.", "position": "bottom-right", "ms": 2600 } },
    { "click": "text=\"Website relaunch\"" },
    { "waitFor": "role=heading[name=\"Website relaunch\"]" }
  ]
}
```

Paths are relative to the scene file. `narration`, `audio` and `minDurationMs` are filled in by
`fit-scenes.mjs`; you do not write them by hand for narrated videos.

### Shared settings

Put what every scene shares (`baseUrl`, `viewport`, `deviceScaleFactor`, `setup`, `brand`,
`sfx`, `hide`, stage defaults) into `scenes/_base.json` and start each scene with
`"extends": "_base.json"`. Objects merge key by key (a scene can override one `stage` key),
arrays and values are replaced. Paths stay relative to the scene folder, so keep the base
there. Files starting with `_` are never rendered as scenes.

### Resettable scenes

`"hooks": { "before": "…", "after": "…" }` run shell commands in the scene folder around the
take, typically a seed script that undoes what the previous take changed. With hooks and
`produce.mjs` (which re-records only scenes whose content changed) any scene can be redone
alone.

### Capture quality

`capture: "screencast"` (default) streams full-resolution frames over CDP at the scene's
`deviceScaleFactor` and encodes them near-lossless; use `.mp4` outputs. Record phones at
390×844 with `deviceScaleFactor` 2 and desktops at 1600×900 with 1.25–1.5, so stage zoom stays
sharp. `capture: "video"` falls back to Playwright's own 1 Mbit/s VP8 recorder.

### Stage (composited scenes)

```json
"brand": "../brand/brand.css",
"sfx": "../audio/sfx",
"stage": { "layout": "phone", "side": "right", "tilt": true, "theme": "dark",
           "eyebrow": "For teams", "title": "What matters, **first.**", "text": "…",
           "zoom": 1.35, "url": "app.example.com" }
```

| stage key | meaning |
|---|---|
| `layout` | `phone` (device frame) or `browser` (window with address bar) |
| `side` | where the device sits: `right`, `left` (text panel opposite), `center`, `top` (browser with a headline band) |
| `eyebrow`, `title`, `text`, `bullets`, `titleSize`, `titleAt` | the side panel; title words blur in one by one |
| `tilt` | `true` or `{ "y": 9, "x": 4, "z": 0, "drift": 0.45 }`: 3D angle that eases flatter over the scene |
| `theme` | `dark` for a deep brand-tinted background |
| `zoom`, `zoomOn` | auto-zoom scale (browser default 1.45, phone off) and which events trigger it (`click`, `type`, `focus`) |
| `callouts`, `calloutOverhang` | legend steps become floating cards next to the device (`false` to disable) |
| `chrome`, `marginX`, `marginY`, `panelWidth`, `phoneX`, `bandHeight`, `exit`, `vars` | layout fine-tuning |

In a staged scene a `legend` step records a callout instead of drawing it in the page:
`{"legend": {"style": "chip", "icon": "camera", "title": "Photo attached", "position":
"bottom-right", "ms": 2400, "tone": 2, "dx": 0, "dy": 0, "wait": false}}`. `style: "chip"` is a
compact icon + title (+ `text`), the default is a card with `tag`, `title`, `text`. `wait:
false` lets the next step run while the callout is shown. Callout copy (title, text, icon, tone,
position) is read from the scene again when the clip is built, so wording fixes need only
`build-clip.mjs` as long as no steps were inserted or removed. Icons: news, wrench, calendar, users,
tag, chart, file, inbox, plug, home, bell, chat, check, shield, phone, globe, key, clock, mail,
camera, paper, sparkle, building, user, send, plus, heart, star, x, arrow.

### Cards (rendered scenes)

A scene with `"card"` and no `steps` is rendered from `templates/cards/card.html`, frame-exact:
`kinetic` (`lines`), `logo` (`logo`, `tagline`), `title`, `statement`, `compare` (`left`,
`right`), `stats` (`items`: value, suffix, label), `metric` (big counter + tilted `image` with
`chips`), `steps`, `grid` (`items` with `icon`), `columns`, `montage` (`items`: image, kind
`phone`|`browser`, label, at), `cta`, `outro` (`lines`, `button`, `url`). Common keys: `eyebrow`,
`title` (`**accent**`), `theme: "dark"`, `motif: "wave"`, `at`/`lineAt`/`buttonAt` timings
(seconds, `cue:N`, `word:x`). Paths are relative to the scene file. `card.html` in the card
points at a custom template that defines `window.__frame(t, total)`.

| key | meaning |
|---|---|
| `baseUrl`, `output` | app origin; raw video path (`.webm`) |
| `viewport`, `deviceScaleFactor`, `videoSize` | CSS size of the window; pixel density; encoded frame size (defaults to viewport) |
| `colorScheme`, `locale`, `timezoneId` | browser display settings |
| `storageState` / `saveStorageState` | load / save cookies + local storage (logged-in session) |
| `setup` | steps run in an **unrecorded** context first (log in, accept banners); its session is carried into the recording |
| `authUrl` | shorthand for a one-step setup that opens a magic/dev login link |
| `cookies`, `localStorage`, `initScript` | display preferences before the app's code runs |
| `hide` | CSS selectors hidden in every page (dev overlays, cookie banners, chat widgets) |
| `mask`, `maskText` | replace the text of elements / any matching text (real identities, hostnames) |
| `accent` | colour of cursor and highlight ring |
| `minDurationMs` | the scene lasts at least this long after its `mark` (set by `fit-scenes.mjs`) |
| `timeoutMs` | per-step wait before a `MISS` (default 8000) |
| `strict` | default `true`: any miss makes the take fail |
| `routes` | `[{ "url": "**/api/x", "file": "stub.json" }]`, `body`, `rewrite: { from, to }` or `abort`: serve, rewrite or block requests |
| `capture`, `captureQuality`, `fps` | see Capture quality |
| `brand`, `stage`, `card`, `canvas`, `sfx`, `sfxCues` | see Stage, Cards and edit-and-deliver |
| `tailMs` | extra time recorded after the last step (default 600) |

### Steps

| step | effect |
|---|---|
| `{"goto": "/path"}` | navigate (relative to `baseUrl`) |
| `{"waitFor": sel}` / `{"waitForGone": sel}` | wait until visible / hidden |
| `{"mark": true}` | the finished video starts here (default: after the first navigation's `waitFor`) |
| `{"click": sel}` | cursor glides, real mouse click; `afterMs` to wait after |
| `{"moveTo": sel}` / `{"hover": sel}` | cursor glides to the element |
| `{"type": {"selector", "text", "delayMs"}}` | click, clear, type visibly |
| `{"fill": {"selector", "value"}}` | set a value instantly (setup forms) |
| `{"press": "Enter"}` | keyboard key |
| `{"scrollTo": sel}` / `{"scrollY": 600}` | scroll element into view / to a y offset |
| `{"highlight": {"selector", "ms"}}` | ring around an element |
| `{"legend": {"title", "text", "position", "ms"}}` | callout box (`bottom`, `top`, `bottom-left`, `bottom-right`, `top-left`, `top-right`) |
| `{"waitMs": 800}` | pause |
| `{"screenshot": "../qa/02.png"}` | still image for QA |
| `{"evaluate": "js"}` | run JavaScript in the page (escape hatch), e.g. scroll an inner container |
| `{"upload": {"click": sel, "files": ["photo.jpg"]}}` | click an upload button and answer the file chooser (or `selector` of an `input[type=file]`) |
| `{"focus": {"selector", "scale", "holdMs"}}` / `{"focus": null}` | ask the stage to zoom to an element / zoom out |
| `{"scroll": {"container": "ion-content", "y": 480, "ms": 900}}` | smooth-scroll an inner scroll container (or the page without `container`); uses the component's own API when it has one |
| `"optional": true` on any step | a miss on this step does not fail the take |
| `"timeoutMs"` on any step | per-step wait override |

Selectors are Playwright selectors: `role=button[name="Save"]`, `text="Weekly report"`,
`[data-testid=total]`, CSS. Only visible matches count, so responsive layouts that keep a hidden
mobile copy of a list do not steal the click.

## Logging in without filming it

Put the login in `setup` (it runs in a separate, unrecorded browser context) and optionally save
the session for the other scenes:

```json
"setup": [
  { "goto": "/login" },
  { "fill": { "selector": "input[name=email]", "value": "alex.morgan@example.com" } },
  { "fill": { "selector": "input[name=password]", "value": "demo-password" } },
  { "click": "role=button[name=\"Sign in\"]" },
  { "waitFor": "role=navigation" }
],
"saveStorageState": "../auth/state.json"
```

Other scenes then use `"storageState": "../auth/state.json"` and start directly on their page.

## Probe selectors before a real take

Make a throwaway scene with the same `goto`/`waitFor` steps plus `screenshot` steps and
`"strict": true`. Look at the screenshots. Only then write legends and interactions.

## App quirks worth knowing

- Mobile-first frameworks scroll an inner container, not the window: use a `scroll` step with
  its `container`.
- Loading overlays flash grey; `hide` them only when the step after them waits for the data it
  needs, otherwise a click can land before the screen is ready.
- Date pickers animate month changes: give the step after a month switch ~700 ms.
- Pick options inside the element that opened them (`ion-alert …`, `ion-modal …`,
  `ion-popover …`), never by bare text that also appears on the page behind.
- Clean up what a take changed (a booking, a sign-up) before recording it again.

## Rhythm and framing

- One scene = one screen state or one short interaction; under 60 s.
- Order inside a scene: arrive → wait for data → `mark` → highlight what the sentence is about →
  legend (optional) → interaction → let it breathe (`waitMs` 400–800).
- Scroll only when the story needs it, once, in one direction. No decorative scrolling.
- Check the full frame: nothing important cut at the edges, no horizontal scrollbar, sidebars
  complete. If the layout needs it, use 1920×1080 or a larger viewport.
- Opening and closing cards can be a tiny local HTML page recorded the same way (a scene whose
  `baseUrl` is a `file://` or a local static server) so they share the pipeline.

## After each take

Read the recorder output: `VIDEO … misses=0`. A `WARN actions took …s longer than minDurationMs`
means interactions outran the narration: shorten the actions or split the scene. Then continue
with `edit-and-deliver` to build the clip and look at its frames.

## Gate

Every scene has a take with zero misses whose frames show its proof while its sentence plays.
