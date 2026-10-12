const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { kitLifecycle } = require('../../src/zak/kit-lifecycle');
const { resolveTarget } = require('../../src/zak/kit-target-locator');
const KIT = process.env.ZAK_TARGET_KIT_SOURCE;
for (const host of ['omp', 'pi', 'codex', 'claude']) for (const scope of ['project', 'global'])
test(`zak force policy restores and removes edited ${host} ${scope} files`, { skip: !KIT }, async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-force-live-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), project = path.join(root, 'project');
  fs.mkdirSync(home); fs.mkdirSync(project);
  const env = { ...process.env, HOME: home };
  for (const key of ['XDG_DATA_HOME', 'PI_CODING_AGENT_DIR', 'PI_CONFIG_DIR', 'OMP_PROFILE', 'PI_PROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) delete env[key];
  const descriptor = resolveTarget({ host, scope, project, env });
  const source = { repository: 'fixture/kit', distribution: 'public', transport: 'curl', channel: 'stable' };
  const handle = { pkg: KIT, snapshot: { id: 'a'.repeat(64), tag: 'v1.0.0', files: {} }, cleanup() {} };
  let pin;
  const deps = {
    readPin: () => pin, writePin: value => { pin = value; }, removePin: () => { pin = undefined; },
    lockSources: () => () => {}, discoverSource: () => source, refreshPinnedSource: () => source,
    kitSnapshot: () => handle, pinnedSnapshot: () => handle,
    withGithubAccountsAsync: callback => callback(env),
  };
  const args = [scope === 'global' ? '-g' : project, '--target', host, '--tier', 'general', '--json'];
  const config = { schema: 2, publicRepository: 'fixture/kit', variableRepository: 'fixture/cli', privateVariable: 'ZAK_PRIVATE_REPO_URL' };
  const run = (operation, extra = []) => kitLifecycle(operation, {}, [...args, ...extra], config, env, deps);
  assert.equal(await run('install'), 0);
  const file = path.join(descriptor.skillsRoot, 'z-codebase-memory', 'SKILL.md');
  const original = fs.readFileSync(file);
  const unrelated = path.join(descriptor.controlRoot, 'user-config.json');
  fs.writeFileSync(unrelated, 'user data');
  fs.appendFileSync(file, '\nlocal edit\n');
  const edited = fs.readFileSync(file), lock = fs.readFileSync(descriptor.lockPath);
  assert.equal(await run('update', ['--dry-run']), 0);
  assert.deepEqual(fs.readFileSync(file), edited);
  assert.deepEqual(fs.readFileSync(descriptor.lockPath), lock);
  assert.equal(await run('update'), 0);
  assert.deepEqual(fs.readFileSync(file), original);
  assert.equal(pin.state, 'installed');
  fs.appendFileSync(file, '\nsecond local edit\n');
  const removalPreview = fs.readFileSync(file);
  assert.equal(await run('uninstall', ['--dry-run']), 0);
  assert.deepEqual(fs.readFileSync(file), removalPreview);
  assert.equal(await run('uninstall'), 0);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(descriptor.lockPath), false);
  assert.equal(pin, undefined);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'user data');
});
