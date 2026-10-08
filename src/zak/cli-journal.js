const fs = require('node:fs');
const path = require('node:path');
function publishJournal(root, destination, record) {
  if (fs.existsSync(destination)) throw new Error('existing lifecycle journal; recovery required');
  // Prepare outside the managed root on the same filesystem. An interrupted
  // preparation cannot become authorization or poison the active installation.
  const temporary = fs.mkdtempSync(path.join(path.dirname(root), '.zak-journal-'));
  try {
    const file = path.join(temporary, 'journal.json'), bytes = Buffer.from(JSON.stringify(record));
    fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    if (!fs.readFileSync(file).equals(bytes)) throw new Error('incomplete lifecycle journal write');
    fs.renameSync(file, destination);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { publishJournal };
