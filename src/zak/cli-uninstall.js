const fs = require('node:fs');
const path = require('node:path');
const { paths, readReceipt, validateReceipt, verifyOwned, locked, safeParents } = require('./cli-safety');
const { recover, removeCreated } = require('./cli-transaction');
const { publishJournal } = require('./cli-journal');
function readJournal(file, root, launcher) {
  let journal;
  try { journal = JSON.parse(fs.readFileSync(file)); }
  catch (cause) { throw new Error('invalid uninstall journal', { cause }); }
  return validateReceipt(journal.receipt, root, launcher);
}
function selfUninstall(args, env = process.env) {
  if (args.length) throw new Error('self-uninstall accepts no kit flags');
  const { root, launcher } = paths(env), journalFile = safeParents(root + '.uninstall.json');
  if (!fs.existsSync(root) && !fs.existsSync(launcher)) {
    if (fs.existsSync(journalFile)) { readJournal(journalFile, root, launcher); fs.unlinkSync(journalFile); }
    console.log('zak CLI already removed.'); return 0;
  }
  locked(root, () => {
    if (fs.existsSync(path.join(root, '.update-lock'))) locked(root, () => {}, '.update-lock');
    recover(root, launcher);
    let receipt;
    if (fs.existsSync(journalFile)) {
      receipt = readJournal(journalFile, root, launcher);
      if (fs.existsSync(path.join(root, 'receipt.json')) && JSON.stringify(readReceipt(root, launcher)) !== JSON.stringify(receipt))
        throw new Error('uninstall receipt changed; removal refused');
      verifyOwned(receipt, { allowMissing: true });
    } else {
      receipt = readReceipt(root, launcher); verifyOwned(receipt);
      publishJournal(root, journalFile, { receipt });
    }
    if (fs.existsSync(launcher)) fs.unlinkSync(launcher);
    for (const [id, inventory] of Object.entries(receipt.generations)) removeCreated(path.join(root, 'releases', id), inventory);
    const releases = path.join(root, 'releases');
    if (fs.existsSync(releases)) fs.rmdirSync(releases);
    const receiptFile = path.join(root, 'receipt.json');
    if (fs.existsSync(receiptFile)) fs.unlinkSync(receiptFile);
  });
  fs.rmdirSync(root);
  fs.unlinkSync(journalFile);
  console.log('zak CLI removed. Installed kits and kit cache were not changed.');
  return 0;
}
module.exports = { selfUninstall };
