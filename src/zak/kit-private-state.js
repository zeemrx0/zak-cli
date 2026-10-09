const fs = require('node:fs');
const path = require('node:path');
const { safeParents, atomic } = require('./cli-safety');
function inspect(file, directory) {
  const entry = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!entry) return null;
  if (entry.isSymbolicLink() || (directory ? !entry.isDirectory() : !entry.isFile()) ||
      process.getuid && entry.uid !== process.getuid()) throw new Error('unsafe private source state');
  return entry;
}
function privateDirectory(file, create = false) {
  const root = safeParents(file);
  let entry = inspect(root, true);
  if (!entry && create) {
    let parent = path.dirname(root);
    while (!fs.existsSync(parent)) {
      const next = path.dirname(parent);
      if (next === parent) throw new Error('private source state has no owned parent');
      parent = next;
    }
    inspect(parent, true);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    entry = inspect(root, true);
  }
  if (entry && (entry.mode & 0o077)) {
    if (!create) throw new Error('private source directory permissions are unsafe');
    fs.chmodSync(root, 0o700);
  }
  return root;
}
function readPrivate(file) {
  safeParents(file);
  const entry = inspect(file, false);
  if (!entry) return null;
  if (entry.mode & 0o077) throw new Error('private source receipt permissions are unsafe');
  if (entry.size > 4 * 1024 * 1024) throw new Error('private source receipt is too large');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('invalid private source receipt'); }
}
function writePrivate(file, value) {
  privateDirectory(path.dirname(file), true);
  inspect(file, false);
  atomic(file, Buffer.from(JSON.stringify(value)));
}
module.exports = { privateDirectory, readPrivate, writePrivate };
