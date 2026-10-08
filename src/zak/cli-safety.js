const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function safeParents(file) {
  const absolute = path.resolve(file);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor) && !fs.lstatSync(cursor, { throwIfNoEntry: false })) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`refusing symlink: ${cursor}`);
  }
  return absolute;
}
function files(root, prefix = '') {
  const result = {};
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, files(root, rel));
    else if (entry.isFile()) result[rel] = hash(fs.readFileSync(path.join(root, rel)));
    else throw new Error(`unsupported CLI entry: ${rel}`);
  }
  return result;
}
function atomic(file, bytes) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function paths(env = process.env) {
  if (!env.HOME || !path.isAbsolute(env.HOME)) throw new Error('absolute HOME is required');
  if (env.ZAK_ROOT && !path.isAbsolute(env.ZAK_ROOT)) throw new Error('ZAK_ROOT must be absolute');
  if (env.XDG_DATA_HOME && !path.isAbsolute(env.XDG_DATA_HOME)) throw new Error('XDG_DATA_HOME must be absolute');
  return {
    root: safeParents(env.ZAK_ROOT || path.join(env.XDG_DATA_HOME || path.join(env.HOME, '.local/share'), 'zak')),
    launcher: safeParents(path.join(env.HOME, '.local/bin/zak')),
  };
}
function readReceipt(root, launcher) {
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(path.join(root, 'receipt.json'), 'utf8')); }
  catch (cause) { throw new Error('cannot read CLI ownership receipt; existing files kept', { cause }); }
  return validateReceipt(receipt, root, launcher);
}
function validateReceipt(receipt, root, launcher) {
  const hex = /^[a-f0-9]{64}$/;
  if (!receipt || receipt.schema !== 1 || receipt.root !== root || receipt.launcher !== launcher ||
      !hex.test(receipt.active) || !hex.test(receipt.launcherHash) ||
      !['curl', 'gh'].includes(receipt.transport) || !['stable', 'beta'].includes(receipt.channel) ||
      !['private', 'public'].includes(receipt.distribution) ||
      !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(receipt.repository) ||
      !receipt.generations || !receipt.generations[receipt.active]) throw new Error('invalid CLI receipt');
  for (const [id, inventory] of Object.entries(receipt.generations)) {
    if (!hex.test(id)) throw new Error('invalid CLI generation');
    validateInventory(inventory);
  }
  return receipt;
}
function validateInventory(inventory) {
  const hex = /^[a-f0-9]{64}$/;
    if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory))
      throw new Error('invalid CLI generation');
    for (const [rel, digest] of Object.entries(inventory)) {
      if (!(rel === 'install.sh' || rel.startsWith('package/')) || rel.includes('\\') || rel.includes('\0') ||
          rel.split('/').some(part => !part || part === '.' || part === '..') || !hex.test(digest))
        throw new Error('unsafe CLI receipt path');
    }
    if (!inventory['install.sh'] || !inventory['package/scripts/zak.cjs']) throw new Error('incomplete CLI generation');
}
function verifyOwned(receipt, { allowMissing = false, uninstall = false } = {}) {
  if ((!allowMissing || fs.existsSync(receipt.launcher)) && hash(fs.readFileSync(receipt.launcher)) !== receipt.launcherHash) throw new Error('edited CLI launcher; kept');
  const expected = {};
  for (const [id, inventory] of Object.entries(receipt.generations))
    for (const [rel, digest] of Object.entries(inventory)) expected[`releases/${id}/${rel}`] = digest;
  const allowedDirs = new Set(['releases', '.lifecycle-lock', '.update-lock']);
  for (const rel of Object.keys(expected)) {
    let dir = path.posix.dirname(rel);
    while (dir !== '.') { allowedDirs.add(dir); dir = path.posix.dirname(dir); }
  }
  function checkDirs(prefix = '') {
    for (const entry of fs.readdirSync(path.join(receipt.root, prefix), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!allowedDirs.has(rel)) throw new Error('foreign CLI directory; kept');
      checkDirs(rel);
    }
  }
  checkDirs();
  const actual = files(receipt.root);
  delete actual['receipt.json'];
  if (uninstall) delete actual['.uninstall.json'];
  delete actual['.lifecycle-lock/owner.json'];
  delete actual['.update-lock/owner.json'];
  if (Object.entries(actual).some(([rel, digest]) => expected[rel] !== digest) ||
      !allowMissing && Object.keys(actual).length !== Object.keys(expected).length)
    throw new Error('edited, missing or foreign CLI files; kept');
}
const { locked } = require('./cli-lock');
module.exports = { hash, safeParents, files, atomic, paths, readReceipt, validateReceipt, validateInventory, verifyOwned, locked };
