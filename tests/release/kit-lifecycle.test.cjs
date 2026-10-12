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
test('selected credentials reach downloads but not installer children or receipts', async t => {
  for (const operation of ['install', 'update']) {
    const f = fixture(t), privateSource = { ...source, distribution: 'private', transport: 'gh', repositoryId: 42, ownerId: 7 };
    if (operation === 'update') f.pin({ source: privateSource });
    const resolve = (_input, options) => {
      options.onAuthenticated({ ...options.env, GH_TOKEN: 'scoped-canary' });
      return privateSource;
    };
    f.deps.discoverSource = resolve; f.deps.refreshPinnedSource = resolve;
    const normalSnapshot = f.deps.kitSnapshot, normalRun = f.deps.runControlled;
    f.deps.kitSnapshot = (candidate, options, env) => {
      assert.equal(env.GH_TOKEN, 'scoped-canary'); return normalSnapshot();
    };
    f.deps.runControlled = (pkg, args, callbacks) => {
      assert.equal(callbacks.env.GH_TOKEN, undefined); return normalRun(pkg, args, callbacks);
    };
    assert.equal(await f.run(operation), 0);
    assert.equal(f.env.GH_TOKEN, undefined);
    assert.ok(!JSON.stringify([...f.pins.values()]).includes('scoped-canary'));
  }
});
test('release access failures try another account before installer mutation', async t => {
  const { withGithubAccountsAsync } = require('../../src/zak/github-accounts');
  for (const operation of ['install', 'update']) {
    const f = fixture(t), privateSource = { ...source, transport: 'gh', distribution: 'private', repositoryId: 42, ownerId: 7 };
    if (operation === 'update') f.pin({ source: privateSource });
    let resolutions = 0, downloads = 0, mutations = 0;
    f.deps.discoverSource = f.deps.refreshPinnedSource = () => { resolutions++; return privateSource; };
    f.deps.withGithubAccountsAsync = (probe, options) => withGithubAccountsAsync(probe, { ...options,
      run(_command, args) {
        assert.ok(!args.includes('switch'));
        return { status: 0, stdout: args.includes('--json') ?
          JSON.stringify({ hosts: { 'github.com': [{ login: 'owner' }] } }) : 'release-access-token' };
      } });
    const normalSnapshot = f.deps.kitSnapshot, normalRun = f.deps.runControlled;
    f.deps.kitSnapshot = (_source, _options, env) => {
      downloads++;
      if (!env.GH_TOKEN) throw Object.assign(new Error('release access denied'), { accountAccess: true });
      assert.equal(env.GH_TOKEN, 'release-access-token'); return normalSnapshot();
    };
    f.deps.runControlled = (...args) => { mutations++; return normalRun(...args); };
    assert.equal(await f.run(operation), 0);
    assert.equal(resolutions, 2); assert.equal(downloads, 2); assert.equal(mutations, 1);
    assert.ok(!JSON.stringify([...f.pins.values()]).includes('release-access-token'));
  }
});
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
test('CLI-owned circular selection preserves apply flags in project and global scope', async t => {
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
      f.deps.selectInstalledTargets = async (hosts, options = {}) => {
        assert.deepEqual(hosts, operation === 'update' ? ['pi'] : ['omp', 'pi', 'codex', 'claude']);
        assert.equal(options.operation || 'update', operation);
        assert.equal(f.events.includes('pending'), false);
        return { code: 0, targets: ['pi'] };
      };
      const args = [global ? '--global' : f.root, '--tier', 'general'];
      assert.equal(await f.run(operation, {}, args), 0);
      assert.deepEqual(calls, [
        { args: [...args, '--target', 'pi', ...(flag ? [flag, ...(['update', 'uninstall'].includes(operation) ? ['--force'] : [])] : [])], mode: 'apply' },
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
  f.deps.selectInstalledTargets = async hosts => {
    assert.deepEqual(hosts, ['pi']);
    return { code: 130, targets: [] };
  };
  assert.equal(await f.run('update', {}, [f.root]), 130);
  assert.equal(f.events.includes('pending'), false);
  assert.equal(f.events.includes('mutate'), false);
  assert.equal(f.events.at(-1), 'unlock');
});
test('all target pickers cancel before source access or mutation', async t => {
  interactive(t);
  for (const operation of ['install', 'check', 'uninstall']) {
    const f = fixture(t);
    f.deps.selectInstalledTargets = async () => ({ code: 130, targets: [] });
    assert.equal(await f.run(operation, {}, [f.root]), 130);
    for (const event of ['exact', 'discovery', 'download', 'pending', 'mutate'])
      assert.equal(f.events.includes(event), false, `${operation}: ${event}`);
    if (operation !== 'check') assert.equal(f.events.at(-1), 'unlock');
  }
});
test('invalid target selections cannot cross the apply boundary', async t => {
  interactive(t);
  for (const targets of [null, [], ['pi', 'pi'], ['unknown']]) {
    const f = fixture(t);
    f.deps.selectInstalledTargets = async () => ({ code: 0, targets });
    await assert.rejects(f.run('uninstall', {}, [f.root]), /invalid kit selection/);
    assert.equal(f.events.includes('mutate'), false);
    assert.equal(f.events.at(-1), 'unlock');
  }
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
test('reinstall accepts empty namespaced directory trees after successful uninstall', async t => {
  for (const host of ['pi', 'omp', 'codex', 'claude']) {
    for (const scope of ['project', 'global']) {
      const f = fixture(t);
      const descriptor = resolveTarget({ host, scope, project: f.root, env: f.env });
      const args = [scope === 'global' ? '--global' : f.root, '--target', host];
      const skill = path.join(descriptor.skillsRoot, 'z-html-style', 'references', 'styles');
      const extension = path.join(descriptor.controlRoot, 'extensions', 'z-agent-kit');
      fs.mkdirSync(skill, { recursive: true });
      fs.mkdirSync(extension, { recursive: true });
      f.pins.set(JSON.stringify(descriptor), { schema: 1, descriptor, source, snapshot, state: 'installed', operation: 'install' });
      assert.equal(await f.run('uninstall', {}, args), 0);
      assert.equal(f.pins.size, 0);
      assert.equal(await f.run('install', {}, args), 0, `${host} ${scope}`);
      assert.ok(fs.statSync(skill).isDirectory());
    }
  }
});
test('legacy inspection rejects retained files and symlinks inside namespaced trees', async t => {
  for (const kind of ['file', 'hidden-file', 'empty-link', 'dangling-link']) {
    const f = fixture(t);
    const dir = path.join(f.descriptor.skillsRoot, 'z-html-style', 'references');
    fs.mkdirSync(dir, { recursive: true });
    if (kind.endsWith('link')) {
      const target = path.join(f.root, 'outside');
      if (kind === 'empty-link') fs.mkdirSync(target);
      fs.symlinkSync(target, path.join(dir, 'link'));
    } else fs.writeFileSync(path.join(dir, kind === 'hidden-file' ? '.retained' : 'style.md'), '');
    await assert.rejects(f.run('install'), /legacy/);
    assert.equal(f.events.includes('download'), false);
  }
});
test('legacy inspection fails closed on excessive depth and preserves lock and startup evidence', async t => {
  for (const kind of ['deep-tree', 'lock', 'startup']) {
    const f = fixture(t);
    fs.mkdirSync(f.descriptor.controlRoot, { recursive: true });
    if (kind === 'deep-tree') fs.mkdirSync(path.join(f.descriptor.skillsRoot, 'z-empty', ...Array(66).fill('nested')), { recursive: true });
    else fs.writeFileSync(kind === 'lock' ? f.descriptor.lockPath : path.join(f.descriptor.controlRoot, 'AGENTS.md'), 'z-agent-kit');
    await assert.rejects(f.run('install'), /legacy/);
    assert.equal(f.events.includes('download'), false);
  }
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
function interactive(t) {
  for (const stream of [process.stdin, process.stdout]) {
    const previous = Object.getOwnPropertyDescriptor(stream, 'isTTY');
    Object.defineProperty(stream, 'isTTY', { value: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(stream, 'isTTY', previous) : delete stream.isTTY);
  }
}
function seed(f, host, scope, state = 'installed', operation = 'install') {
  const descriptor = resolveTarget({ host, scope, project: f.root, env: f.env });
  f.pins.set(JSON.stringify(descriptor), { schema: 1, descriptor, source, snapshot, state, operation });
}
test('automatic update lists only installed hosts within the requested scope', async t => {
  interactive(t);
  for (const scope of ['project', 'global']) {
    const f = fixture(t), calls = [];
    seed(f, 'pi', scope); seed(f, 'codex', scope);
    seed(f, 'omp', scope, 'pending', 'update'); seed(f, 'claude', scope, 'cleanup-required', 'uninstall');
    seed(f, 'claude', scope === 'global' ? 'project' : 'global');
    f.deps.pinnedSnapshot = () => { throw Error('old picker must not run'); };
    f.deps.selectInstalledTargets = async hosts => {
      assert.deepEqual(hosts, ['pi', 'codex']);
      return { code: 0, targets: hosts };
    };
    const normal = f.deps.runControlled;
    f.deps.runControlled = async (pkg, args, callbacks) => {
      assert.notEqual(callbacks.mode, 'select'); calls.push(args);
      return normal(pkg, args, callbacks);
    };
    const args = [scope === 'global' ? '--global' : f.root, '--tier', 'general', '--force'];
    assert.equal(await f.run('update', {}, args), 0);
    assert.deepEqual(calls, ['pi', 'codex'].map(host => [...args, '--target', host, '--update']));
  }
});
test('empty update scope is a no-op without locking, prompting or fetching', async t => {
  const f = fixture(t), messages = [], previous = console.log;
  console.log = message => messages.push(message); t.after(() => { console.log = previous; });
  seed(f, 'pi', 'global'); seed(f, 'omp', 'project', 'pending', 'update');
  seed(f, 'claude', 'project', 'cleanup-required', 'uninstall');
  f.deps.selectInstalledTargets = () => { throw Error('must not prompt'); };
  assert.equal(await f.run('update', {}, [f.root, '--json']), 0);
  assert.deepEqual(messages, ['No installed kits to update']);
  assert.deepEqual(f.events, []);
});
test('automatic dry-run selects installed targets but never writes or locks', async t => {
  interactive(t); const f = fixture(t); f.pin();
  f.deps.selectInstalledTargets = async hosts => ({ code: 0, targets: hosts });
  assert.equal(await f.run('update', {}, [f.root, '--dry-run']), 0);
  assert.equal(f.events.includes('lock'), false); assert.equal(f.events.includes('pending'), false);
});
test('populated automatic update still requires explicit targets in JSON mode', async t => {
  interactive(t); const f = fixture(t); f.pin();
  await assert.rejects(f.run('update', {}, [f.root, '--json']), /choose hosts with --target/);
  assert.deepEqual(f.events, []);
});
test('explicit target resumes an interrupted update without the installed-only picker', async t => {
  const f = fixture(t); f.pin({ state: 'pending', operation: 'update' });
  f.deps.selectInstalledTargets = () => { throw Error('must not prompt'); };
  assert.equal(await f.run('update'), 0);
  assert.ok(f.events.includes('exact')); assert.equal(f.events.includes('download'), false);
});
test('automatic update fails closed on unsafe receipts or invalid selection', async t => {
  interactive(t); const f = fixture(t);
  f.deps.readPin = () => { throw Error('invalid installed source receipt'); };
  await assert.rejects(f.run('update', {}, [f.root]), /invalid installed source receipt/);
  assert.deepEqual(f.events, []);
  const other = fixture(t); other.pin();
  other.deps.selectInstalledTargets = async () => ({ code: 0, targets: ['omp'] });
  await assert.rejects(other.run('update', {}, [other.root]), /invalid installed kit selection/);
  assert.deepEqual(other.events, ['lock', 'unlock']);
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
