const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { selectRelease, downloadAsset, validateSource } = require('../release/release-download');
const { releaseRepository } = require('../release/release-metadata');
const { unpack } = require('../release/archive-package');
const { hash, files, safeParents } = require('./cli-safety');
const { acquire } = require('./cli-lock');
function cacheRoot(source, env) {
  if (!env.HOME || !path.isAbsolute(env.HOME) || env.XDG_DATA_HOME && !path.isAbsolute(env.XDG_DATA_HOME))
    throw new Error('absolute HOME and XDG_DATA_HOME are required');
  const base = env.XDG_DATA_HOME || path.join(env.HOME, '.local/share');
  return safeParents(path.join(base, 'zak-kit-cache', hash(Buffer.from(source.repository + ':' + source.transport)), source.channel));
}
function load(root, source) {
  const file = path.join(root, 'cache.json');
  if (!fs.existsSync(file)) return null;
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (cause) { throw new Error('invalid kit cache receipt', { cause }); }
  if (receipt.repository !== source.repository || receipt.transport !== source.transport || receipt.channel !== source.channel ||
      !/^[a-f0-9]{64}$/.test(receipt.id) || !receipt.files) throw new Error('kit cache identity mismatch');
  const pkg = safeParents(path.join(root, receipt.id, 'package'));
  const actual = files(pkg);
  if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(receipt.files).sort()))
    throw new Error('edited kit cache; kept');
  return pkg;
}
async function kitPackage(source, refresh, env = process.env) {
  validateSource(source, env);
  const root = cacheRoot(source, env);
  if (!refresh && fs.existsSync(root)) { const cached = load(root, source); if (cached) return cached; }
  const release = await selectRelease(source, env);
  const bytes = await downloadAsset(source, release, `z-agent-kit-${release.tag_name}.tgz`, env);
  const id = hash(bytes);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zak-kit-'));
  try {
    const pkg = unpack(bytes, path.join(temporary, 'unpacked'));
    let metadata;
    try { metadata = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'))); }
    catch (cause) { throw new Error('invalid kit metadata', { cause }); }
    if (metadata.name !== 'z-agent-kit' || `v${metadata.version}` !== release.tag_name || releaseRepository(metadata) !== source.repository ||
        !fs.existsSync(path.join(pkg, 'scripts/ship-kit.cjs'))) throw new Error('kit archive identity or entry point mismatch');
    if (metadata.private === true && source.transport !== 'gh') throw new Error('private kit requires authenticated gh transport');
    const inventory = files(pkg);
    fs.mkdirSync(root, { recursive: true });
    const releaseLock = acquire(root, '.cache-lock');
    try {
      if (fs.existsSync(path.join(root, 'cache.json'))) load(root, source);
      const generation = path.join(root, id);
      if (!fs.existsSync(generation)) {
        const stage = path.join(root, `.stage-${id}`);
        if (fs.existsSync(stage)) throw new Error('interrupted kit cache stage; inspect before retrying');
        fs.mkdirSync(stage);
        fs.cpSync(pkg, path.join(stage, 'package'), { recursive: true, errorOnExist: true });
        if (JSON.stringify(Object.entries(files(path.join(stage, 'package'))).sort()) !== JSON.stringify(Object.entries(inventory).sort()))
          throw new Error('kit cache staging integrity mismatch');
        fs.renameSync(stage, generation);
      } else if (JSON.stringify(Object.entries(files(path.join(generation, 'package'))).sort()) !== JSON.stringify(Object.entries(inventory).sort()))
        throw new Error('foreign kit cache generation; kept');
      const receipt = { ...source, id, tag: release.tag_name, files: inventory };
      // Cache activation is non-destructive. Failed writes leave existing generations intact.
      const next = path.join(root, 'cache-next.json');
      if (fs.existsSync(next)) throw new Error('interrupted cache activation; inspect cache-next.json');
      fs.writeFileSync(next, JSON.stringify(receipt), { flag: 'wx' });
      fs.renameSync(next, path.join(root, 'cache.json'));
      return path.join(generation, 'package');
    } finally { releaseLock(); }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
function runKit(pkg, args) {
  const result = spawnSync(process.execPath, [path.join(pkg, 'scripts/ship-kit.cjs'), ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
module.exports = { kitPackage, runKit, cacheRoot };
