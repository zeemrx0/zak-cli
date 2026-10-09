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
`node scripts/zak.cjs --help`. Release builds require the public configuration below.

## 2. Manage a kit

```sh
zak kit install --target omp,codex --tier general
zak kit update --target omp,codex --tier general
zak kit check --target omp,codex --tier general
zak kit uninstall --target omp,codex
```

New installs read the private kit URL from the CLI repository's GitHub Actions variable
`ZAK_PRIVATE_REPO_URL` using local `gh` credentials. The value is not built into the CLI.
Private-kit users must be collaborators on that repository, have variable-read permission,
and separately have access to the private kit. Authenticate locally with `gh auth login`.

Missing gh/login uses the built-in public fallback. An explicitly empty variable also
selects public. Authenticated lookup failures—including a missing variable or insufficient
permission—stop without switching sources. Repository access and immutable identity are
verified before downloading. Existing targets do not re-read the variable or change source.
`--repo` is no longer supported.

For beta kit releases, add `--channel beta`. Kit and CLI channels are independent.
Existing targets retain their source, transport and channel; only an explicit update
can change their channel. `--transport gh` is valid for either distribution;
`--transport curl` cannot select a private source or change a pinned transport.
Append `--global` for global guidance; do not combine it with a project path.
Otherwise the project path defaults to cwd. Public/private distribution and project/global
scope are independent. Omit `--target` for an interactive host picker.

Source receipts and cache generations live outside projects in owner-only user-data
storage. Check/uninstall use the exact pinned generation, never the latest release.
Check and dry-run do not advance receipts or persistent caches. A missing/edited generation
stops safely. Edited files keep their ownership evidence and cleanup-required binding;
retry uninstall after resolving them. Do not delete pins or active operation guards.

Legacy installations have no trusted source pin and cannot be auto-adopted, even when
bytes match. Remove them with their original trusted installer, review retained edits,
then install again. CLI self-update/removal never removes kit receipts or generations.

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

Run `npm test` with Node 26.11.1+. In the public CLI repository's
**Settings → Secrets and variables → Actions → Variables**, configure two values:

- `ZAK_PUBLIC_REPO`: runnable public fallback, as `owner/repository` or an HTTPS GitHub URL.
  This is the only build input and is publicly visible in the archive.
- `ZAK_PRIVATE_REPO_URL`: credential-free HTTPS GitHub URL of the private kit. The CLI
  reads it at runtime through the protected repository-variable API, not during the build.

Topics and numeric owner-ID configuration are no longer used. Do not pass the private URL
into build steps, put it in source metadata, or print variable API responses into logs.
GitHub Actions secrets cannot be read back by the CLI. Never store tokens in these variables.
Variable readers can inspect the URL even if they lack access to the kit's contents;
restrict variable access to people authorized to learn its identity.
The build derives the variable-host repository from the CLI's public package identity,
validates public configuration, and stages it without modifying source metadata.
Package and lock versions must match. Stable tags are `vX.Y.Z`; beta tags are `vX.Y.Z-beta.N`. The GitHub workflow verifies
identity, tests, builds, and checks uploaded assets before publishing. No release has been
published merely by creating this repository.
