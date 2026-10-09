const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runControlled } = require('../../src/zak/kit-control-runner');
const { resolveTarget } = require('../../src/zak/kit-target-locator');
const KIT = process.env.ZAK_TARGET_KIT_SOURCE;
for (const host of ['omp', 'pi', 'codex', 'claude']) for (const scope of ['project', 'global'])
test(`real kit control handshake on disposable ${host} ${scope} roots`, { skip: !KIT }, async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-control-live-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), project = path.join(root, 'project');
  fs.mkdirSync(home); fs.mkdirSync(project);
  const env = { ...process.env, HOME: home };
  for (const key of ['XDG_DATA_HOME', 'PI_CODING_AGENT_DIR', 'PI_CONFIG_DIR', 'OMP_PROFILE', 'PI_PROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) delete env[key];
  const descriptor = resolveTarget({ host, scope, project, env });
  const scopeArgs = scope === 'global' ? ['--global'] : [];
  const projectArgs = scope === 'global' ? [] : [project];
  const events = [];
  const install = await runControlled(KIT, [...projectArgs, '--target', host, '--tier', 'general', ...scopeArgs], {
    env, descriptor, timeoutMs: 30000,
    onPrepare(value) { assert.equal(fs.existsSync(value.controlRoot), false); events.push('authorized'); },
    onResult(packet) { assert.equal(packet.complete, true); assert.equal(fs.existsSync(packet.descriptor.lockPath), true); events.push('installed'); },
  });
  assert.equal(install.code, 0); assert.deepEqual(events, ['authorized', 'installed']);
  const prior = fs.readFileSync(descriptor.lockPath);
  const check = await runControlled(KIT, [...projectArgs, '--target', host, '--check', '--tier', 'general', ...scopeArgs], {
    env, descriptor, timeoutMs: 30000, onPrepare() {}, onResult(packet) { assert.equal(packet.exitCode, 0); },
  });
  assert.equal(check.code, 0); assert.deepEqual(fs.readFileSync(descriptor.lockPath), prior);
  if (host === 'omp' && scope === 'project') {
    const lock = JSON.parse(prior);
    const rel = Object.keys(lock.files)[0];
    const file = path.join(descriptor.controlRoot, rel), original = fs.readFileSync(file);
    fs.appendFileSync(file, '\nuser edit\n');
    const partial = await runControlled(KIT, [...projectArgs, '--target', host, '--uninstall'], {
      env, descriptor, timeoutMs: 30000, onPrepare() {},
      onResult(packet) { assert.equal(packet.complete, false); },
    });
    assert.equal(partial.code, 2); assert.equal(fs.existsSync(descriptor.lockPath), true);
    assert.equal(fs.existsSync(file), true);
    const retry = await runControlled(KIT, [...projectArgs, '--target', host, '--uninstall'], {
      env, descriptor, timeoutMs: 30000, onPrepare() {},
      onResult(packet) { assert.equal(packet.complete, false); },
    });
    assert.equal(retry.code, 2); assert.equal(fs.existsSync(descriptor.lockPath), true);
    fs.writeFileSync(file, original);
  }
  const uninstall = await runControlled(KIT, [...projectArgs, '--target', host, '--uninstall', ...scopeArgs], {
    env, descriptor, timeoutMs: 30000, onPrepare() {}, onResult(packet) { assert.equal(packet.complete, true); },
  });
  assert.equal(uninstall.code, 0); assert.equal(fs.existsSync(descriptor.lockPath), false);
});
