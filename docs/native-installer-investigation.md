# Native Installer Investigation

## Problem

HammaDev currently requires Node.js 22.12+ and npm/pnpm for installation. This
creates a double barrier: users who don't have Node must install it, and users
who have the wrong version must upgrade.

Since HammaDev's value proposition is tool-level infrastructure for coding agent
users, the installation friction should be as close to zero as possible.

## Options evaluated

### 1. Single-binary via Node.js SEA (Single Executable Applications)

**How:** Bundle the CLI + Node runtime into one binary using Node's experimental
SEA feature (stable since Node 20).

**Pros:**
- No Node requirement for end users
- Single file download: `curl -fsSL ... | sh` or scoop/brew tap
- ~50MB binary (Node runtime + app code)
- Official Node feature, no third-party build tool

**Cons:**
- Node 20+ SEA is stable but not widely used for production CLIs yet
- ~50MB binary is large compared to npm install (~2MB)
- Must build per-platform (linux-x64, linux-arm64, darwin-x64, darwin-arm64, win-x64)
- Native module support is limited (but Hamma has no native modules)
- Update mechanism would need a separate solution

**Recommendation:** Best option for removing the Node barrier completely. The
app has zero native dependencies, making it ideal for SEA.

### 2. Compile via pkg, nexe, or Bun

**How:** Use `pkg` (Vercel) or `bun build --compile` to create standalone binaries.

**Pros:**
- Mature tooling (pkg has wide adoption)
- Bun compile produces smaller binaries (~30MB)
- Cross-compilation from one platform

**Cons:**
- `pkg` is no longer actively maintained
- Bun may have subtle compatibility differences with Node APIs
- Still need per-platform builds
- `nexe` has known issues with ESM

**Recommendation:** Bun is interesting but introduces risk of subtle differences.
Prefer Node SEA for reliability.

### 3. Shell-script installer + managed Node

**How:** A shell script downloads a specific Node version into `~/.hamma/node/`
and symlinks `hamma` to run with that Node.

**Pros:**
- User never sees Node.js directly
- Small initial download (~20MB compressed Node)
- Can auto-update both Node and Hamma
- No separate Node installation required
- Follows the Deno/Bun install pattern

**Cons:**
- Another managed runtime directory on disk
- Must handle PATH, shell integration, upgrades
- Windows requires PowerShell equivalent
- Security: users must trust the install script

**Recommendation:** Good middle ground. Lighter than SEA, more portable than npm.
This is how `fnm` and `volta` work internally.

### 4. OS package managers (Homebrew, Scoop, apt)

**How:** Publish to Homebrew (macOS/Linux), Scoop (Windows), or create a .deb.

**Pros:**
- Familiar installation pattern for each platform
- Handles updates, PATH, and cleanup
- Can depend on Node via the package manager

**Cons:**
- Significant maintenance burden (3+ package formats)
- Slow release propagation (Homebrew review, apt repository setup)
- Still requires Node unless bundled

**Recommendation:** Worth doing for discoverability, but not as the primary
install path. Bundle Node in the formula/package.

### 5. npx (zero-install)

**How:** Users run `npx hammadev@beta` every time, or alias it.

**Pros:**
- Zero installation for users who already have Node
- Always latest version
- Works today with no changes

**Cons:**
- Slow startup (npx download + extract on first use)
- Still requires Node
- No persistent install for hooks/skills

**Recommendation:** Good for trial, not for daily use. Document as an alternative.

## Recommended approach

**Phase 1 (beta.3):** Keep npm as primary. Document `npx` for trial. Lower Node
requirement to 20 (done).

**Phase 2 (RC):** Add a shell-script installer that manages its own Node:
```bash
curl -fsSL https://hammadev.com/install.sh | sh
```
This downloads a minimal Node 22 binary into `~/.hamma/` and installs Hamma
from npm into that prefix. The `hamma` command is symlinked to PATH.

**Phase 3 (1.0):** Add Node SEA binaries for zero-dependency installation.
Publish to Homebrew and Scoop. The shell installer detects architecture and
downloads the appropriate SEA binary directly.

## Implementation notes for Phase 2 (shell installer)

```bash
#!/bin/sh
set -e
HAMMA_DIR="${HOME}/.hamma"
NODE_VERSION="22.12.0"
ARCH=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

# Download Node if not present
if [ ! -x "${HAMMA_DIR}/node/bin/node" ]; then
  mkdir -p "${HAMMA_DIR}/node"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${OS}-${ARCH}.tar.xz" \
    | tar -xJ --strip-components=1 -C "${HAMMA_DIR}/node"
fi

# Install Hamma
"${HAMMA_DIR}/node/bin/npm" install -g hammadev@beta --prefix "${HAMMA_DIR}"

# Symlink
ln -sf "${HAMMA_DIR}/lib/node_modules/hammadev/dist/cli.js" "${HAMMA_DIR}/bin/hamma"

echo "Add ${HAMMA_DIR}/bin to your PATH, or run:"
echo "  export PATH=\"${HAMMA_DIR}/bin:\$PATH\""
```

## Security considerations

- The install script must be served over HTTPS with checksum verification.
- Node binaries should be verified against official SHA-256 checksums.
- The installer should not require sudo/root.
- Update mechanism should verify signatures.
