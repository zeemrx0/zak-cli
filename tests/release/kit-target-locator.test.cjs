const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const locator = require('../../src/zak/kit-target-locator');
const { syncTargetLocator } = require('../../scripts/build/sync-target-locator.cjs');
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-target-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('authoritative cross-check is explicit, not a standalone checkout dependency',
  { skip: !process.env.ZAK_TARGET_CONTRACT_SOURCE }, t => {
    const source = process.env.ZAK_TARGET_CONTRACT_SOURCE;
    syncTargetLocator({ source, check: true });
    const authoritative = require(source), root = fixture(t);
    for (const host of ['omp', 'pi', 'codex', 'claude']) for (const scope of ['project', 'global']) {
      for (const env of [{ HOME: root }, { HOME: root, OMP_PROFILE: 'work', PI_CONFIG_DIR: 'config' },
        { HOME: root, CODEX_HOME: path.join(root, 'codex-override'), PI_CODING_AGENT_DIR: path.join(root, 'pi-override') }]) {
        const options = { host, scope, project: root, env };
        assert.deepEqual(locator.resolveTarget(options), authoritative.resolveTarget(options));
      }
    }
  });
test('all hosts use expected project/global paths including Codex split roots', t => {
  const root = fixture(t), env = { HOME: root };
  const globalRoots = { omp: '.omp/agent', pi: '.pi/agent', codex: '.codex', claude: '.claude' };
  for (const host of ['omp', 'pi', 'codex', 'claude']) for (const scope of ['project', 'global']) {
    const actual = locator.resolveTarget({ host, scope, project: root, env });
    const control = path.join(root, scope === 'project' ? '.' + host : globalRoots[host]);
    assert.equal(actual.project, scope === 'global' ? null : root);
    assert.equal(actual.controlRoot, control);
    assert.equal(actual.skillsRoot, host === 'codex' ? path.join(root, '.agents/skills') : path.join(control, 'skills'));
    assert.equal(actual.lockPath, path.join(control, 'zak-lock.json'));
    assert.ok(Object.isFrozen(actual));
  }
});
test('global pin descriptor is independent of cwd and project input', t => {
  const root = fixture(t), env = { HOME: root };
  for (const host of ['omp', 'pi', 'codex', 'claude']) {
    assert.deepEqual(locator.resolveTarget({ host, scope: 'global', project: '/first', env }),
      locator.resolveTarget({ host, scope: 'global', project: '/second', env }));
  }
});
test('profile and root overrides retain exact documented paths', t => {
  const root = fixture(t);
  const cases = [
    ['omp', { HOME: root, OMP_PROFILE: 'work', PI_CONFIG_DIR: 'config' }, 'config/profiles/work/agent'],
    ['omp', { HOME: root, PI_PROFILE: 'legacy', OMP_PROFILE: '', PI_CODING_AGENT_DIR: path.join(root, 'override') }, 'override'],
    ['pi', { HOME: root, PI_CODING_AGENT_DIR: path.join(root, 'override') }, 'override'],
    ['codex', { HOME: root, CODEX_HOME: path.join(root, 'codex-override') }, 'codex-override'],
    ['claude', { HOME: root, CLAUDE_CONFIG_DIR: path.join(root, 'claude-override') }, 'claude-override']
  ];
  for (const [host, env, expected] of cases)
    assert.equal(locator.resolveTarget({ host, scope: 'global', env }).controlRoot, path.join(root, expected));
});
test('canonical target lookup rejects symlink roots, files, traversal overrides, and invalid scope', t => {
  const root = fixture(t), link = path.join(root, 'link');
  fs.symlinkSync(root, link);
  assert.throws(() => locator.resolveTarget({ host: 'pi', scope: 'project', project: link }), /unsafe/);
  fs.writeFileSync(path.join(root, '.pi'), 'foreign file');
  assert.throws(() => locator.resolveTarget({ host: 'pi', scope: 'project', project: root }), /unsafe/);
  assert.throws(() => locator.resolveTarget({ host: 'omp', scope: 'global', env: { HOME: root, PI_CONFIG_DIR: '../outside' } }), /traversal/);
  assert.throws(() => locator.resolveTarget({ host: 'pi', scope: 'invalid', project: root }), /scope/);
});
test('filesystem roots cannot be host control roots', t => {
  const root = fixture(t);
  assert.throws(() => locator.resolveTarget({ host: 'pi', scope: 'global', env: { HOME: root, PI_CODING_AGENT_DIR: path.parse(root).root } }), /unsafe|filesystem/);
});
test('missing targets under foreign-owned ancestors cannot qualify', t => {
  if (!process.getuid) return t.skip('UID ownership unavailable on this platform');
  const root = fixture(t), lstat = fs.lstatSync;
  fs.lstatSync = function(value, ...args) {
    const stat = lstat.call(fs, value, ...args);
    return value === root ? { uid: process.getuid() + 1, mode: stat.mode,
      isSymbolicLink: () => false, isDirectory: () => true } : stat;
  };
  try { assert.throws(() => locator.resolveTarget({ host: 'pi', scope: 'global', env: { HOME: root } }), /ownership/); }
  finally { fs.lstatSync = lstat; }
});
