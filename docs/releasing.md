# Releasing HammaDev

HammaDev publishes from GitHub Actions through npm Trusted Publishing. The
workflow uses short-lived OpenID Connect credentials, so routine releases do
not need an npm access token or authenticator code.

## One-time npm configuration

An npm package owner must establish the trust relationship once:

1. Open the `hammadev` package settings on npmjs.com.
2. Under **Trusted Publisher**, choose **GitHub Actions**.
3. Enter these values exactly:

   - Organization or user: `xayrullonematov`
   - Repository: `hammadev`
   - Workflow filename: `publish.yml`
   - Environment: leave blank
   - Allowed action: `npm publish`

The workflow filename is case-sensitive. npm does not validate the relationship
until a publish is attempted.

## Release process

1. Update and commit the version in `package.json`.
2. Push `main` and wait for the normal CI matrix to pass.
3. Create and push an annotated matching tag, for example:

   ```bash
   git tag -a v0.1.0-alpha.8 -m "HammaDev 0.1.0-alpha.8"
   git push origin v0.1.0-alpha.8
   ```

The tag starts `.github/workflows/publish.yml`. The job:

- checks out the exact tag with full history;
- verifies the tag, package version, and checked-out commit agree;
- uses Node 24 and a pinned OIDC-capable npm CLI;
- installs the frozen lockfile, typechecks, tests, and exercises the packed npm
  artifact in an isolated environment;
- refuses to overwrite an existing registry version; and
- publishes with npm OIDC and automatic provenance.

For a tag created before the workflow existed, dispatch the workflow manually:

```bash
gh workflow run publish.yml -f release_tag=v0.1.0-alpha.6
```

## Distribution-tag policy

Prerelease versions containing `-` publish to `alpha`. Stable versions publish
to `latest`. During the alpha series, the canonical installation command is:

```bash
npm install -g hammadev@alpha
```

npm Trusted Publishing currently authorizes `npm publish`, not `npm dist-tag`.
The workflow therefore does not keep a long-lived write token merely to mirror
an alpha release onto `latest`. If mirroring is intentionally required, an npm
owner must perform that separate authenticated operation and record it in the
release notes.

## Security boundaries

- The publish job uses GitHub-hosted runners and `id-token: write` only for the
  release job.
- No `NPM_TOKEN` is stored in GitHub Actions.
- Release dependency caching is disabled.
- The concurrency guard prevents overlapping publishes.
- The package allowlist and installed-package smoke protect against shipping
  workspace-only source, tests, `AGENTS.md`, or local diagnostic evidence.
- Tag protection or a GitHub deployment environment can add an approval layer
  without reintroducing an npm token.

References: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/),
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/), and
[GitHub OIDC security](https://docs.github.com/actions/concepts/security/openid-connect).
