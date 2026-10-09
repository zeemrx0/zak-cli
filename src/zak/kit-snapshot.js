const fs = require('node:fs');
const path = require('node:path');
const { kitPackage, cacheRoot } = require('./kit-cache');
const { files, safeParents } = require('./cli-safety');
const { privateDirectory } = require('./kit-private-state');
const { validateSnapshot } = require('./kit-source-pins');
const { validateSource } = require('../release/release-download');
const { releaseRepository } = require('../release/release-metadata');
async function kitSnapshot(source, { refresh = true, readonly = false } = {}, env = process.env) {
  return kitPackage(source, refresh, env, { envelope: true, transient: readonly });
}
function pinnedSnapshot(pin, env = process.env) {
  validateSnapshot(pin.snapshot);
  validateSource(pin.source, env);
  const root = privateDirectory(cacheRoot(pin.source, env));
  const pkg = safeParents(path.join(root, pin.snapshot.id, 'package'));
  if (!fs.existsSync(pkg)) throw new Error('verified pinned installer is unavailable; restore its original release');
  const actual = files(pkg);
  if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(pin.snapshot.files).sort()))
    throw new Error('pinned kit generation was edited; kept');
  let metadata;
  try { metadata = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')); }
  catch { throw new Error('invalid pinned kit metadata'); }
  if (metadata.kitControlProtocol !== 1 || `v${metadata.version}` !== pin.snapshot.tag ||
      releaseRepository(metadata) !== pin.source.repository) throw new Error('pinned kit identity mismatch');
  return { pkg, snapshot: pin.snapshot, cleanup() {} };
}
module.exports = { kitSnapshot, pinnedSnapshot };
