# OpenAI Build Week video submission kit

This directory contains a complete, editable HammaDev demo-video package.

## Deliverables

- `output/hammadev-build-week-demo.mp4` — synthetic-voice timing preview; **do not submit this version**.
- `output/hammadev-build-week-demo-clean.mp4` — the same draft without burned-in captions.
- `output/captions.srt` — uploadable YouTube captions.
- `voiceover-script.md` — natural first-person recording script mapped to the visuals.
- `replace-voiceover.mjs` — replaces the preview voice, normalizes a real recording,
  and creates the human-voice submission file.
- `render-edge.mjs` — produces a natural male-voice draft with Edge TTS using
  `en-US-AndrewMultilingualNeural` and speech-timed captions.
- `scenes.json` — narration source, split by scene.
- `deck.html` — editable 1920×1080 visual deck.
- `render.mjs` — deterministic local renderer using Playwright and FFmpeg.

The generated voice is a mechanical timing draft and should not be submitted.
Record `voiceover-script.md` as one continuous 145–151 second take, then run:

```bash
node docs/video-submission/replace-voiceover.mjs /path/to/my-voice.wav
```

The output is `output/hammadev-build-week-demo-human.mp4`. The command removes
the synthetic audio completely, applies conservative speech filtering and
loudness normalization, adds human-script captions, and preserves the 2:31
runtime.

For a natural male TTS draft instead, run:

```bash
node docs/video-submission/render-edge.mjs
```

When only one narration scene and its frame changed, reuse the verified
unchanged segments and rebuild that scene plus the final concatenation:

```bash
node docs/video-submission/render-edge.mjs --scene close
```

This creates `output/hammadev-build-week-demo-edge.mp4`. Edge TTS requires an
internet connection. The first-person founder recording remains the strongest
submission choice when available. For the current Product Hunt launch, use the
Edge cut only when a founder recording cannot be produced in time; never upload
the synthetic timing preview.

## Required factual review before upload

Confirm this narration sentence is accurate for the Build Week sessions:

> During Build Week, I used GPT five point six through Codex as an engineering partner.

The public competition requires audio explaining how both Codex and GPT-5.6 were
used. If a different model or workflow was used, edit the `buildweek` narration
and matching slide before publishing. The video deliberately distinguishes the
Build Week additions from HammaDev's pre-event baseline.

## Recommended YouTube metadata

**Title**

HammaDev — Project Memory for AI Coding Agents | OpenAI Build Week 2026

**Description**

HammaDev is a local continuity layer for Codex, Claude Code, and Grok. It turns
native agent sessions into compact, evidence-aware repository memory so the next
agent can continue without redoing completed work or trusting stale context.

The demo shows previewable setup, exact-session lifecycle checkpoints, bounded
continuation context, Git reconciliation, evidence provenance, and persistent
project memory. HammaDev is open source and available as a public npm beta.

- Website: https://hammadev.nematov.com/
- Source: https://github.com/hamma-labs/hammadev
- Install: `npm install -g hammadev@beta`

Built during OpenAI Build Week with Codex and GPT-5.6. HammaDev existed before
the event; the repository's Build Week engineering log identifies the baseline
and the event-specific additions.

## Submission checklist

- Confirm the GPT-5.6/Codex narration is factually exact.
- Watch the entire final MP4 and check audio, captions, URLs, and CLI claims.
- Upload to YouTube as **Public** or **Unlisted**, never Private.
- Verify the YouTube duration remains under three minutes.
- Add the full YouTube URL to the Product Hunt launch.
- Use the prepared Product Hunt gallery and maker comment under
  `docs/product-hunt/`.
- Keep the README setup, sample data, supported platforms, and test steps easy
  to find.

## Render again

From the repository root:

```bash
node docs/video-submission/render.mjs
```

Requirements: FFmpeg with the `flite` and `subtitles` filters, plus the website
workspace's Playwright installation and Chromium browser.
