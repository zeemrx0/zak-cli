# zak CLI

Install the CLI once. Manage agent guidance kits from independently verified releases.
The CLI ships no kit content and has its own version.

## 1. Install the CLI

Requires Node **26.11.1+**, macOS/Linux, `curl` and `tar`.
After the first stable release is published:

```sh
set -o pipefail
curl -fsSL https://github.com/zeemrx0/zak-cli/releases/latest/download/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
zak --version
```

The bootstrap verifies archive checksums before writing CLI files. The initial downloaded
script is still trusted. It does not install Node or modify shell profiles.
CLI files live in `${XDG_DATA_HOME:-$HOME/.local/share}/zak` and the launcher in
`$HOME/.local/bin/zak`. Foreign files, edits and symlinked parents are refused.
Use `sh -s -- --channel beta` for a published beta; no stable fallback occurs.
No npm publication is used.

Before a release exists, develop from this checkout with `npm ci`, `npm test`, and
`node scripts/zak.cjs --help`. `npm run build` produces the three release assets.

## 2. Manage a kit

Supply the source explicitly on every command:

```sh
zak kit install --repo owner/kit --target omp,codex --tier general
zak kit update --repo owner/kit --target omp,codex --tier general
zak kit check --repo owner/kit --target omp,codex --tier general
zak kit uninstall --repo owner/kit --target omp,codex
```

For private sources, authenticate with `gh auth login`, then add `--transport gh`.
For beta kit releases, add `--channel beta`. Kit and CLI channels are independent.
Append `--global` for global guidance; otherwise the project path defaults to cwd.
Omit `--target` for the kit's host/tier picker. `--json` and `--dry-run` retain kit semantics.
The kit's existing installer owns host placement, conflicts, locks and removals.

Kit install/update downloads current, checksum-verified release archives into a separate
`zak-kit-cache` user-data directory. Check/uninstall reuse a verified cache when available.
No kit source is bundled with the CLI. Private access never falls back to anonymous HTTP.

## 3. Update or remove the CLI

```sh
zak self-update
zak self-update --channel beta
zak self-uninstall
```

These commands do not change installed guidance. CLI removal also leaves the kit cache.
Remove guidance with `zak kit uninstall` before removing the CLI if both are unwanted.
Interrupted CLI removal can be resumed by rerunning the bootstrap with `--uninstall`.
Edited or foreign files remain protected during recovery. An unverifiable lock requires
inspection; do not delete a guard while its process is running.

## Release development

Run `npm test` and `npm run build` with Node 26.11.1+. Package and lock versions must
match. Stable tags are `vX.Y.Z`; beta tags are `vX.Y.Z-beta.N`. The GitHub workflow verifies
identity, tests, builds, and checks uploaded assets before publishing. No release has been
published merely by creating this repository.
