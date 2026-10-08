const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const { selectRelease } = require('../../src/release/release-download');
const { cacheRoot } = require('../../src/zak/kit-cache');
test('native beta selector chooses numeric highest and never falls back to stable', async t => {
  let releases = [
    { tag_name: 'v1.2.0-beta.9', draft: false, prerelease: true, published_at: '2026-10-01' },
    { tag_name: 'v1.2.0-beta.10', draft: false, prerelease: true, published_at: '2026-10-01' },
    { tag_name: 'v9.0.0', draft: false, prerelease: false, published_at: '2026-10-01' },
    { tag_name: 'v9.0.0-beta.1', draft: true, prerelease: true, published_at: '2026-10-01' },
  ];
  const server = http.createServer((req, res) => res.end(JSON.stringify(releases)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ZAK_RELEASE_API_URL: `http://127.0.0.1:${server.address().port}` };
  const source = { repository: 'fixture/kit', channel: 'beta', transport: 'curl' };
  assert.equal((await selectRelease(source, env)).tag_name, 'v1.2.0-beta.10');
  releases = releases.filter(release => !release.prerelease);
  await assert.rejects(selectRelease(source, env), /no published beta/);
});
test('kit cache identity separates repositories, transports and channels', t => {
  const home = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + '/zak-cache-identity-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const base = { repository: 'fixture/a', channel: 'stable', transport: 'curl' };
  const roots = [base, { ...base, repository: 'fixture/b' }, { ...base, channel: 'beta' }, { ...base, transport: 'gh' }]
    .map(source => cacheRoot(source, { HOME: home }));
  assert.equal(new Set(roots).size, 4);
});
