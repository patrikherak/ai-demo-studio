# Agent instructions

This repository is a toolkit for LLM coding agents: given a software project (a folder on disk or
a git URL), you produce a finished, narrated demo video of it, end to end, on this machine.

## Start here

1. Read `skills/demo-video-pipeline/SKILL.md`. It is the orchestrator: phases, gates, workspace
   layout, hard rules and the command map. Load the phase skills from `skills/` as you reach them.
2. Prepare the machine:
   ```bash
   cp -n .env.example .env        # then fill ELEVENLABS_API_KEY (optional for silent videos)
   set -a; . ./.env; set +a
   bash scripts/setup-tools.sh && source .tools/env.sh
   bash scripts/doctor.sh
   ```
3. Ask the user for the brief once (see the orchestrator), then work through the phases without
   waiting for further input unless a gate cannot be passed. Once scenes exist,
   `node scripts/produce.mjs work/<slug> --open` takes them to a checked, opened video.

## Skills

| Skill | When |
|---|---|
| `skills/demo-video-pipeline` | always first; the plan and the rules |
| `skills/project-intake` | find or clone the project, isolated working copy, inventory |
| `skills/app-analysis` | understand the product; routes, selectors, data dependencies, story moments |
| `skills/local-bootstrap` | run it locally with local services only |
| `skills/demo-seed-data` | synthetic, deterministic data that makes every screen look alive |
| `skills/storyboard-and-script` | sentence → proof storyboard, narration segments, legends |
| `skills/narration-elevenlabs` | voice, model, generate and measure narration |
| `skills/record-scenes` | Playwright recording: sessions, cursor, legends, highlights, masking |
| `skills/edit-and-deliver` | clips, join, QA, extras, delivery, report, cleanup |

## Non-negotiables

- Never touch production systems or shared resources; local services only.
- Synthetic data only; mask any real identity that shows up on screen.
- Never modify, commit to or push to the target project; work in `work/<slug>/source`.
- Never print or store secrets outside `.env`.
- A selector miss, empty screen or A/V drift is a defect to fix, not a note in the report.
- Clean up every process, container and worktree you started.

## Conventions for changes to this toolkit

Scripts are dependency-free Node (ESM, Node ≥ 18), Bash and Python 3 standard library; every
script prints usage with `--help`. Keep scene and narration formats backwards compatible, and
document every new option in the skill that owns it.
