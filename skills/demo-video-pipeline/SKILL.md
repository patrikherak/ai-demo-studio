---
name: demo-video-pipeline
description: End-to-end production of a narrated marketing/demo video for any software project found on disk or in a git remote — intake, analysis, local bootstrap with synthetic seed data, storyboard, ElevenLabs narration, Playwright recording, editing, QA and delivery. Use when asked to "make a demo video / product video / walkthrough / promo" of an app.
---

# Demo video pipeline (orchestrator)

You turn a software project into a finished, narrated demo video. You work alone and
end-to-end: nobody will run commands for you, and the only acceptable result is a
verified video file (plus a short report), not a plan.

Paths below are relative to the root of this toolkit repo. Load `.env` first:

```bash
set -a; [ -f .env ] && . ./.env; set +a
bash scripts/setup-tools.sh >/dev/null && source .tools/env.sh
bash scripts/doctor.sh
```

## Phases and gates

Work through the phases in order. Each phase has a gate: do not start the next phase
until the gate passes. Each phase has its own skill with the details.

| # | Phase | Skill | Gate (must be true to continue) |
|---|---|---|---|
| 0 | Brief | this file | `brief.md` answers the questions below |
| 1 | Intake | `project-intake` | working copy in `work/<slug>/source`, `inventory.md` written |
| 2 | Analysis | `app-analysis` | `app-map.md`: routes, selectors, data dependencies, auth, 4–7 story moments |
| 3 | Bootstrap | `local-bootstrap` | app runs locally, health check passes, `bootstrap.md` has exact up/down commands |
| 4 | Seed | `demo-seed-data` | every page in the story renders non-empty invented data; seed manifest written |
| 5 | Storyboard | `storyboard-and-script` | `brand/brand.css` extracted; `storyboard.md` maps every sentence to a visible proof; `narration.json` written |
| 6 | Narration | `narration-elevenlabs` | `audio/manifest.json` with measured durations (skip if silent video) |
| 7 | Recording | `record-scenes` | every scene take has zero misses and shows its proof at the right time |
| 8 | Edit, QA, deliver | `edit-and-deliver` | `final/*.mp4` passes `av_check.py` and a frame-by-frame look; `REPORT.md` written |

## Phase 0: the brief

Ask the user once, in one message, only for what you cannot infer. Use defaults for the rest and
state them in `brief.md`:

- target project: path or git URL (required)
- audience and goal (default: prospective users; show the core value in the first 10 s)
- language of the voice-over, cards and chips (default: `NARRATION_LANGUAGE` or English) and,
  separately, the language the UI is filmed in and the seed data is written in (default:
  `DEMO_LANGUAGE`; film the UI in a language it really ships in)
- length (default: 60–90 s; the measured narration decides the final runtime)
- must-show features / must-avoid areas (default: pick from analysis)
- voice style (default: warm, confident narrator; see `narration-elevenlabs`)
- call to action and URL for the closing card (default: none)
- delivery (default: local file, opened when done; optional S3-compatible upload)
- look (default: the product's own brand from its website via `brand.mjs`, stage + cards +
  music; a plain screen recording only when the user asks for one)

## Workspace

Everything for one job lives in `work/<slug>/` (the default `DEMO_WORKDIR=./work`):

```
work/<slug>/
  source/            isolated working copy of the project (never the original)
  brief.md           phase 0
  inventory.md       phase 1
  app-map.md         phase 2
  bootstrap.md       phase 3 (up/down commands, ports, credentials of the demo user)
  seed/              phase 4 (seed script, seed-manifest.json)
  storyboard.md      phase 5
  narration.json     phase 5
  audio/             phase 6 (mp3 per segment, manifest.json, optional .srt)
  scenes/NN-name.json  phase 7 recorder configs
  raw/               phase 7 takes (.webm + .webm.json sidecars)
  clips/             phase 8 finished clips (.mp4)
  qa/                phase 8 frames, contact sheets, av reports
  final/             phase 8 deliverables
  job.json           optional produce.mjs settings (bpm, music, loudness, sfx, output)
  REPORT.md          phase 8
```

## Hard rules

1. **Never touch production or anything shared.** Run only local services. If the project's
   config points at a remote database, API or bucket, replace it with a local one or a stub.
   Never use credentials you find in the project for anything but local services you started.
2. **Invented data only.** Never copy real customer, user or personal data into seeds, legends,
   narration or screenshots. Mask any real identity that appears in the UI (see `record-scenes`).
3. **Never modify the original project.** Work in `work/<slug>/source`. Never commit to, push to
   or open pull requests against the project's remote.
4. **Secrets stay secret.** Never print API keys or tokens; never write them into scene files,
   reports or logs. `.env` is git-ignored; keep it that way.
5. **No silent failures.** A `MISS` in a recording, an empty page, a raw translation key, a broken
   image, a console crash overlay or an A/V drift is a defect: fix it and redo that scene. Only
   after two honest fix attempts may you ship with a defect, and the report must say so.
6. **Spend deliberately.** Run `narrate.mjs --dry-run` before generating audio, keep narration
   under ~2,500 characters per minute of video, and rely on the built-in cache when re-running.
7. **Clean up.** Stop every server and container you started, remove worktrees you created, and
   record the cleanup in `REPORT.md`. Keep `work/<slug>/final/` unless asked otherwise.

## Command map

| Step | Command |
|---|---|
| tools | `bash scripts/setup-tools.sh && source .tools/env.sh && bash scripts/doctor.sh` |
| working copy | `bash scripts/prepare-project.sh <path-or-url> [slug] [--ref <ref>]` |
| second repo | `bash scripts/prepare-project.sh <path-or-url> <slug> --as <name>` (API + web client) |
| inventory | `node scripts/inventory.mjs work/<slug>/source > work/<slug>/inventory.md` |
| brand kit | `node scripts/brand.mjs https://product.example work/<slug>/brand` |
| seed photos | `node scripts/images.mjs work/<slug>/seed/images.json` |
| voices | `node scripts/voices.mjs --accent american --use-case narration` |
| narration | `node scripts/narrate.mjs work/<slug>/narration.json [--dry-run] [--timestamps]` |
| size scenes | `node scripts/fit-scenes.mjs work/<slug>/audio/manifest.json work/<slug>/scenes/*.json --bpm 100` |
| music + SFX | `python3 scripts/music.py --duration <total> --bpm 100 --out work/<slug>/audio/music.wav --sfx-dir work/<slug>/audio/sfx` |
| record | `node scripts/record.mjs work/<slug>/scenes/01-intro.json` |
| clip | `node scripts/build-clip.mjs work/<slug>/scenes/01-intro.json` |
| join | `node scripts/concat.mjs work/<slug>/final/<slug>-demo.mp4 work/<slug>/clips/*.mp4 --music work/<slug>/audio/music.wav --loudness -16 --open` |
| frames | `bash scripts/qa-frames.sh work/<slug>/final/<slug>-demo.mp4 work/<slug>/qa/final 16` |
| checks | `python3 scripts/av_check.py work/<slug>/final/<slug>-demo.mp4 --expect-audio` |
| everything after the scenes | `node scripts/produce.mjs work/<slug> --open` (`--only 04`, `--record all`, `--reveal`) |
| voice vs action | `node scripts/sync-report.mjs work/<slug>/scenes/04-report.json` |
| compare screenshots | `node scripts/sheet.mjs work/<slug>/qa/probe.jpg work/<slug>/probe/*.png --labels` |
| gif | `bash scripts/to-gif.sh work/<slug>/final/<slug>-demo.mp4 work/<slug>/final/<slug>.gif 3 6` |
| upload | `bash scripts/deliver-s3.sh work/<slug>/final/<slug>-demo.mp4` |

## Never stop for a missing key

The goal is an opened video without a human in the loop. Narration falls back from ElevenLabs
to OpenAI to macOS `say`; seed photos come from `images.mjs` or the project's own seed assets;
music and sound effects are generated offline. Report which fallback was used instead of
waiting. Stop only for decisions that change what is true in the video (for example a UI that
exists in one language only: film the real UI and narrate in the brief's language).

## Progress reporting

Report progress from artifacts, not intentions: "3 of 6 scenes recorded with zero misses", not
"recording is going well". When you finish, reply with the path (or verified link) of the final
video, its duration and resolution, the list of scenes, what was checked, anything you could not
fix, and what you cleaned up.
