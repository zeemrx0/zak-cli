const fs = require('node:fs');
const ui = require('./cli-ui');
const os = require('node:os');
const path = require('node:path');
const { selectRelease, downloadAsset } = require('../release/release-download');
const { unpack } = require('../release/archive-package');
const { renderBootstrap } = require('../release/bootstrap-template');
const { installCli } = require('./cli-install');
const { hash } = require('./cli-safety');
async function installRelease(source, env = process.env) {
  const release = await selectRelease(source, env);
  const bytes = await downloadAsset(source, release, `zak-cli-${release.tag_name}.tgz`, env);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zak-release-'));
  try {
    const pkg = unpack(bytes, path.join(temp, 'unpacked'));
    const metadata = require(path.join(pkg, 'package.json'));
    if (metadata.name !== 'zak-cli' || `v${metadata.version}` !== release.tag_name) throw new Error('CLI release identity mismatch');
    const result = installCli(pkg, renderBootstrap(pkg, hash(bytes)), source.repository, source.transport, env);
    ui.success(`zak ${result.version} ${result.changed ? 'installed' : 'already installed'}`);
    return 0;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
module.exports = { installRelease };
