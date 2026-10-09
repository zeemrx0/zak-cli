const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { kitLifecycle } = require('../../src/zak/kit-lifecycle');
const { resolveTarget } = require('../../src/zak/kit-target-locator');
const { legacyDescriptor, writePin, readPin, stateRoot } = require('../../src/zak/kit-source-pins');
const { runControlled } = require('../../src/zak/kit-control-runner');
for (const host of ['omp', 'pi', 'codex', 'claude']) for (const scope of ['project', 'global']) {
  test(`${host} ${scope} trusted predecessor can check, update and uninstall`, async t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-old-lifecycle-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const env = { HOME: root };
    const descriptor = resolveTarget({ host, scope, project: root, env });
    const old = legacyDescriptor(descriptor);
    fs.mkdirSync(old.controlRoot, { recursive: true }); fs.writeFileSync(old.lockPath, 'owned');
    const source = { repository: 'fixture/old-private-kit', repositoryId: 42, ownerId: 7,
      transport: 'gh', channel: 'stable', distribution: 'private' };
    const snapshot = { id: 'a'.repeat(64), tag: 'v1.0.0', files: { 'package.json': 'b'.repeat(64),
      'scripts/ship-kit.cjs': 'c'.repeat(64), 'src/installer/cli/kit-control.js': 'd'.repeat(64) } };
    const pin = { schema: 1, descriptor: old, source, snapshot, state: 'installed', operation: 'install' };
    writePin(pin, env);
    function pkg(name, actual) {
      const folder = path.join(root, name);
      fs.mkdirSync(path.join(folder, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(folder, 'src/installer/cli'), { recursive: true });
      fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ kitControlProtocol: 1 }));
      fs.writeFileSync(path.join(folder, 'src/installer/cli/kit-control.js'), '// fixture');
      fs.writeFileSync(path.join(folder, 'scripts/ship-kit.cjs'), `
const fs=require('node:fs'),descriptor=${JSON.stringify(actual)},args=process.argv.slice(2);
process.on('message',m=>{if(m.sequence===1){
if(!args.includes('--check')&&!args.includes('--dry-run')){
if(args.includes('--uninstall'))fs.rmSync(descriptor.lockPath,{force:true});
else {const legacy=${JSON.stringify(old.lockPath)};if(legacy!==descriptor.lockPath&&fs.existsSync(legacy))fs.renameSync(legacy,descriptor.lockPath);}}
process.send({schema:1,kind:'result',sequence:2,descriptor,exitCode:0,complete:true});
}else process.disconnect();});process.send({schema:1,kind:'prepare',sequence:1,descriptor});`);
      return { pkg: folder, snapshot, cleanup() {} };
    }
    const predecessor = pkg('old-package', old), current = pkg('new-package', descriptor);
    const config = { schema: 2, publicRepository: source.repository, variableRepository: 'fixture/cli', privateVariable: 'ZAK_PRIVATE_REPO_URL' };
    const deps = { runControlled, pinnedSnapshot: () => predecessor, kitSnapshot: () => current,
      refreshPinnedSource: value => ({ ...value, repository: 'fixture/renamed-private-kit' }), discoverSource() { throw Error('must not rediscover'); } };
    const args = [...(scope === 'global' ? ['--global'] : [root]), '--target', host];
    const before = fs.readFileSync(path.join(stateRoot(env), fs.readdirSync(stateRoot(env))[0]));
    assert.equal(await kitLifecycle('check', {}, args, config, env, deps), 0);
    assert.deepEqual(fs.readFileSync(path.join(stateRoot(env), fs.readdirSync(stateRoot(env))[0])), before);
    assert.equal(await kitLifecycle('update', {}, args, config, env, deps), 0);
    assert.deepEqual(readPin(descriptor, env).descriptor, descriptor);
    assert.equal(readPin(descriptor, env).source.repository, 'fixture/renamed-private-kit');
    assert.equal(fs.existsSync(old.lockPath), false);
    deps.pinnedSnapshot = () => current;
    assert.equal(await kitLifecycle('uninstall', {}, args, config, env, deps), 0);
    assert.equal(readPin(descriptor, env), null);
    // Uninstall also works directly through the source-pinned predecessor.
    writePin(pin, env); fs.writeFileSync(old.lockPath, 'owned'); deps.pinnedSnapshot = () => predecessor;
    assert.equal(await kitLifecycle('uninstall', {}, args, config, env, deps), 0);
    assert.equal(readPin(descriptor, env), null);
  });
}
