const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertNode } = require('../../src/shared/node-runtime');
const { kitArgs } = require('../../src/zak/zak-cli');
const { installCli } = require('../../src/zak/cli-install');
const { paths, readReceipt, verifyOwned } = require('../../src/zak/cli-safety');
const { selfUninstall } = require('../../src/zak/cli-self-management');
function fixture(t) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-unit-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'package'), home = path.join(temp, 'home');
  fs.mkdirSync(home);
  for (const rel of ['scripts/zak.cjs', 'scripts/ship-kit.cjs', 'dist/installer/target-picker.cjs']) {
    fs.mkdirSync(path.dirname(path.join(source, rel)), { recursive: true });
    fs.writeFileSync(path.join(source, rel), '// fixture\n');
  }
  const pkg = { version: '1.0.0', private: true, repository: 'https://github.com/owner/kit.git' };
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(pkg));
  const env = { HOME: home }, bootstrap = Buffer.from('#!/bin/sh\nexit 0\n');
  return { temp, source, home, env, pkg, bootstrap,
    install: () => installCli(source, bootstrap, 'owner/kit', 'curl', env) };
}
test('Node baseline compares full version and rejects malformed versions', () => {
  for (const version of ['18.20.0', '24.14.0', '26.10.9', '26.11.0', '26.11.1-beta'])
    assert.throws(() => assertNode(version), /26\.11\.1/);
  for (const version of ['26.11.1', '26.12.0', '27.0.0']) assert.doesNotThrow(() => assertNode(version));
});
test('kit command mapping rejects bootstrap and contradictory lifecycle flags', () => {
  const args = ['/project with spaces', '--target', 'omp,codex', '--json'];
  assert.deepEqual(kitArgs('install', args), args);
  for (const [operation, flag] of [['update', '--update'], ['check', '--check'], ['uninstall', '--uninstall']])
    assert.deepEqual(kitArgs(operation, args), [...args, flag]);
  for (const flag of ['--update', '--check', '--uninstall', '--cli'])
    assert.throws(() => kitArgs('install', [flag]), /subcommand/);
  assert.throws(() => kitArgs('remove', []), /expected/);
});
test('CLI install is byte-idempotent and self-uninstall leaves kit files', t => {
  const f = fixture(t), result = f.install();
  const marker = path.join(f.home, '.omp', 'user-kit');
  fs.mkdirSync(path.dirname(marker)); fs.writeFileSync(marker, 'installed guidance');
  const receipt = fs.readFileSync(path.join(result.root, 'receipt.json'));
  assert.equal(f.install().changed, false);
  assert.deepEqual(fs.readFileSync(path.join(result.root, 'receipt.json')), receipt);
  selfUninstall([], f.env);
  assert.equal(fs.existsSync(result.root), false);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'installed guidance');
});
test('CLI source switching, edited payloads and edited launchers fail without deletion', t => {
  const f = fixture(t), result = f.install();
  assert.throws(() => installCli(f.source, f.bootstrap, 'other/kit', 'curl', f.env), /identity/);
  assert.throws(() => installCli(f.source, f.bootstrap, 'owner/kit', 'gh', f.env), /source switch/);
  const receipt = readReceipt(result.root, result.launcher);
  const file = path.join(result.root, 'releases', receipt.active, 'package/scripts/zak.cjs');
  const bytes = fs.readFileSync(file);
  fs.appendFileSync(file, '// user edit');
  assert.throws(() => f.install(), /edited/);
  assert.throws(() => selfUninstall([], f.env), /edited/);
  assert.ok(fs.existsSync(result.launcher));
  fs.writeFileSync(file, bytes);
  fs.appendFileSync(result.launcher, '// user edit');
  assert.throws(() => selfUninstall([], f.env), /edited CLI launcher/);
});
test('foreign launcher and symlink parents are refused before persistent mutation', t => {
  const f = fixture(t), p = paths(f.env);
  fs.mkdirSync(path.dirname(p.launcher), { recursive: true });
  fs.writeFileSync(p.launcher, 'foreign');
  assert.throws(() => f.install(), /foreign launcher/);
  assert.equal(fs.existsSync(p.root), false);
  fs.unlinkSync(p.launcher);
  fs.rmdirSync(path.dirname(p.launcher));
  fs.symlinkSync(f.temp, path.dirname(p.launcher));
  assert.throws(() => f.install(), /symlink/);
});
test('receipt traversal and lifecycle conflicts fail safely', t => {
  const f = fixture(t), result = f.install();
  const receipt = readReceipt(result.root, result.launcher);
  verifyOwned(receipt);
  fs.mkdirSync(path.join(result.root, '.update-lock'));
  assert.throws(() => selfUninstall([], f.env), /no verifiable owner/);
  const ownerFile = path.join(result.root, '.update-lock/owner.json');
  fs.writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, token: 'live-fixture' }));
  assert.throws(() => selfUninstall([], f.env), /lifecycle busy/);
  fs.unlinkSync(ownerFile); fs.rmdirSync(path.join(result.root, '.update-lock'));
  receipt.generations[receipt.active]['package/../../escape'] = 'a'.repeat(64);
  fs.writeFileSync(path.join(result.root, 'receipt.json'), JSON.stringify(receipt));
  assert.throws(() => readReceipt(result.root, result.launcher), /unsafe/);
  assert.ok(fs.existsSync(result.launcher));
});
