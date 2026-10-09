const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runControlled } = require('../../src/zak/kit-control-runner');
const { resolveTarget } = require('../../src/zak/kit-target-locator');
function fixture(t, body) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-control-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { HOME: root }, descriptor = resolveTarget({ host: 'pi', scope: 'project', project: root, env });
  const pkg = path.join(root, 'package');
  fs.mkdirSync(path.join(pkg, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'src/installer/cli'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ kitControlProtocol: 1 }));
  fs.writeFileSync(path.join(pkg, 'src/installer/cli/kit-control.js'), '// fixture');
  fs.writeFileSync(path.join(pkg, 'scripts/ship-kit.cjs'), `const descriptor=${JSON.stringify(descriptor)};\n${body}`);
  return { env, descriptor, pkg, root };
}
const approvedChild = `const fs=require('node:fs');process.on('message',m=>{
 if(m.sequence===1){fs.mkdirSync(descriptor.controlRoot);fs.writeFileSync(descriptor.lockPath,'owned');
 process.send({schema:1,kind:'result',sequence:2,descriptor,exitCode:0,complete:true});}
 else process.disconnect();});process.send({schema:1,kind:'prepare',sequence:1,descriptor});`;
test('parent verifies the target and persists intent before allowing mutation', async t => {
  const f = fixture(t, approvedChild), events = [];
  const result = await runControlled(f.pkg, [], { env: f.env, descriptor: f.descriptor,
    onPrepare(value) { assert.deepEqual(value, f.descriptor); assert.equal(fs.existsSync(value.controlRoot), false); events.push('pending'); },
    onResult(packet) { assert.equal(fs.existsSync(packet.descriptor.lockPath), true); events.push('completed'); } });
  assert.equal(result.code, 0); assert.deepEqual(events, ['pending', 'completed']);
});
test('pinned predecessor lock filename is accepted but result cannot switch targets', async t => {
  const f = fixture(t, approvedChild);
  const script = path.join(f.pkg, 'scripts/ship-kit.cjs');
  fs.writeFileSync(script, fs.readFileSync(script, 'utf8').replace('zak-lock.json', 'z-lock.json'));
  const result = await runControlled(f.pkg, [], { env: f.env, descriptor: f.descriptor,
    onPrepare(actual) { assert.equal(path.basename(actual.lockPath), 'z-lock.json'); }, onResult() {} });
  assert.equal(result.code, 0);
  const g = fixture(t, approvedChild.replace("process.send({schema:1,kind:'result'", "descriptor.lockPath=descriptor.lockPath.replace('zak-lock.json','z-lock.json');process.send({schema:1,kind:'result'"));
  await assert.rejects(runControlled(g.pkg, [], { env: g.env, descriptor: g.descriptor,
    onPrepare() {}, onResult() { throw Error('must not reach'); } }), /controlled kit failed/);
});
test('GitHub tokens remain in the parent and are not forwarded to installers', async t => {
  const f = fixture(t, `if(['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN']
.some(key=>process.env[key]!==undefined))process.exit(7);\n` + approvedChild);
  const env = { ...f.env, GH_TOKEN: 'fixture-token', GITHUB_TOKEN: 'fixture-token',
    GH_ENTERPRISE_TOKEN: 'fixture-token', GITHUB_ENTERPRISE_TOKEN: 'fixture-token' };
  const result = await runControlled(f.pkg, [], { env, descriptor: f.descriptor, onPrepare() {}, onResult() {} });
  assert.equal(result.code, 0); assert.equal(env.GH_TOKEN, 'fixture-token');
});
test('missing protocol and wrong descriptors cannot mutate a target', async t => {
  const f = fixture(t, approvedChild);
  fs.writeFileSync(path.join(f.pkg, 'package.json'), '{}');
  assert.throws(() => runControlled(f.pkg, [], { env: f.env, descriptor: f.descriptor }), /protocol/);
  assert.equal(fs.existsSync(f.descriptor.controlRoot), false);
  fs.writeFileSync(path.join(f.pkg, 'package.json'), JSON.stringify({ kitControlProtocol: 1 }));
  await assert.rejects(runControlled(f.pkg, [], { env: f.env, descriptor: { ...f.descriptor, host: 'omp' },
    onPrepare() { throw Error('must not reach'); }, onResult() {} }), /controlled kit failed/);
  assert.equal(fs.existsSync(f.descriptor.controlRoot), false);
});
test('failed result commit retains earlier pending intent and reports failure', async t => {
  const f = fixture(t, approvedChild);
  let pending = false;
  await assert.rejects(runControlled(f.pkg, [], { env: f.env, descriptor: f.descriptor,
    onPrepare() { pending = true; }, onResult() { throw Error('fixture commit failure'); } }), /pending source binding/);
  assert.equal(pending, true); assert.equal(fs.existsSync(f.descriptor.lockPath), true);
});
test('selection-only mode returns hosts without preparing or changing a target', async t => {
  const f = fixture(t, `process.on('message',()=>process.disconnect());
process.send({schema:1,kind:'selection',sequence:1,targets:['pi','codex']});`);
  const result = await runControlled(f.pkg, [], { env: f.env, mode: 'select' });
  assert.deepEqual(result.targets, ['pi', 'codex']); assert.equal(fs.existsSync(f.descriptor.controlRoot), false);
});
test('rejected children cannot hang recovery by ignoring termination', { timeout: 5000 }, async t => {
  const f = fixture(t, `process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
process.send({schema:1,kind:'prepare',sequence:9,descriptor});`);
  await assert.rejects(runControlled(f.pkg, [], { env: f.env, descriptor: f.descriptor,
    onPrepare() { throw new Error('must not reach'); }, onResult() {} }), /controlled kit failed/);
  assert.equal(fs.existsSync(f.descriptor.controlRoot), false);
});
test('unexpected child completion and malformed sequence fail without approval', async t => {
  for (const body of [`process.exit(0);`, `process.on('message',()=>{});
process.send({schema:1,kind:'prepare',sequence:9,descriptor});`]) {
    const f = fixture(t, body);
    await assert.rejects(runControlled(f.pkg, [], { env: f.env, descriptor: f.descriptor,
      onPrepare() { throw Error('must not reach'); }, onResult() {} }), /controlled kit failed/);
    assert.equal(fs.existsSync(f.descriptor.controlRoot), false);
  }
});
