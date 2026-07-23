# OpenAI Day outreach kit

Product Hunt permits sharing the launch, but its guidance says to ask people to
visit, try, comment, or provide feedback—not to request votes.

Replace `[PRODUCT HUNT URL]` only after the launch is live.

## Direct message to an existing tester

```text
I launched HammaDev for OpenAI Day today. It keeps project decisions,
verification, Git state, and the next action available when you move between
Codex, Claude Code, and Grok—locally, without a HammaDev backend.

Would you try the one-command beta on a non-sensitive repository and tell me
where the handoff feels unclear or untrustworthy? The launch page is
[PRODUCT HUNT URL]. Honest comments and failure cases would be especially
helpful.
```

## X post

```text
HammaDev is live for OpenAI Day: local project memory for Codex, Claude Code,
and Grok. Keep decisions, verification, Git state, and the next action across
sessions—without a backend. Free beta: [PRODUCT HUNT URL]

I’d love feedback on the handoff model.
```

## LinkedIn or community post

```text
Today I’m launching HammaDev for OpenAI Day.

The problem is simple: code persists when an AI coding session ends, but the
reasoning around it often does not. Switching from Codex to Claude Code or Grok
means reconstructing decisions, verification, risks, and the next action.

HammaDev stores compact, evidence-aware project memory locally beside the
repository. During Build Week I used Codex and GPT-5.6 to harden the evidence
model and find cases where completed work could accidentally restart.

The beta is free and open source. I’m looking for honest feedback on hook trust,
handoff clarity, and failure cases—not polished praise:
[PRODUCT HUNT URL]
```

## GitHub or developer-community post

```text
HammaDev beta: local cross-agent project memory

I’m testing a TypeScript CLI that checkpoints coding-agent work and continues it
across Codex, Claude Code, and Grok. It stores bounded memory locally, separates
assistant claims from command/repository evidence, and checks Git drift before a
new agent continues.

Install: npm install -g hammadev@beta
Start: hamma
Source: https://github.com/hamma-labs/hammadev
OpenAI Day launch: [PRODUCT HUNT URL]

If you test it, please share the smallest sanitized failure case you find.
```

## Launch-day response prompts

- “Which agent pair would you switch between first?”
- “What evidence would you need before trusting an automatic continuation?”
- “Would you prefer manual memory attach by default, or explicit opt-in hooks?”
- “If setup failed, which operating system, Node version, and agent were you
  using?”

Never purchase engagement, use voting groups, or send identical unsolicited
messages at scale.
