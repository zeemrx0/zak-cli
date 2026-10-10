const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { kitLifecycle } = require('../../src/zak/kit-lifecycle');
const source = { repository: 'fixture/kit', distribution: 'public', transport: 'curl', channel: 'stable' };
const config = { schema: 2, publicRepository: source.repository, variableRepository: 'fixture/cli', privateVariable: 'ZAK_PRIVATE_REPO_URL' };
test('public multi-host lifecycle closes only after every controlled child', async t => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-session-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const previous = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  t.after(() => previous ? Object.defineProperty(process.stdout, 'isTTY', previous) : delete process.stdout.isTTY);
  const events = [];
  const dependencies = {
    readPin: () => null, writePin: () => {}, lockSources: () => () => {}, discoverSource: () => source,
    kitSnapshot: async () => ({ pkg: '/fixture', snapshot: {}, cleanup() {} }),
    async runControlled(_pkg, _args, callbacks) {
      events.push(callbacks.descriptor.host);
      await callbacks.onPrepare(callbacks.descriptor);
      await callbacks.onResult({ complete: true, exitCode: 0 });
      return { code: 0 };
    },
    finishKitSession: code => events.push(['end', code]),
  };
  assert.equal(await kitLifecycle('install', {}, [home, '--target', 'pi,claude'], config, { HOME: home }, dependencies), 0);
  assert.deepEqual(events, ['pi', 'claude', ['end', 0]]);
});
test('interactive source conflict reports its diagnostic before closing', async t => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-session-error-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const stream of [process.stdin, process.stdout]) {
    const previous = Object.getOwnPropertyDescriptor(stream, 'isTTY');
    Object.defineProperty(stream, 'isTTY', { value: true, configurable: true });
    t.after(() => previous ? Object.defineProperty(stream, 'isTTY', previous) : delete stream.isTTY);
  }
  const events = [];
  t.mock.method(console, 'error', message => events.push(message));
  const dependencies = {
    readPin: descriptor => ({ descriptor, source, state: 'installed', snapshot: {} }),
    pinnedSnapshot: () => ({ pkg: '/fixture', cleanup() {} }),
    runControlled: async () => { events.push('select'); return { code: 0, targets: ['pi'] }; },
    finishKitSession: code => events.push(['end', code]),
  };
  assert.equal(await kitLifecycle('check', { transport: 'gh' }, [home], config, { HOME: home }, dependencies), 1);
  assert.deepEqual(events, ['select', 'zak: transport conflicts with pinned source', ['end', 1]]);
});
