const fs = require('node:fs');
const path = require('node:path');
const { releaseRepository, STABLE, BETA } = require('./release-metadata');
function renderBootstrap(root, digest) {
  const pkg = require(path.join(root, 'package.json'));
  if (!(STABLE.test(pkg.version) || BETA.test(pkg.version)) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('invalid bootstrap release');
  const values = { REPOSITORY: releaseRepository(pkg), TAG: `v${pkg.version}`, ARCHIVE: `zak-cli-v${pkg.version}.tgz`, SHA256: digest };
  let text = fs.readFileSync(path.join(root, 'scripts/release/install.sh.template'), 'utf8');
  for (const [key, value] of Object.entries(values)) text = text.replaceAll(`@@${key}@@`, value);
  if (/@@[A-Z_]+@@/.test(text)) throw new Error('unresolved bootstrap token');
  return Buffer.from(text);
}
module.exports = { renderBootstrap };
