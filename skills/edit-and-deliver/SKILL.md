---
name: edit-and-deliver
description: Build finished clips from raw scene takes with narration, join them into the final video, run machine and visual QA (A/V drift, silence, frames, contact sheets), export GIF/subtitles, optionally upload with a verified link, write the report and clean up. Use after scenes are recorded.
---

# Edit, QA and deliver

Goal: `work/<slug>/final/<slug>-demo.mp4` that passes every check below, plus `REPORT.md`.

## 1. Clips

```bash
for s in work/<slug>/scenes/*.json; do node scripts/build-clip.mjs "$s" || break; done
```

`build-clip.mjs` trims the loading lead-in (sidecar `startSec`), encodes H.264 (CRF 20, 30 fps,
yuv420p), lays the scene's narration timeline on a 48 kHz AAC track and gives silent scenes a
silent track so all clips concatenate cleanly. Narration is never cut: if it outlasts the picture
the last frame is held and a `WARN` is printed; more than ~2 s of hold means re-record the scene
with the updated `minDurationMs` instead.

Options: `--width 1920` (default: the scene's viewport width), `--crf 18` for crisper small text,
`--fps 60` for very fast UI motion.

## 2. Look at every clip

```bash
bash scripts/qa-frames.sh work/<slug>/clips/02-board.mp4 work/<slug>/qa/02-board 8
```

Open `qa/02-board/sheet.jpg` and check:

- first frame is the scene's page, fully loaded (no blank, spinner, skeleton, login or error)
- the proof for each sentence is visible while that sentence plays (use `--at` with the times from
  the scene's `audio` timeline to sample exactly those moments)
- invented identities only; masks applied; no real names, e-mails, hostnames or tokens
- target language everywhere, including seeded data; no raw translation keys (`app.title.x`)
- no dev overlays, cookie banners, broken images, cut-off layouts or horizontal scrollbars
- legends readable and not covering the proof

Any failure → fix and re-record that scene only; keep good clips.

## 3. Join

```bash
node scripts/concat.mjs work/<slug>/final/<slug>-demo.mp4 work/<slug>/clips/*.mp4
```

Clips are joined in the order given (name them `01-…`, `02-…`). The result is trimmed to the
video stream when audio drifts more than 0.05 s.

## 4. Machine checks

```bash
python3 scripts/av_check.py work/<slug>/final/<slug>-demo.mp4 --expect-audio --max-silence 3
bash scripts/qa-frames.sh work/<slug>/final/<slug>-demo.mp4 work/<slug>/qa/final 16
```

`av_check.py` must report `"ok": true`: video and AAC audio streams present, drift ≤ 0.05 s, no
unexpected silence longer than 3 s (intentional pauses, such as a silent closing card, can be
accepted explicitly in the report). Look at the final contact sheet once more end to end.

## 5. Extras

- GIF for a README or social post: `bash scripts/to-gif.sh final.mp4 final.gif <start> <duration> 720`
- Subtitles: with `--timestamps` narration, each segment has an `.srt` relative to its start; shift
  them by each segment's absolute time in the final video (scene start + `atMs`) to build one
  `final/<slug>-demo.srt`, or burn them in with ffmpeg's `subtitles` filter if the user asks.
- Vertical/social cuts: record separate scenes with a phone viewport (`390×844`,
  `deviceScaleFactor` 3) rather than cropping the desktop video.

## 6. Deliver

Default: the local file path. Optional upload to S3-compatible storage:

```bash
URL=$(bash scripts/deliver-s3.sh work/<slug>/final/<slug>-demo.mp4)
```

The script range-probes the signed link before printing it. Give the user the link exactly as
printed (never shortened or partially masked) with its expiry.

## 7. REPORT.md and cleanup

```
# Demo video: <product>
- file: work/<slug>/final/<slug>-demo.mp4 (duration, resolution, size)   | link + expiry if uploaded
- scenes: 01-hook 0:00–0:07, 02-board 0:07–0:21, …
- voice: <name> (<voice id>), model <model>, <n> characters generated
- checks: av_check ok, frames reviewed (sheet paths), known deviations
- data: synthetic seed (seed-manifest.json), demo user
- cleanup: server stopped, containers removed, worktree removed, seed removed
```

Cleanup, always, even after a failure: stop the server (`kill $(cat work/<slug>/server.pid)`),
remove containers/volumes you created (`docker compose -p demo-<slug> down -v`, `docker rm -f
demo-<slug>-*`), remove the worktree (`git -C <original> worktree remove work/<slug>/source`),
delete raw takes if space matters. Keep `final/`, `REPORT.md`, `storyboard.md`, `narration.json`,
`audio/` and `scenes/` so the video can be revised cheaply.

## Revisions

Change only what the feedback touches: edit the affected narration segments (the cache
regenerates only those), re-run `fit-scenes.mjs`, re-record only the affected scenes, rebuild
their clips, re-join, re-check. Keep the previous final as `final/<slug>-demo.v1.mp4`.
