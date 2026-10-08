const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function tar(args) {
  const result = spawnSync('tar', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('invalid release archive');
  return result.stdout;
}
function unpack(bytes, directory) {
  fs.mkdirSync(directory);
  const archive = path.join(directory, 'release.tgz');
  fs.writeFileSync(archive, bytes, { flag: 'wx' });
  const entries = tar(['-tzf', archive]).trim().split('\n');
  if (new Set(entries).size !== entries.length || entries.some(rel =>
    !rel.startsWith('package/') || rel.includes('\\') || rel.includes('\0') ||
    rel.replace(/\/$/, '').split('/').some(part => !part || part === '.' || part === '..')))
    throw new Error('unsafe release archive paths');
  if (tar(['-tvzf', archive]).trim().split('\n').some(line => !['-', 'd'].includes(line[0])))
    throw new Error('release archive links and special files are forbidden');
  tar(['-xzf', archive, '-C', directory]);
  fs.unlinkSync(archive);
  return path.join(directory, 'package');
}
module.exports = { unpack };
