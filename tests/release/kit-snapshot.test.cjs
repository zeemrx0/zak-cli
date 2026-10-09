const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { hash } = require('../../src/zak/cli-safety');
const { cacheRoot } = require('../../src/zak/kit-cache');
const { kitSnapshot, pinnedSnapshot } = require('../../src/zak/kit-snapshot');
async function fixture(t, protocol = 1) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-snapshot-')));
  const home = path.join(root, 'home'), pkg = path.join(root, 'payload/package');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(pkg, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'src/installer/cli'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'z-agent-kit', version: '8.0.0',
    private: false, kitControlProtocol: protocol, repository: 'https://github.com/fixture/public-kit.git' }));
  fs.writeFileSync(path.join(pkg, 'scripts/ship-kit.cjs'), '// fixture');
  fs.writeFileSync(path.join(pkg, 'src/installer/cli/kit-control.js'), '// fixture');
  const archive = path.join(root, 'kit.tgz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', path.dirname(pkg), 'package']).status, 0);
  const bytes = fs.readFileSync(archive);
  const release = { tag_name: 'v8.0.0', draft: false, prerelease: false, published_at: '2026-10-08T00:00:00Z',
    assets: [{ name: 'z-agent-kit-v8.0.0.tgz', digest: 'sha256:' + hash(bytes) }] };
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    if (req.url.endsWith('/latest')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(release)); }
    else res.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const env = { HOME: home, ZAK_RELEASE_API_URL: base + '/api/releases', ZAK_RELEASE_BASE_URL: base + '/assets' };
  const source = { repository: 'fixture/public-kit', transport: 'curl', channel: 'stable', distribution: 'public' };
  return { env, source, root, pkg, requests: () => requests };
}
test('read-only fresh snapshots remain transient and never create the cache', async t => {
  const f = await fixture(t), handle = await kitSnapshot(f.source, { readonly: true }, f.env);
  assert.equal(fs.existsSync(handle.pkg), true);
  assert.equal(fs.existsSync(cacheRoot(f.source, f.env)), false);
  assert.equal(handle.snapshot.tag, 'v8.0.0');
  handle.cleanup(); assert.equal(fs.existsSync(handle.pkg), false);
});
test('mutating snapshots protect cache receipts and pinned lookup ignores cache head', async t => {
  const f = await fixture(t), handle = await kitSnapshot(f.source, {}, f.env);
  const root = cacheRoot(f.source, f.env), receipt = path.join(root, 'cache.json');
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(receipt).mode & 0o777, 0o600);
  const before = f.requests();
  fs.writeFileSync(receipt, JSON.stringify({ id: 'f'.repeat(64), tag: 'v99.0.0' }));
  const exact = pinnedSnapshot({ source: f.source, snapshot: handle.snapshot }, f.env);
  assert.equal(exact.pkg, handle.pkg); assert.equal(f.requests(), before);
});
test('missing or edited pinned generations fail without querying latest', async t => {
  const f = await fixture(t), handle = await kitSnapshot(f.source, {}, f.env);
  const pin = { source: f.source, snapshot: handle.snapshot }, before = f.requests();
  fs.appendFileSync(path.join(handle.pkg, 'scripts/ship-kit.cjs'), '// edit');
  assert.throws(() => pinnedSnapshot(pin, f.env), /edited/);
  fs.rmSync(path.dirname(handle.pkg), { recursive: true, force: true });
  assert.throws(() => pinnedSnapshot(pin, f.env), /unavailable/);
  assert.equal(f.requests(), before);
});
test('protocol-incompatible snapshots fail before persistent cache mutation', async t => {
  const f = await fixture(t, 0);
  await assert.rejects(kitSnapshot(f.source, {}, f.env), /protocol/);
  assert.equal(fs.existsSync(cacheRoot(f.source, f.env)), false);
});
