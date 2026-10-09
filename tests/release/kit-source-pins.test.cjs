const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveTarget } = require('../../src/zak/kit-target-locator');
const { legacyDescriptor, compatibleDescriptor, pinKey, stateRoot, readPin, writePin, removePin, lockSources } = require('../../src/zak/kit-source-pins');
function fixture(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-pins-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home }, descriptor = resolveTarget({ host: 'pi', scope: 'project', project: home, env });
  const source = { repository: 'official/private-fixture', repositoryId: 42, ownerId: 7,
    transport: 'gh', channel: 'stable', distribution: 'private' };
  const snapshot = { id: 'a'.repeat(64), tag: 'v1.0.0', files: { 'package.json': 'b'.repeat(64),
    'scripts/ship-kit.cjs': 'c'.repeat(64), 'src/installer/cli/kit-control.js': 'd'.repeat(64) } };
  const pin = { schema: 1, state: 'pending', operation: 'install', descriptor, source, snapshot };
  return { env, home, descriptor, pin };
}
test('missing pins read without creating source state or target files', t => {
  const f = fixture(t);
  assert.equal(readPin(f.descriptor, f.env), null);
  assert.equal(fs.existsSync(stateRoot(f.env)), false);
  assert.equal(fs.existsSync(f.descriptor.controlRoot), false);
});
test('pending and completed pins remain private, target-specific, and byte-stable on reads', t => {
  const f = fixture(t); writePin(f.pin, f.env);
  const root = stateRoot(f.env), file = path.join(root, pinKey(f.descriptor) + '.json');
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const bytes = fs.readFileSync(file); assert.deepEqual(readPin(f.descriptor, f.env), f.pin);
  assert.deepEqual(fs.readFileSync(file), bytes);
  f.pin.state = 'installed'; writePin(f.pin, f.env);
  assert.equal(readPin(f.descriptor, f.env).state, 'installed');
  removePin(f.descriptor, f.env); assert.equal(readPin(f.descriptor, f.env), null);
});
test('global pins ignore project input while host, scope, and actual roots isolate keys', t => {
  const f = fixture(t), first = resolveTarget({ host: 'pi', scope: 'global', project: '/one', env: f.env });
  const second = resolveTarget({ host: 'pi', scope: 'global', project: '/two', env: f.env });
  assert.equal(pinKey(first), pinKey(second));
  assert.notEqual(pinKey(first), pinKey(f.descriptor));
  assert.notEqual(pinKey(first), pinKey(resolveTarget({ host: 'omp', scope: 'global', env: f.env })));
  assert.notEqual(pinKey(first), pinKey(resolveTarget({ host: 'pi', scope: 'global', env: { HOME: f.home,
    PI_CODING_AGENT_DIR: path.join(f.home, 'profile') } })));
});
test('symlinked state, world-readable receipts, and corrupt identities fail closed', t => {
  const f = fixture(t); writePin(f.pin, f.env);
  const file = path.join(stateRoot(f.env), pinKey(f.descriptor) + '.json');
  fs.chmodSync(file, 0o644); assert.throws(() => readPin(f.descriptor, f.env), /permissions/);
  fs.chmodSync(file, 0o600); fs.writeFileSync(file, '{invalid'); assert.throws(() => readPin(f.descriptor, f.env), /invalid/);
  fs.unlinkSync(file); fs.symlinkSync(path.join(f.home, 'outside'), file);
  assert.throws(() => readPin(f.descriptor, f.env), /symlink|unsafe/);
});
test('receipt validation rejects traversal, incompatible protocol, and source conflicts', t => {
  const f = fixture(t);
  for (const pin of [{ ...f.pin, source: { ...f.pin.source, transport: 'curl' } },
    { ...f.pin, source: { ...f.pin.source, channel: 'beta' } },
    { ...f.pin, snapshot: { ...f.pin.snapshot, files: { ...f.pin.snapshot.files, '../escape': 'e'.repeat(64) } } },
    { ...f.pin, snapshot: { ...f.pin.snapshot, files: { 'package.json': 'b'.repeat(64) } } },
    { ...f.pin, descriptor: { ...f.descriptor, project: null } }]) assert.throws(() => writePin(pin, f.env));
});
test('legacy filename receipts remain readable without writes and migrate on mutation', t => {
  const f = fixture(t), old = legacyDescriptor(f.descriptor);
  writePin({ ...f.pin, descriptor: old }, f.env);
  const legacyFile = path.join(stateRoot(f.env), pinKey(old) + '.json'), before = fs.readFileSync(legacyFile);
  assert.deepEqual(readPin(f.descriptor, f.env).descriptor, old);
  assert.deepEqual(fs.readFileSync(legacyFile), before);
  assert.equal(compatibleDescriptor(old, f.descriptor), true);
  assert.equal(compatibleDescriptor({ ...old, lockPath: path.join(f.home, 'foreign.json') }, f.descriptor), false);
  writePin(f.pin, f.env);
  assert.equal(fs.existsSync(legacyFile), false);
  assert.deepEqual(readPin(f.descriptor, f.env), f.pin);
  removePin(f.descriptor, f.env);
  writePin({ ...f.pin, descriptor: old }, f.env);
  removePin(f.descriptor, f.env);
  assert.equal(readPin(f.descriptor, f.env), null);
});
test('concurrent mutations serialize and a pending source survives interruption', t => {
  const f = fixture(t), release = lockSources(f.env);
  try { assert.throws(() => lockSources(f.env), /busy/); writePin(f.pin, f.env); }
  finally { release(); }
  assert.equal(readPin(f.descriptor, f.env).state, 'pending');
  const next = lockSources(f.env); next();
});
