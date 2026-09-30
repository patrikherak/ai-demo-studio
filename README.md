# ai-demo-studio

Skills and scripts that let an LLM coding agent turn **any software project** — a folder on
your disk or a git URL — into a **finished, narrated demo video**, end to end:

1. find or clone the project into an isolated working copy
2. read the code to understand the product and map its screens
3. bootstrap it locally with local services only
4. seed realistic, fully synthetic demo data
5. write a storyboard where every spoken sentence has visible proof on screen
6. generate the voice-over with ElevenLabs and measure it
7. record every scene with Playwright (cursor, callouts, highlights, masking)
8. cut, mix, check and deliver the final MP4 (plus GIF / subtitles if wanted)

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
  voices.mjs  narrate.mjs      ElevenLabs voices; narration per segment with measured durations
  fit-scenes.mjs               size scenes to their narration (audio-first)
  record.mjs                   config-driven Playwright recorder
  build-clip.mjs  concat.mjs   finished clips with narration; final join with A/V sync
  qa-frames.sh  av_check.py    frame contact sheets; stream, drift and silence checks
  to-gif.sh  deliver-s3.sh     GIF export; optional S3-compatible upload with verified link
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

## Safety defaults

- Local services only; production systems and shared resources are never touched.
- Synthetic data only; real identities that appear on screen are masked.
- The target project is never modified, committed to or pushed; work happens in a copy.
- Secrets live in `.env` (git-ignored) and are never printed.
- A missing selector fails the take instead of silently producing a broken scene.

## Requirements

Node ≥ 18, Python 3, git; Docker for projects that run their services in containers.
`setup-tools.sh` installs Playwright, Chromium and (if needed) ffmpeg into `.tools/` without
sudo. An [ElevenLabs](https://elevenlabs.io) API key for narration; without one the pipeline
records silent videos with on-screen callouts. The optional upload needs the AWS CLI.

## Costs

ElevenLabs bills per character. A 60–90 s video is usually 1,000–2,500 characters. Narration
is cached per segment, so revisions only pay for the sentences that changed; run
`narrate.mjs --dry-run` to see the count first.

## License

MIT
