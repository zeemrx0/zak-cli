const fs = require('node:fs');
const path = require('node:path');
const { files, hash, safeParents } = require('./cli-safety');
function removeCreated(directory, inventory) {
  safeParents(directory);
  if (!fs.existsSync(directory)) return;
  const actual = files(directory);
  for (const [rel, digest] of Object.entries(actual))
    if (inventory[rel] !== digest) throw new Error('transaction files edited or foreign; recovery refused');
  for (const rel of Object.keys(actual)) fs.unlinkSync(path.join(directory, rel));
  const directories = new Set(['']);
  for (const rel of Object.keys(inventory)) {
    let dir = path.posix.dirname(rel);
    while (dir !== '.') { directories.add(dir); dir = path.posix.dirname(dir); }
  }
  for (const rel of [...directories].sort((a, b) => b.length - a.length)) {
    const dir = path.join(directory, rel);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
  if (fs.existsSync(directory)) throw new Error('foreign transaction directories; recovery refused');
}
function recover(root, launcher) {
  const file = path.join(root, '.transaction.json');
  if (!fs.existsSync(file)) return;
  let journal;
  try { journal = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (cause) { throw new Error('invalid CLI transaction journal', { cause }); }
  if (!journal || !/^[a-f0-9]{64}$/.test(journal.id) ||
      !/^\.stage-[a-f0-9-]{36}$/.test(journal.stage) ||
      (journal.previous !== null && !/^[a-f0-9]{64}$/.test(journal.previous)) ||
      !/^\.receipt-[a-f0-9-]{36}\.json$/.test(journal.next) || typeof journal.nextBytes !== 'string' ||
      typeof journal.createdGeneration !== 'boolean' || !/^[a-f0-9]{64}$/.test(journal.launcherHash)) throw new Error('unsafe CLI transaction journal');
  const { validateInventory, readReceipt } = require('./cli-safety');
  validateInventory(journal.inventory);
  const receipt = fs.existsSync(path.join(root, 'receipt.json')) ? readReceipt(root, launcher) : null;
  if (receipt?.active !== journal.id) {
    if ((receipt?.active ?? null) !== journal.previous) throw new Error('CLI transaction ownership changed');
    if (journal.createdGeneration) removeCreated(path.join(root, 'releases', journal.id), journal.inventory);
    if (!receipt && fs.existsSync(launcher)) {
      if (hash(fs.readFileSync(launcher)) !== journal.launcherHash) throw new Error('edited transaction launcher; kept');
      fs.unlinkSync(launcher);
    }
  }
  removeCreated(path.join(root, journal.stage), journal.inventory);
  const next = safeParents(path.join(root, journal.next));
  if (fs.existsSync(next)) {
    const actual = fs.readFileSync(next), expected = Buffer.from(journal.nextBytes);
    if (!actual.equals(expected.subarray(0, actual.length))) throw new Error('edited receipt temporary; kept');
    fs.unlinkSync(next);
  }
  fs.unlinkSync(file);
}
function begin(root, journal) {
  require('./cli-journal').publishJournal(root, path.join(root, '.transaction.json'), journal);
}
module.exports = { recover, begin, removeCreated };
