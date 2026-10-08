const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function owner(file) {
  try {
    const bytes = fs.readFileSync(file, 'utf8'), record = JSON.parse(bytes);
    if (!Number.isSafeInteger(record.pid) || record.pid < 1 || typeof record.token !== 'string') throw new Error('invalid owner');
    return { ...record, bytes };
  } catch (cause) { throw new Error('CLI lock has no verifiable owner; inspect before recovery', { cause }); }
}
function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
function acquire(root, name) {
  const lock = path.join(root, name), file = path.join(lock, 'owner.json');
  try { fs.mkdirSync(lock); }
  catch (cause) {
    if (cause.code !== 'EEXIST' || fs.lstatSync(lock).isSymbolicLink()) throw cause;
    if (isAlive(owner(file).pid)) throw new Error('CLI lifecycle busy; retry after the other operation finishes');
    const guard = path.join(root, `${name}-recovery`);
    try { fs.mkdirSync(guard); } catch { throw new Error('CLI lock recovery busy; retry after inspecting its owner'); }
    try {
      const record = owner(file);
      if (isAlive(record.pid) || fs.readdirSync(lock).join() !== 'owner.json' || fs.readFileSync(file, 'utf8') !== record.bytes)
        throw new Error('CLI lock changed; recovery refused');
      fs.unlinkSync(file); fs.rmdirSync(lock); fs.mkdirSync(lock);
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token: crypto.randomUUID() }), { flag: 'wx', mode: 0o600 });
    } finally { fs.rmdirSync(guard); }
  }
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token: crypto.randomUUID() }), { flag: 'wx', mode: 0o600 });
  const ours = owner(file).bytes;
  const release = () => {
    if (owner(file).bytes !== ours) throw new Error('CLI lock ownership changed; release refused');
    fs.unlinkSync(file); fs.rmdirSync(lock);
  };
  return release;
}
function locked(root, action, name = '.lifecycle-lock') {
  const release = acquire(root, name);
  try { return action(); } finally { release(); }
}
module.exports = { locked, acquire };
