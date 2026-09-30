---
name: storyboard-and-script
description: Turn an app map and a brief into a scene-by-scene storyboard where every spoken sentence has visible proof on screen, plus the narration segments file for text-to-speech and the on-screen legend copy. Use after the demo data is in place and before generating narration or recording.
---

# Storyboard and script

Goal: `work/<slug>/storyboard.md` and `work/<slug>/narration.json`. The storyboard is the
contract between voice and picture: each sentence is spoken while its proof is visible.

## Structure (60–90 s default)

1. **Hook (0–8 s):** the outcome, in the viewer's words. One sentence, no product tour yet.
   Often shown as a clean opening screen or the most striking view of the app.
2. **Problem (optional, ≤ 8 s):** what is painful without the product.
3. **Moments (3–5 scenes):** each scene proves one claim from `app-map.md`: navigate, show,
   interact, highlight the proof.
4. **Payoff:** the result the viewer gets (time saved, clarity, fewer errors), visible on screen.
5. **Close (≥ 3 s after the last word):** product name, one-line promise, call to action/URL if
   the brief has one.

Keep each scene under 60 s of recording; split longer ones at sentence boundaries.

## The production grammar

Professional product films alternate a few visual types. Plan each scene as one of them:

| type | scene | use for |
|---|---|---|
| kinetic hook | `card.template: "kinetic"`, dark | the problem in 2–3 short lines, one line per sentence |
| logo reveal | `card.template: "logo"` | the promise, right after the hook |
| feature beat | `stage` with `layout: "phone"` or `"browser"`, `tilt`, `eyebrow` + a 2–4 word `title` | every app moment; the panel states the claim, chips prove details |
| infographic | `stats`, `metric`, `steps`, `compare`, `grid`, `columns` cards | numbers, flows, before/after, feature overviews |
| montage | `card.template: "montage"` with screenshots | a fast list of capabilities, one screen per spoken word |
| outro | `card.template: "outro"` | two-line claim, call-to-action button, URL |

Alternate light and dark scenes (`"theme": "dark"`), put the phone left and right in turns, and
keep headlines short: "Reported in **under a minute.**" (`**…**` renders in the brand colour).
Mobile-first apps look best in `layout: "phone"`; back-office tools in `layout: "browser"`.
Film the UI in the language it really ships in; narrate and write cards and chips in the
brief's language.

## Storyboard table

```
| scene | segment id | spoken sentence(s) | route / state | action | proof visible while speaking | legend (optional) |
|---|---|---|---|---|---|---|
| 01-hook | s01-hook | "Every Monday your team loses an hour hunting for status updates." | /dashboard | none | dashboard with this week's summary | — |
| 02-board | s02-board | "Here, every project's health is on one board." | /projects | highlight status column | status column with 6 projects, 1 red | "Live project health" |
```

Rules:

- **Proof at the same time as the claim.** A later scene does not prove an earlier sentence. If a
  sentence needs something below the fold, scroll or split the sentence.
- **One idea per sentence, one screen change per sentence boundary.** Never cut mid-sentence.
- **Say only what is visible.** Numbers, names and states in the voice must match the seeded data
  exactly. If a category is not on screen, do not name it.
- **No invented features.** Everything claimed exists in this build of the app.

## Writing for the ear

- Short sentences (8–18 words), active voice, second person ("you see", "your team").
- Spell out what a voice might misread: numbers with units ("twelve percent", "three
  forty-five pm"), abbreviations ("S-Q-L" or avoid it), version strings, URLs (say the domain in
  words, show the full URL on the closing card).
- No filler ("simply", "just", "very"), no stacked adjectives, no exclamation marks.
- Aim for ~150 words per minute; ~2,000–2,500 characters per minute is the upper bound.
- Legends (on-screen callouts) are shorter than the voice: a 2–5 word title and at most one line
  of text, and they add a detail rather than repeating the sentence verbatim.

## narration.json

```json
{
  "voiceId": "",
  "modelId": "eleven_multilingual_v2",
  "segments": [
    { "id": "s01-hook", "text": "Every Monday your team loses an hour hunting for status updates." },
    { "id": "s02-board", "text": "Here, every project's health is on one board." }
  ]
}
```

- Segment ids are stable (`sNN-name`); a scene references its segments by id.
- One segment = one scene or one sub-scene. Several segments per scene are fine when the
  picture changes between sentences.
- Empty `voiceId` falls back to `ELEVENLABS_VOICE_ID`.

## Timing cards to the voice

`fit-scenes.mjs` writes the start of every spoken sentence (`cues`) and, when word timing is
available, every word (`words`) into the scene. In cards use `"at": "cue:1"`, `"at":
"word:tickets"`, `"word:demo:2"` (second occurrence) or an offset such as
`"word:customers+0.4"`. Kinetic lines default to one line per sentence. A montage item per
spoken word is the most convincing sync there is.

## Silent video

If there is no narration, write the same storyboard with legends carrying the message and give
each scene an explicit `minDurationMs` (roughly 1 s per 12 characters of legend text + 1.5 s).

## Gate

Every sentence has a scene, a route/state and a visible proof; `narration.json` validates with
`node scripts/narrate.mjs work/<slug>/narration.json --dry-run`. Continue with
`narration-elevenlabs` (or `record-scenes` for a silent video).
