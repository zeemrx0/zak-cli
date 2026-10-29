const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { kitSourceCommand } = require('../../src/zak/kit-source-command');
const { readPreference, writePreference, preferredSource } = require('../../src/zak/kit-source-preference');
const { localSource } = require('../../src/zak/kit-local-source');
const { kitLifecycle } = require('../../src/zak/kit-lifecycle');
const { resolveTarget } = require('../../src/zak/kit-target-locator');
const config = { schema: 2, publicRepository: 'fixture/public-kit', variableRepository: 'fixture/cli', privateVariable: 'ZAK_PRIVATE_REPO_URL' };
const privateSource = { repository: 'fixture/private-kit', repositoryId: 4, ownerId: 5, distribution: 'private', transport: 'gh', channel: 'stable' };
function home(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-source-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const kit = path.join(root, 'kit');
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'scripts/ship-kit.cjs'), '');
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ name: 'z-agent-kit', version: '1.2.0', kitControlProtocol: 1,
    repository: { url: 'https://github.com/fixture/public-kit.git' } }));
  return { root, kit, env: { HOME: root } };
}
const quiet = { tty: false };
test('source command stores public, private and local choices', async t => {
  const h = home(t);
  const deps = { ...quiet, cwd: h.root, discoverSource: () => privateSource };
  assert.equal(await kitSourceCommand(['local', 'kit'], config, h.env, deps), 0);
  assert.deepEqual(readPreference(h.env), { schema: 1, kind: 'local', path: h.kit });
  assert.equal(await kitSourceCommand(['private'], config, h.env, deps), 0);
  assert.equal(readPreference(h.env).kind, 'private');
  assert.equal(await kitSourceCommand(['public'], config, h.env, deps), 0);
  assert.equal(readPreference(h.env).kind, 'public');
});
test('source command rejects unavailable private access and invalid folders', async t => {
  const h = home(t);
  const deps = { ...quiet, cwd: h.root, discoverSource: () => ({ distribution: 'public' }) };
  await assert.rejects(kitSourceCommand(['private'], config, h.env, deps), /not available/);
  await assert.rejects(kitSourceCommand(['local', h.root], config, h.env, deps), /not a z-agent-kit checkout/);
  await assert.rejects(kitSourceCommand(['remote'], config, h.env, deps), /usage/);
  assert.equal(readPreference(h.env), null);
});
test('interactive picker shows private only when authorized, then asks for the local path', async t => {
  const h = home(t);
  for (const authorized of [false, true]) {
    let shown;
    const prompt = { async selectKitSource({ options }) { shown = options.map(o => o.value); return 'local'; },
      async promptKitPath({ validate }) { assert.match(validate(h.root), /not a z-agent-kit/); assert.equal(validate(h.kit), undefined); return h.kit; } };
    const deps = { tty: true, cwd: h.root, prompt: () => prompt,
      discoverSource: () => authorized ? privateSource : (() => { throw new Error('no access'); })() };
    assert.equal(await kitSourceCommand([], config, h.env, deps), 0);
    assert.deepEqual(shown, authorized ? ['public', 'private', 'local'] : ['public', 'local']);
    assert.equal(readPreference(h.env).path, h.kit);
  }
  const cancel = { tty: true, cwd: h.root, discoverSource: () => privateSource, prompt: () => ({ async selectKitSource() { return null; } }) };
  assert.equal(await kitSourceCommand([], config, h.env, cancel), 130);
});
test('preferred sources resolve to the expected identity', t => {
  const h = home(t);
  assert.deepEqual(preferredSource({ kind: 'public' }, config, {}, null),
    { repository: 'fixture/public-kit', transport: 'curl', channel: 'stable', distribution: 'public' });
  assert.equal(preferredSource({ kind: 'private' }, config, {}, () => privateSource), privateSource);
  assert.deepEqual(localSource(h.kit), { repository: 'fixture/public-kit', transport: 'local', channel: 'stable', distribution: 'local', path: h.kit });
  assert.throws(() => localSource(h.kit, 'beta'), /not a beta version/);
  assert.throws(() => preferredSource({ kind: 'local', path: h.kit }, config, { transport: 'gh' }), /--transport/);
});
test('update switches an installed remote pin to the selected local source', async t => {
  const h = home(t);
  writePreference({ schema: 1, kind: 'local', path: h.kit }, h.env);
  const descriptor = resolveTarget({ host: 'pi', scope: 'project', project: h.root, env: h.env });
  const remote = { repository: 'fixture/public-kit', transport: 'curl', channel: 'stable', distribution: 'public' };
  const snapshot = { id: 'a'.repeat(64), tag: 'v1.0.0', files: {} };
  let pin = { schema: 1, descriptor, source: remote, snapshot, state: 'installed', operation: 'install' }, used;
  const deps = {
    readPin: () => pin, writePin(value) { pin = value; }, removePin() {}, lockSources: () => () => {},
    refreshPinnedSource() { throw new Error('remote refresh must not run'); },
    async kitSnapshot(source) { used = source; return { pkg: '/fixture', snapshot, cleanup() {} }; },
    async runControlled(_pkg, _args, callbacks) {
      await callbacks.onPrepare(callbacks.descriptor);
      await callbacks.onResult({ exitCode: 0, complete: true, descriptor: callbacks.descriptor });
      return { code: 0 };
    },
  };
  assert.equal(await kitLifecycle('update', {}, [h.root, '--target', 'pi', '--json'], config, h.env, deps), 0);
  assert.equal(used.distribution, 'local');
  assert.equal(pin.source.path, h.kit);
  assert.equal(pin.state, 'installed');
});
