const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { STABLE, BETA, releaseRepository } = require('../release/release-metadata');
// A local source is a z-agent-kit checkout. It is packed with npm pack, like a release.
function readKit(dir) {
  if (typeof dir !== 'string' || !dir) throw new Error('local kit path is required');
  const root = path.resolve(dir);
  let real;
  try { real = fs.realpathSync(root); } catch { throw new Error(`local kit folder not found: ${root}`); }
  let metadata;
  try { metadata = fs.statSync(real).isDirectory() && JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8')); }
  catch { metadata = null; }
  if (!metadata || metadata.name !== 'z-agent-kit' || metadata.kitControlProtocol !== 1 ||
      !fs.existsSync(path.join(real, 'scripts/ship-kit.cjs')))
    throw new Error(`not a z-agent-kit checkout: ${real}`);
  return { root: real, metadata };
}
function localSource(dir, channel) {
  const { root, metadata } = readKit(dir);
  const version = String(metadata.version);
  const derived = STABLE.test(version) ? 'stable' : BETA.test(version) ? 'beta' : null;
  if (!derived) throw new Error(`local kit version ${version} is not a release version`);
  if (channel && channel !== derived) throw new Error(`local kit version ${version} is not a ${channel} version`);
  return { repository: releaseRepository(metadata), transport: 'local', channel: derived, distribution: 'local', path: root };
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || '').trim().split('\n').pop();
    throw new Error(`local kit build failed (${path.basename(command)} ${args[0]}): ${detail}`);
  }
  return result.stdout;
}
function packLocal(source) {
  const { root, metadata } = readKit(source.path);
  if (root !== source.path || releaseRepository(metadata) !== source.repository)
    throw new Error('local kit identity changed; run zak kit source again');
  const picker = path.join(root, 'scripts/build/build-target-picker.cjs');
  if (fs.existsSync(picker)) run(process.execPath, [picker, root], root);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'zak-local-kit-'));
  try {
    let packed;
    try { packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', staging], root)); }
    catch (error) { throw error.message.startsWith('local kit') ? error : new Error('npm pack returned invalid JSON'); }
    if (!Array.isArray(packed) || packed.length !== 1 || !packed[0].filename) throw new Error('npm pack did not return one archive');
    return { bytes: fs.readFileSync(path.join(staging, path.basename(packed[0].filename))), tag: `v${metadata.version}` };
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}
function defaultLocalPath(cwd = process.cwd()) {
  for (const candidate of [cwd, path.join(cwd, 'z-agent-kit')]) {
    try { return readKit(candidate).root; } catch {}
  }
  return '';
}
module.exports = { localSource, packLocal, defaultLocalPath };
