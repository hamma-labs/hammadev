# HammaDev Product Hunt launch kit

This directory contains the launch-ready local package for OpenAI Day on
July 23, 2026.

## Submission source

Use [`submission.json`](submission.json) as the authoritative source for the
Product Hunt fields. It contains the product name, tagline, description, links,
tags, pricing, shoutouts, gallery order, and maker comment.

The recommended gallery order is:

1. `assets/gallery-01-product.png` — the real beta landing experience;
2. `assets/gallery-02-continuity.png` — the core value proposition;
3. `assets/gallery-03-openai-day.png` — the exact GPT-5.6 contribution;
4. `assets/gallery-04-proof.png` — technical and privacy proof.

Product Hunt's required square thumbnail is `assets/thumbnail.png`. The website
social card is `assets/og-image.png`, and the YouTube cover is
`assets/youtube-thumbnail.png`.

The final Product Hunt-specific launch video is
`output/hammadev-product-hunt-launch.mp4`, with uploadable captions at
`output/hammadev-product-hunt-launch.srt`. Regenerate both with
`pnpm product-hunt:video`.

## Regenerate and verify

```bash
pnpm product-hunt:assets
pnpm product-hunt:check
pnpm website:test:e2e
```

The renderer fails when an image has the wrong dimensions or exceeds its target
file-size limit. The validator checks field limits, gallery count, the website
social-card copy, the demo streams, and account-bound fields.

## Account-bound launch steps

These cannot be completed from the repository alone:

1. deploy the current `website/dist/` output to `hammadev.nematov.com`;
2. upload the recommended video and captions to YouTube;
3. place the returned YouTube URL in `submission.json`;
4. sign in to Product Hunt through the OpenAI Day contest page;
5. add the maker username and schedule or launch the post;
6. place the final Product Hunt URL in `submission.json`;
7. send the prepared outreach messages to real testers and communities.

Run `pnpm product-hunt:check` after filling the three blank fields. A clean run
then proves the complete local launch package is internally consistent.

## Source artwork

The two abstract continuity illustrations in `source/` were generated with the
built-in image-generation workflow using the deployed HammaDev page as a style
reference. The final launch assets add deterministic HTML typography and product
copy so names, claims, and event provenance remain exact.
