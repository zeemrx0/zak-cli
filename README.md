# zak CLI

Install the CLI once. Use `zak` to install, update, check, and remove agent guidance kits.

## 1. Install the CLI

Requires Node **26.11.1+**, macOS/Linux, `curl` and `tar`.

```sh
set -o pipefail
curl -fsSL https://github.com/zeemrx0/zak-cli/releases/latest/download/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
zak --version
```

The installation command does not install Node or change shell profiles.
It verifies the downloaded archive, but you must trust the initial installation script.
Edited files, foreign files, and symlinked installation paths are protected.

For a published beta CLI, use `sh -s -- --channel beta` instead of `sh`.
If no beta release is available, installation stops instead of using a stable release.

## 2. Manage a kit

```sh
zak kit install --target omp,codex --tier general
zak update --target omp,codex --tier general
zak kit check --target omp,codex --tier general
zak kit uninstall --target omp,codex
```

`zak update` is an alias for `zak kit update`. Both commands accept the same
options and update only the kit, not the CLI.

Supported targets are `omp`, `pi`, `codex`, and `claude`.
Omit `--target` to use the interactive picker.

For private kit access, install GitHub CLI (`gh`) and authenticate with an account
that has the required permissions:

```sh
gh auth login
```

Without GitHub CLI or a login, new installations use the public kit.
Authentication or access errors stop the operation instead of switching kits.
Existing installations retain their kit source.

Append `--global` for user-level guidance. Otherwise, commands apply to the current
project or a supplied project path. Do not combine `--global` with a project path.
Global installations require explicit tier selection.

Add `--dry-run` to preview changes without applying them.
For beta kits, add `--channel beta`. Kit and CLI channels are independent.
Change an installed kit's channel with `zak kit update`.
`--transport gh` supports authenticated downloads; private kits cannot use `--transport curl`.
Do not change the transport of an existing installation.

Edited files are preserved. Resolve reported conflicts before retrying an update or removal.
Do not manually delete installation records or active-operation guards.
For installations made with an older installer, remove the kit with its original
installer, review any retained files, then install it with `zak`.

## 3. Update or remove the CLI

```sh
zak self-update
zak self-update --channel beta
zak self-uninstall
```

These commands do not change or remove installed guidance.
To remove both the kit and CLI, run `zak kit uninstall` before `zak self-uninstall`.

If CLI removal is interrupted, rerun the installation command with
`sh -s -- --uninstall` instead of `sh`.
Edited or foreign files remain protected. If an installation record cannot be verified,
inspect it before retrying. Do not delete a guard while its process is running.
