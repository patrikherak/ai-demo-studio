# ai-demo-studio

Skills and scripts that let an LLM coding agent turn **any software project** — a folder on
your disk or a git URL — into a **finished, narrated demo video**, end to end:

1. find or clone the project into an isolated working copy
2. read the code to understand the product and map its screens
3. bootstrap it locally with local services only
4. seed realistic, fully synthetic demo data
5. write a storyboard where every spoken sentence has visible proof on screen
6. generate the voice-over (ElevenLabs, OpenAI or offline) and time every word
7. record every scene with Playwright at full quality (cursor, callouts, highlights, masking)
8. compose a branded product film: the target's own colours and fonts, 3D device shots,
   auto-zoom, floating UI chips, kinetic type, animated infographics, montage, music and SFX
9. cut, mix, master, check and open the final MP4 (plus GIF / subtitles if wanted)

It is agent-agnostic: the skills are plain `SKILL.md` files, `AGENTS.md` is the entry point, and
the scripts are dependency-free Node, Bash and Python.

## Quick start

```bash
git clone https://github.com/patrikherak/ai-demo-studio.git
cd ai-demo-studio
cp .env.example .env              # add ELEVENLABS_API_KEY (skip it for silent videos)
bash scripts/setup-tools.sh       # Playwright + Chromium + ffmpeg, no sudo
bash scripts/doctor.sh            # what is ready, what is missing
bash scripts/selftest.sh          # records the bundled sample app end to end (~30 s)
```

Then open the folder with your coding agent and ask, for example:

> Make a 60-second narrated demo video of `~/code/my-saas`. Audience: small agency owners.
> Show how a project goes from brief to invoice. American female voice.

> Clone `https://github.com/acme/tasks-app`, bootstrap it with demo data and record a
> 90-second product walkthrough in German.

The agent reads `AGENTS.md`, asks you once for anything it cannot infer, then works through
the phases and hands back `work/<slug>/final/<slug>-demo.mp4` with a short report.

**Claude Code:** skills are picked up from `.claude/skills` (a link to `skills/`). To use them in
other projects too, copy or link the folders into `~/.claude/skills/`.
**Other agents** (Codex, Cursor, Aider, Gemini CLI, custom harnesses): point them at `AGENTS.md`.

## What is inside

```
AGENTS.md                      entry point for agents (CLAUDE.md imports it)
.env.example                   every setting, documented
skills/
  demo-video-pipeline/         orchestrator: phases, gates, hard rules, command map
  project-intake/              locate or clone, isolated working copy, inventory
  app-analysis/                product, routes, selectors, data dependencies, story moments
  local-bootstrap/             services, env, install, migrate, run, smoke test
  demo-seed-data/              synthetic, deterministic, time-relative data + cleanup manifest
  storyboard-and-script/       sentence → proof storyboard, narration segments, legends
  narration-elevenlabs/        voice and model choice, cost estimate, cached generation
  record-scenes/               scene format, logged-in recording, masking, strict selectors
  edit-and-deliver/            clips, join, QA, extras, upload, report, cleanup
scripts/
  setup-tools.sh  doctor.sh  selftest.sh
  prepare-project.sh           worktree / copy / clone into work/<slug>/source
  inventory.mjs                stack, services, env keys, migrations, seeds, ports
  brand.mjs                    brand kit (colours, fonts, logo, copy) from the product's website
  images.mjs                   synthetic stock photos for seed data (OpenAI Images, cached)
  voices.mjs  narrate.mjs      voices; narration per segment, mastered, with word timing
  fit-scenes.mjs               size scenes to their narration, sentence and word cues, beat lock
  record.mjs                   Playwright recorder (CDP screencast) and animated card renderer
  build-clip.mjs  concat.mjs   stage compositing, narration + SFX; join, music bed, loudness
  music.py                     offline music bed and UI sound effects (stdlib only)
  qa-frames.sh  av_check.py    frame contact sheets; stream, drift and silence checks
  to-gif.sh  deliver-s3.sh     GIF export; optional S3-compatible upload with verified link
templates/
  cards/card.html              kinetic, logo, title, statement, compare, stats, metric, steps,
                               grid, columns, montage, cta, outro (brand-themed, frame-exact)
  stage/stage.html             browser window or phone on the brand background: tilt, zoom,
                               click ripples, callout cards and chips, enter/exit motion
examples/
  sample-app/                  tiny static app used by the self-test
  sample-job/                  its scenes and narration
```

## How a narrated video is produced

Narration comes first, pictures second. Each narration segment is generated and measured,
`fit-scenes.mjs` sizes every scene to its voice-over, the recorder keeps the scene on screen
at least that long, and `build-clip.mjs` lays the audio on the picture without ever cutting a
sentence. That is what keeps the voice and the screen in sync without manual editing.

```bash
node scripts/narrate.mjs work/app/narration.json --dry-run      # characters, before spending
node scripts/narrate.mjs work/app/narration.json                 # mp3 per segment + manifest
node scripts/fit-scenes.mjs work/app/audio/manifest.json work/app/scenes/*.json
for s in work/app/scenes/*.json; do node scripts/record.mjs "$s" && node scripts/build-clip.mjs "$s"; done
node scripts/concat.mjs work/app/final/app-demo.mp4 work/app/clips/*.mp4
python3 scripts/av_check.py work/app/final/app-demo.mp4 --expect-audio
```

## The production look

A walkthrough recorded as-is looks like a screen capture. `ai-demo-studio` turns it into a
product film in three layers, all rendered deterministically frame by frame in Chromium:

- **Brand:** `brand.mjs <website>` extracts colours, fonts, logo and headline copy into
  `brand.css`; every card, stage and callout uses those tokens.
- **Stage:** a scene with `"stage"` places the recording in a browser window or a phone on the
  brand background, optionally tilted in 3D, zooms in on clicks and typing, adds click ripples
  and turns legend steps into floating cards or chips outside the app.
- **Cards:** scenes with `"card"` render kinetic typography, a logo reveal, counters, before
  and after comparisons, step flows, feature grids, a beat-cut montage and an outro, timed to
  the narration's sentences and words (`"at": "word:tickets"`).

Sound follows the same idea: narration is mastered per segment, `music.py` writes a bed at an
exact tempo (scenes are rounded to whole beats), `build-clip.mjs` adds UI sound effects at the
recorded clicks and callouts, and `concat.mjs` ducks the music under the voice and masters the
mix to -16 LUFS.

## Safety defaults

- Local services only; production systems and shared resources are never touched.
- Synthetic data only; real identities that appear on screen are masked.
- The target project is never modified, committed to or pushed; work happens in a copy.
- Secrets live in `.env` (git-ignored) and are never printed.
- A missing selector fails the take instead of silently producing a broken scene.

## Requirements

Node ≥ 18, Python 3, git; Docker for projects that run their services in containers.
`setup-tools.sh` installs Playwright, Chromium and (if needed) ffmpeg into `.tools/` without
sudo. For narration an [ElevenLabs](https://elevenlabs.io) key (best voices) or an OpenAI key
(voice, word timing and synthetic seed photos); without either, macOS `say` stands in, so a run
never stops for a missing key. The optional upload needs the AWS CLI.

## Costs

ElevenLabs bills per character. A 60–90 s video is usually 1,000–2,500 characters. Narration
is cached per segment, so revisions only pay for the sentences that changed; run
`narrate.mjs --dry-run` to see the count first. With OpenAI, a 2-minute narration plus word
alignment costs a few cents, and ten synthetic photos well under a dollar. Music and sound
effects are generated offline for free.

## License

MIT
