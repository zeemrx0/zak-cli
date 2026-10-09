const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildRelease } = require('../../scripts/build/build-release.cjs');
const { unpack } = require('../../src/release/archive-package');
const { hash, files } = require('../../src/zak/cli-safety');
const { runZak } = require('../zak-release-helper.cjs');
const ROOT = path.resolve(__dirname, '../..');
const CANARY = 'fixture-private-canary/kit-8173';
const TOKEN = 'fixture-account-token-8173';
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-private-packaged-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), project = path.join(root, 'project'), bin = path.join(root, 'bin');
  for (const dir of [home, project, bin]) fs.mkdirSync(dir);
  const build = buildRelease(ROOT, path.join(root, 'release'), { ZAK_PUBLIC_REPO: 'fixture/public-kit' });
  const pkg = unpack(fs.readFileSync(path.join(build.out, build.archive)), path.join(root, 'cli'));
  const kit = path.join(root, 'payload/package'); fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(kit, 'src/installer/cli'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ name: 'z-agent-kit', version: '9.0.0',
    private: true, kitControlProtocol: 1, repository: `https://github.com/${CANARY}.git` }));
  fs.writeFileSync(path.join(kit, 'src/installer/cli/kit-control.js'), '// protocol fixture');
  fs.copyFileSync(path.join(ROOT, 'src/zak/kit-target-locator.js'), path.join(kit, 'target-locator.js'));
  fs.writeFileSync(path.join(kit, 'scripts/ship-kit.cjs'), `
const fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2);
if(process.env.GH_TOKEN||process.env.GITHUB_TOKEN)process.exit(7);
const host=a[a.indexOf('--target')+1],project=a.find(arg=>!arg.startsWith('-'));
const descriptor=require('../target-locator').resolveTarget({host,scope:'project',project});
process.on('message',m=>{if(m.sequence===1){
const readonly=a.includes('--check')||a.includes('--dry-run'),keep=process.env.FIXTURE_KEEP==='1';
if(!readonly){if(a.includes('--uninstall')){if(!keep)fs.rmSync(descriptor.lockPath,{force:true});}
else {fs.mkdirSync(descriptor.controlRoot,{recursive:true});fs.writeFileSync(descriptor.lockPath,'owned');}}
process.send({schema:1,kind:'result',sequence:2,descriptor,exitCode:0,complete:!keep});
}else process.disconnect();});process.send({schema:1,kind:'prepare',sequence:1,descriptor});`);
  const archive = path.join(root, 'kit.tgz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', path.dirname(kit), 'package']).status, 0);
  const release = { tag_name: 'v9.0.0', draft: false, prerelease: false, published_at: '2026-10-08T00:00:00Z',
    assets: [{ name: 'z-agent-kit-v9.0.0.tgz', digest: 'sha256:' + hash(fs.readFileSync(archive)) }] };
  fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify(release));
  const repository = { id: 11, owner: { id: 7 }, full_name: CANARY, private: true,
    archived: false, disabled: false, fork: false };
  fs.writeFileSync(path.join(root, 'repository.json'), JSON.stringify(repository));
  fs.writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}
const fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2),root=process.env.GH_FIXTURE;
fs.appendFileSync(p.join(root,'calls.log'),JSON.stringify(a)+'\\n');
if(process.env.FIXTURE_AUTH==='expired'){process.stderr.write(${JSON.stringify(CANARY)});process.exit(1);}
if(a[0]==='auth')process.exit(0);
if(a[0]==='release'){process.stdout.write(fs.readFileSync(p.join(root,'kit.tgz')));process.exit(0);}
const endpoint=a.at(-1);let body;
if(endpoint.endsWith('/actions/variables/ZAK_PRIVATE_REPO_URL')){
if(process.env.FIXTURE_VARIABLE_DENIED==='1'){process.stdout.write('HTTP/2.0 403 Forbidden\\n\\n{}');process.exit(1);}
body={name:'ZAK_PRIVATE_REPO_URL',value:'https://github.com/'+${JSON.stringify(CANARY)}};
}
else if(endpoint==='repos/'+${JSON.stringify(CANARY)}||endpoint==='repositories/11')body=JSON.parse(fs.readFileSync(p.join(root,'repository.json')));
else if(endpoint.endsWith('/releases/latest'))body=JSON.parse(fs.readFileSync(p.join(root,'release.json')));
else process.exit(1);
if(a.includes('--include'))process.stdout.write('HTTP/2.0 200 OK\\n\\n');
process.stdout.write(JSON.stringify(body));`, { mode: 0o755 });
  const env = { ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH, GH_FIXTURE: root,
    GH_TOKEN: TOKEN, GITHUB_TOKEN: TOKEN };
  for (const key of ['XDG_DATA_HOME', 'ZAK_ROOT', 'ZAK_RELEASE_API_URL', 'ZAK_RELEASE_BASE_URL',
    'PI_CODING_AGENT_DIR', 'PI_CONFIG_DIR', 'OMP_PROFILE', 'PI_PROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) delete env[key];
  const cli = path.join(pkg, 'scripts/zak.cjs');
  function command(operation, extra = [], overrides = {}, target = project) {
    return runZak(cli, ['kit', operation, target, '--target', 'omp', '--json', ...extra], { ...env, ...overrides }, project);
  }
  return { root, home, project, pkg, env, command, state: path.join(home, '.local/share/zak-kit-sources'),
    calls: () => fs.readFileSync(path.join(root, 'calls.log'), 'utf8').trim().split('\n') };
}
function privateReceipts(f) { return fs.readdirSync(f.state).filter(name => name.endsWith('.json')); }
function noLeaks(result) {
  assert.equal(result.output.includes(CANARY), false, 'diagnostic identity canary count');
  assert.equal(result.output.includes(TOKEN), false, 'diagnostic token canary count');
}
test('packaged private lifecycle pins exact source, preserves read-only state, and never rediscovers', { timeout: 90000 }, async t => {
  const f = fixture(t);
  const install = await f.command('install'); assert.equal(install.code, 0, install.output); noLeaks(install);
  const receipt = path.join(f.state, privateReceipts(f)[0]), before = fs.readFileSync(receipt);
  const pin = JSON.parse(before);
  assert.equal(pin.source.repository, CANARY); assert.equal(pin.source.repositoryId, 11); assert.equal(pin.state, 'installed');
  assert.equal(fs.statSync(f.state).mode & 0o777, 0o700); assert.equal(fs.statSync(receipt).mode & 0o777, 0o600);
  const lock = path.join(f.project, '.omp/zak-lock.json'), lockBefore = fs.readFileSync(lock), calls = f.calls().length;
  for (const [operation, extra] of [['check', []], ['install', ['--dry-run']], ['uninstall', ['--dry-run']]]) {
    const result = await f.command(operation, extra, { FIXTURE_AUTH: 'expired' });
    assert.equal(result.code, 0, result.output); noLeaks(result);
    assert.deepEqual(fs.readFileSync(receipt), before); assert.deepEqual(fs.readFileSync(lock), lockBefore);
  }
  assert.equal(f.calls().length, calls, 'pinned reads perform no account discovery');
  const failed = await f.command('update', [], { FIXTURE_AUTH: 'expired' });
  assert.notEqual(failed.code, 0); noLeaks(failed); assert.deepEqual(fs.readFileSync(receipt), before);
  const partial = await f.command('uninstall', [], { FIXTURE_KEEP: '1', FIXTURE_AUTH: 'expired' });
  assert.equal(partial.code, 2); noLeaks(partial); assert.equal(JSON.parse(fs.readFileSync(receipt)).state, 'cleanup-required');
  assert.equal(fs.existsSync(lock), true);
  const complete = await f.command('uninstall', [], { FIXTURE_AUTH: 'expired' });
  assert.equal(complete.code, 0); noLeaks(complete); assert.equal(privateReceipts(f).length, 0);
  assert.equal(fs.existsSync(lock), false);
  const leaks = Object.keys(files(f.pkg)).filter(rel => {
    const bytes = fs.readFileSync(path.join(f.pkg, rel)); return bytes.includes(CANARY) || bytes.includes(TOKEN);
  });
  assert.equal(leaks.length, 0, 'public package identity/token canary count');
});
test('packaged dry-run and failure paths cannot create pins or reveal private identity', { timeout: 90000 }, async t => {
  const f = fixture(t), target = path.join(f.root, 'preview'); fs.mkdirSync(target);
  const dry = await f.command('install', ['--dry-run'], {}, target);
  assert.equal(dry.code, 0, dry.output); noLeaks(dry);
  assert.equal(fs.existsSync(f.state), false); assert.equal(fs.existsSync(path.join(f.home, '.local/share/zak-kit-cache')), false);
  assert.deepEqual(fs.readdirSync(target), []);
  for (const extra of [['--repo', CANARY], ['--repo=' + CANARY], ['--transport', 'curl']]) {
    const result = await f.command('install', extra, {}, target); assert.notEqual(result.code, 0); noLeaks(result);
    assert.deepEqual(fs.readdirSync(target), []);
  }
  for (const overrides of [{ FIXTURE_AUTH: 'expired' }, { FIXTURE_VARIABLE_DENIED: '1' }]) {
    const failure = await f.command('install', [], overrides, target);
    assert.notEqual(failure.code, 0); noLeaks(failure); assert.equal(privateReceipts(f).length, 0);
    assert.deepEqual(fs.readdirSync(target), []);
  }
});
test('packaged missing pinned cache refuses latest fallback', { timeout: 90000 }, async t => {
  const f = fixture(t); const installed = await f.command('install'); assert.equal(installed.code, 0, installed.output);
  const receipt = path.join(f.state, privateReceipts(f)[0]), before = fs.readFileSync(receipt), pin = JSON.parse(before);
  const root = require('../../src/zak/kit-cache').cacheRoot(pin.source, f.env);
  fs.rmSync(path.join(root, pin.snapshot.id), { recursive: true, force: true });
  const calls = f.calls().length, result = await f.command('check');
  assert.notEqual(result.code, 0); noLeaks(result); assert.equal(f.calls().length, calls);
  assert.deepEqual(fs.readFileSync(receipt), before);
});
