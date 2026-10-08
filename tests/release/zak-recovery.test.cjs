const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { installCli } = require('../../src/zak/cli-install');
const { readReceipt, verifyOwned } = require('../../src/zak/cli-safety');
const { selfUninstall } = require('../../src/zak/cli-self-management');
const { spawnSync } = require('node:child_process');
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-recovery-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'), home = path.join(dir, 'home');
  fs.mkdirSync(home); fs.mkdirSync(source);
  const pkg = { version: '1.0.0', private: true, repository: 'https://github.com/owner/kit.git' };
  for (const rel of ['scripts/zak.cjs', 'scripts/ship-kit.cjs', 'dist/installer/target-picker.cjs']) {
    fs.mkdirSync(path.dirname(path.join(source, rel)), { recursive: true });
    fs.writeFileSync(path.join(source, rel), '// fixture');
  }
  const writeVersion = version => { pkg.version = version; fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(pkg)); };
  writeVersion('1.0.0');
  const env = { HOME: home }, install = () => installCli(source, Buffer.from('#!/bin/sh\nexit 0'), 'owner/kit', 'curl', env);
  return { dir, source, env, writeVersion, install };
}
test('failed receipt activation rolls back only new files and allows retry', t => {
  const f = fixture(t), initial = f.install();
  const receiptPath = path.join(initial.root, 'receipt.json'), before = fs.readFileSync(receiptPath);
  f.writeVersion('1.0.1');
  const rename = fs.renameSync;
  fs.renameSync = (source, dest) => {
    if (dest === receiptPath) throw new Error('injected activation failure');
    return rename(source, dest);
  };
  try { assert.throws(() => f.install(), /injected activation failure/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(receiptPath), before);
  verifyOwned(readReceipt(initial.root, initial.launcher));
  assert.equal(f.install().version, '1.0.1');
  f.writeVersion('1.0.0');
  assert.equal(f.install().version, '1.0.0');
  verifyOwned(readReceipt(initial.root, initial.launcher));
});
test('fresh launcher failure removes transaction-created root and can retry', t => {
  const f = fixture(t), write = fs.writeFileSync;
  fs.writeFileSync = (file, ...args) => {
    if (String(file).endsWith('/bin/zak')) throw new Error('injected launcher failure');
    return write(file, ...args);
  };
  try { assert.throws(() => f.install(), /injected launcher failure/); }
  finally { fs.writeFileSync = write; }
  assert.equal(fs.existsSync(path.join(f.env.HOME, '.local/share/zak')), false);
  assert.equal(f.install().version, '1.0.0');
});
test('process interruption before receipt rename recovers the tracked temporary', t => {
  const f = fixture(t), initial = f.install();
  const before = fs.readFileSync(path.join(initial.root, 'receipt.json'));
  f.writeVersion('1.0.1');
  const modulePath = path.resolve(__dirname, '../../src/zak/cli-install.js');
  const script = `const fs=require('node:fs'),rename=fs.renameSync;fs.renameSync=(a,b)=>{if(b.endsWith('/receipt.json'))process.exit(42);return rename(a,b);};require(${JSON.stringify(modulePath)}).installCli(${JSON.stringify(f.source)},Buffer.from('#!/bin/sh\\nexit 0'),'owner/kit','curl',${JSON.stringify(f.env)});`;
  const child = spawnSync(process.execPath, ['-e', script]);
  assert.equal(child.status, 42, child.stderr?.toString());
  assert.deepEqual(fs.readFileSync(path.join(initial.root, 'receipt.json')), before);
  assert.ok(fs.existsSync(path.join(initial.root, '.transaction.json')));
  assert.equal(f.install().version, '1.0.1');
  verifyOwned(readReceipt(initial.root, initial.launcher));
});
test('interrupted uninstall resumes matching-byte deletions without touching foreign files', t => {
  const f = fixture(t), initial = f.install(), unlink = fs.unlinkSync;
  let calls = 0;
  fs.unlinkSync = file => {
    if (String(file).includes('/releases/') && ++calls === 2) throw new Error('injected uninstall interruption');
    return unlink(file);
  };
  try { assert.throws(() => selfUninstall([], f.env), /interruption/); }
  finally { fs.unlinkSync = unlink; }
  assert.ok(fs.existsSync(initial.root + '.uninstall.json'));
  assert.equal(selfUninstall([], f.env), 0);
  assert.equal(fs.existsSync(initial.root), false);
});
test('uninstall completion evidence survives failure immediately before root removal', t => {
  const f = fixture(t), initial = f.install(), rmdir = fs.rmdirSync;
  fs.rmdirSync = directory => {
    if (directory === initial.root) throw new Error('injected final cleanup failure');
    return rmdir(directory);
  };
  try { assert.throws(() => selfUninstall([], f.env), /final cleanup/); }
  finally { fs.rmdirSync = rmdir; }
  assert.ok(fs.existsSync(initial.root + '.uninstall.json'));
  assert.equal(selfUninstall([], f.env), 0);
  assert.equal(fs.existsSync(initial.root), false);
  assert.equal(fs.existsSync(initial.root + '.uninstall.json'), false);
});
test('short journal preparation never publishes destructive authorization', t => {
  const f = fixture(t), initial = f.install(), write = fs.writeFileSync;
  f.writeVersion('1.0.1');
  fs.writeFileSync = (file, bytes, ...args) => write(file, path.basename(String(file)) === 'journal.json' ? Buffer.from('{') : bytes, ...args);
  try { assert.throws(() => f.install(), /incomplete lifecycle journal/); }
  finally { fs.writeFileSync = write; }
  verifyOwned(readReceipt(initial.root, initial.launcher));
  assert.equal(f.install().version, '1.0.1');
});
test('self-update forwards the disposable environment through release installation', async t => {
  const f = fixture(t); f.install();
  const releases = require('../../src/zak/release-install'), original = releases.installRelease;
  let received;
  releases.installRelease = async (_source, env) => { received = env; return 0; };
  try { assert.equal(await require('../../src/zak/cli-self-management').selfUpdate([], f.env), 0); }
  finally { releases.installRelease = original; }
  assert.equal(received, f.env);
});
test('verified dead process locks recover without removing installed kit state', t => {
  const f = fixture(t), result = f.install();
  const lock = path.join(result.root, '.update-lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 2147483647, token: 'dead-fixture' }));
  selfUninstall([], f.env);
  assert.equal(fs.existsSync(result.root), false);
});
