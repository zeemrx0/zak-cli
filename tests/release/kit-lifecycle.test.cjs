const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { kitLifecycle, targetArgs } = require('../../src/zak/kit-lifecycle');
const { sourceArgs } = require('../../src/zak/zak-cli');
const { resolveTarget } = require('../../src/zak/kit-target-locator');
const source = { repository: 'fixture/public-kit', transport: 'curl', channel: 'stable', distribution: 'public' };
const snapshot = { id: 'a'.repeat(64), tag: 'v1.0.0', files: {} };
const config = { schema: 2, publicRepository: source.repository, variableRepository: 'fixture/cli', privateVariable: 'ZAK_PRIVATE_REPO_URL' };
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-lifecycle-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { HOME: root }, pins = new Map(), events = [];
  const key = descriptor => JSON.stringify(descriptor);
  const descriptor = resolveTarget({ host: 'pi', scope: 'project', project: root, env });
  const handle = { pkg: '/fixture', snapshot, cleanup() { events.push('cleanup'); } };
  const deps = {
    readPin(d) { return pins.get(key(d)) || null; },
    writePin(pin) { pins.set(key(pin.descriptor), pin); events.push(pin.state); },
    removePin(d) { pins.delete(key(d)); events.push('removed'); },
    lockSources() { events.push('lock'); return () => events.push('unlock'); },
    discoverSource() { events.push('discovery'); return source; },
    kitSnapshot() { events.push('download'); return handle; },
    pinnedSnapshot() { events.push('exact'); return handle; },
    async runControlled(pkg, args, callbacks) {
      events.push('prepare'); await callbacks.onPrepare(callbacks.descriptor);
      events.push('mutate'); await callbacks.onResult({ exitCode: 0, complete: true, descriptor: callbacks.descriptor });
      return { code: 0 };
    },
  };
  function pin(overrides = {}) { pins.set(key(descriptor), { schema: 1, descriptor, source, snapshot,
    state: 'installed', operation: 'install', ...overrides }); }
  function run(operation, options = {}, args = [root, '--target', 'pi']) {
    return kitLifecycle(operation, options, args, config, env, deps);
  }
  return { root, env, descriptor, pins, events, deps, pin, run };
}
test('source parser removes repository selection and preserves omitted defaults', () => {
  assert.deepEqual(sourceArgs(['--target', 'pi']), { source: {}, rest: ['--target', 'pi'] });
  for (const args of [['--repo', 'fixture/kit'], ['--repo=fixture/kit']]) assert.throws(() => sourceArgs(args), /no longer/);
  assert.throws(() => sourceArgs(['--channel', 'beta', '--channel', 'stable']), /repeated/);
  assert.throws(() => sourceArgs(['--transport', 'ssh']), /transport/);
  assert.throws(() => targetArgs(['one', 'two']), /one kit project/);
  assert.throws(() => targetArgs(['/project', '--global']), /repository path/);
});
test('new install writes pending intent before mutation and commits independently', async t => {
  const f = fixture(t);
  assert.equal(await f.run('install'), 0);
  assert.ok(f.events.indexOf('pending') < f.events.indexOf('mutate'));
  assert.ok(f.events.includes('installed')); assert.equal(f.events.at(-1), 'unlock');
});
test('pinned lifecycle never rediscovers after account changes', async t => {
  for (const operation of ['install', 'update', 'check', 'uninstall']) {
    const f = fixture(t); f.pin();
    f.deps.discoverSource = () => { throw Error('rediscovery forbidden'); };
    assert.equal(await f.run(operation), 0);
    assert.ok(f.events.includes(operation === 'update' ? 'download' : 'exact'));
  }
});
test('check and dry-run never write source state or acquire persistent locks', async t => {
  for (const [operation, dry] of [['check', false], ['install', true], ['update', true], ['uninstall', true]]) {
    const f = fixture(t); f.pin();
    assert.equal(await f.run(operation, {}, [f.root, '--target', 'pi', ...(dry ? ['--dry-run'] : [])]), 0);
    assert.equal(f.events.includes('lock'), false);
    assert.equal(f.events.includes('pending'), false); assert.equal(f.events.includes('removed'), false);
  }
});
test('interactive selection forwards the same operation flags as application in project and global scope', async t => {
  for (const stream of [process.stdin, process.stdout]) {
    const previous = Object.getOwnPropertyDescriptor(stream, 'isTTY');
    Object.defineProperty(stream, 'isTTY', { value: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(stream, 'isTTY', previous) : delete stream.isTTY);
  }
  for (const global of [false, true]) {
    for (const [operation, flag] of [['install', null], ['update', '--update'], ['check', '--check'], ['uninstall', '--uninstall']]) {
      const f = fixture(t), calls = [];
      const descriptor = resolveTarget({ host: 'pi', scope: global ? 'global' : 'project', project: f.root, env: f.env });
      f.pins.set(JSON.stringify(descriptor), { schema: 1, descriptor, source, snapshot, state: 'installed', operation: 'install' });
      const normal = f.deps.runControlled;
      f.deps.runControlled = async (pkg, args, callbacks) => {
        calls.push({ args, mode: callbacks.mode || 'apply' });
        if (callbacks.mode === 'select') {
          assert.equal(f.events.includes('pending'), false);
          assert.equal(f.events.includes('mutate'), false);
          return { code: 0, targets: ['pi'] };
        }
        return normal(pkg, args, callbacks);
      };
      const args = [global ? '--global' : f.root, '--tier', 'general'];
      assert.equal(await f.run(operation, {}, args), 0);
      assert.deepEqual(calls, [
        { args: [...args, ...(flag ? [flag] : [])], mode: 'select' },
        { args: [...args, '--target', 'pi', ...(flag ? [flag] : [])], mode: 'apply' },
      ]);
    }
  }
});
test('cancelled interactive update does not apply or write pending state', async t => {
  for (const stream of [process.stdin, process.stdout]) {
    const previous = Object.getOwnPropertyDescriptor(stream, 'isTTY');
    Object.defineProperty(stream, 'isTTY', { value: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(stream, 'isTTY', previous) : delete stream.isTTY);
  }
  const f = fixture(t); f.pin();
  f.deps.runControlled = async (_pkg, args, callbacks) => {
    assert.equal(callbacks.mode, 'select');
    assert.ok(args.includes('--update'));
    return { code: 130, targets: [] };
  };
  assert.equal(await f.run('update', {}, [f.root]), 130);
  assert.equal(f.events.includes('pending'), false);
  assert.equal(f.events.includes('mutate'), false);
  assert.equal(f.events.at(-1), 'unlock');
});
test('missing pins and legacy targets stop before downloads', async t => {
  const f = fixture(t);
  await assert.rejects(f.run('check'), /no trusted/);
  fs.mkdirSync(f.descriptor.controlRoot);
  fs.writeFileSync(path.join(f.descriptor.controlRoot, 'z-project.json'), '{}');
  await assert.rejects(f.run('install'), /legacy/);
  assert.equal(f.events.includes('download'), false);
});
test('empty post-uninstall roots and unrelated host configuration are not legacy kit evidence', async t => {
  const f = fixture(t); fs.mkdirSync(f.descriptor.controlRoot);
  fs.writeFileSync(path.join(f.descriptor.controlRoot, 'auth.json'), '{"fixture":true}');
  assert.equal(await f.run('install'), 0);
  assert.equal(fs.readFileSync(path.join(f.descriptor.controlRoot, 'auth.json'), 'utf8'), '{"fixture":true}');
});
test('explicit source conflicts fail while compatible updates can change channel', async t => {
  const f = fixture(t); f.pin();
  await assert.rejects(f.run('check', { transport: 'gh' }), /transport conflicts/);
  await assert.rejects(f.run('install', { channel: 'beta' }), /explicit update/);
  let selected;
  f.deps.kitSnapshot = candidate => { selected = candidate; return { pkg: '/fixture', snapshot: { ...snapshot, tag: 'v1.1.0-beta.1' }, cleanup() {} }; };
  assert.equal(await f.run('update', { channel: 'beta' }), 0); assert.equal(selected.channel, 'beta');
});
test('interruption preserves pending exact generation for retry', async t => {
  const f = fixture(t);
  const normal = f.deps.runControlled;
  f.deps.runControlled = async (_pkg, _args, callbacks) => { await callbacks.onPrepare(callbacks.descriptor); throw Error('interrupted'); };
  assert.equal(await f.run('install'), 1);
  assert.equal([...f.pins.values()][0].state, 'pending');
  f.deps.runControlled = normal;
  f.deps.discoverSource = () => { throw Error('must not rediscover'); };
  assert.equal(await f.run('install'), 0); assert.ok(f.events.includes('exact'));
});
test('partial uninstall retains cleanup state and a successful retry removes it', async t => {
  const f = fixture(t); f.pin(); const normal = f.deps.runControlled;
  f.deps.runControlled = async (_pkg, _args, callbacks) => {
    await callbacks.onPrepare(callbacks.descriptor);
    await callbacks.onResult({ descriptor: callbacks.descriptor, exitCode: 2, complete: false }); return { code: 2 };
  };
  assert.equal(await f.run('uninstall'), 2); assert.equal([...f.pins.values()][0].state, 'cleanup-required');
  f.deps.runControlled = normal; assert.equal(await f.run('uninstall'), 0); assert.equal(f.pins.size, 0);
});
test('mixed-source targets use their own generations and preserve a successful target on failure', async t => {
  const f = fixture(t); f.pin();
  const codex = resolveTarget({ host: 'codex', scope: 'project', project: f.root, env: f.env });
  f.pins.set(JSON.stringify(codex), { schema: 1, descriptor: codex,
    source: { ...source, repository: 'fixture/other-kit' }, snapshot: { ...snapshot, id: 'b'.repeat(64) }, state: 'installed', operation: 'install' });
  const generations = []; f.deps.pinnedSnapshot = pin => { generations.push(pin.snapshot.id); return { pkg: '/fixture', snapshot: pin.snapshot, cleanup() {} }; };
  const normal = f.deps.runControlled;
  f.deps.runControlled = (pkg, args, callbacks) => callbacks.descriptor.host === 'codex' ? Promise.reject(Error('failed')) : normal(pkg, args, callbacks);
  assert.equal(await f.run('uninstall', {}, [f.root, '--target', 'pi,codex']), 1);
  assert.deepEqual(generations, ['a'.repeat(64), 'b'.repeat(64)]); assert.equal(f.pins.size, 1);
});
