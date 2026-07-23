# Human voiceover script

Target: one continuous take between **145 and 151 seconds**. Play
`output/hammadev-build-week-demo-clean.mp4` with its audio muted while recording,
and follow the scene changes. Leave a short natural breath between sections.

The script is intentionally first-person and explicitly covers the three
submission requirements: what was built, how Codex was used, and how GPT-5.6
was used.

## 00:00–00:13 — What I built

Hi, I built HammaDev: local project memory for Codex, Claude Code, and Grok. It
lets me change coding agents without losing the decisions, evidence, and next
action that belong to my repository.

## 00:13–00:29 — The problem

Here is the problem. When I switch agents today, I either start over or paste a
huge transcript. The next agent can still repeat finished work, trust stale
claims, or miss changes in Git.

## 00:29–00:52 — The solution

HammaDev turns that history into a small continuation contract stored locally
beside the project. It separates agent claims from command results and
repository evidence, records Git drift, and gives the next agent one clear
place to continue. There is no account, cloud service, telemetry, or transcript
upload.

## 00:52–01:24 — Working demo

Here is the working flow. Setup check previews the hooks and Git ignore changes
without writing anything. After I approve them, native lifecycle hooks save
memory before compaction and restore bounded context when a session starts.
When I run Hamma switch Claude, it checkpoints the exact Codex session and
prepares the continuation. Claude receives the original goal, completed work,
verification, risk, repository state, and the next action. It does not need the
raw transcript.

## 01:24–01:52 — How I used Codex and GPT-5.6

During the July eighteenth-to-twentieth Build Week sprint, I used Codex as the
hands-on engineering agent. It inspected the existing TypeScript architecture,
implemented changes across the adapters and shared core, ran focused tests, and
replayed failures. I used GPT-5.6 inside Codex for the harder reasoning:
designing evidence and readiness rules, separating the pre-event baseline, and
finding cases where completed work would restart. This was useful because Codex
kept implementation, tests, and repository evidence in one loop, while GPT-5.6
helped me challenge design decisions before accepting code.

## 01:52–02:13 — Technical implementation

Under the hood, each agent has its own parser, but every parser feeds one shared
state model. Memory revisions are immutable and written atomically. Exact
session binding avoids guessing from the newest transcript, and initial context
has an eight-kilobyte hard limit. Deeper history is recalled locally only when
needed.

## 02:13–02:31 — Close

HammaDev turns agent switching from a context dump into a trustworthy
continuation. Sessions belong to agents; memory belongs to the project. The
public beta is on npm, the source is on GitHub, and HammaDev is ready to test
for OpenAI Day.

## Recording notes

- Record in a quiet, soft room; a closet or curtains reduce echo.
- Keep the microphone 15–20 cm away and slightly to one side of your mouth.
- Speak conversationally at about 120 words per minute. Do not imitate an ad.
- Record WAV, M4A, or high-quality MP3. Avoid music and noise reduction filters.
- If you make a mistake, pause, repeat the sentence, and continue; the take can
  be edited before it is placed in the video.
