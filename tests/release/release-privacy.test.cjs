const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildRelease, RUNTIME } = require('../../scripts/build/build-release.cjs');
const { unpack } = require('../../src/release/archive-package');
const { files, hash } = require('../../src/zak/cli-safety');
const ROOT = path.resolve(__dirname, '../..');
const ENV = { ZAK_PUBLIC_REPO: 'fixture/public-kit' };
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-release-privacy-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  for (const rel of ['src', 'scripts', 'package.json', 'package-lock.json', 'README.md', 'LICENSE'])
    fs.cpSync(path.join(ROOT, rel), path.join(source, rel), { recursive: true });
  return { root, source, out: path.join(root, 'out') };
}
test('missing and invalid public configuration fail before release outputs', t => {
  const f = fixture(t);
  for (const env of [{}, { ...ENV, ZAK_PUBLIC_REPO: 'invalid' }, { ...ENV, ZAK_PUBLIC_REPO: 'https://untrusted.test/owner/repo' }]) {
    assert.throws(() => buildRelease(f.source, f.out, env));
    assert.equal(fs.existsSync(f.out), false);
  }
});
test('configured archive has runtime closure and excludes identity/token canaries', t => {
  const f = fixture(t), marker = 'fixture-private-identity-canary-8173';
  const pkgFile = path.join(f.source, 'package.json'), pkg = JSON.parse(fs.readFileSync(pkgFile));
  pkg.kitSourceConfig = { privateRepository: marker };
  pkg.scripts.prepack = "node -e \"require('node:fs').writeFileSync('hook-ran','yes')\"";
  fs.writeFileSync(pkgFile, JSON.stringify(pkg));
  const original = fs.readFileSync(pkgFile);
  const build = buildRelease(f.source, f.out, { ...ENV, GH_TOKEN: marker, GITHUB_TOKEN: marker,
    ZAK_PRIVATE_REPO: marker, ZAK_PRIVATE_REPO_URL: marker, ZAK_PRIVATE_REPOSITORY_ID: marker });
  assert.deepEqual(fs.readFileSync(pkgFile), original); assert.equal(fs.existsSync(path.join(f.source, 'hook-ran')), false);
  const bytes = fs.readFileSync(path.join(f.out, build.archive)); assert.equal(hash(bytes), build.digest);
  const packed = unpack(bytes, path.join(f.root, 'unpacked'));
  const metadata = JSON.parse(fs.readFileSync(path.join(packed, 'package.json')));
  assert.deepEqual(metadata.kitSourceConfig, { schema: 2, publicRepository: ENV.ZAK_PUBLIC_REPO, variableRepository: build.repository, privateVariable: 'ZAK_PRIVATE_REPO_URL' });
  const inventory = files(packed);
  for (const rel of RUNTIME) assert.ok(inventory[rel], 'required runtime is present');
  const leaks = Object.keys(inventory).filter(rel => fs.readFileSync(path.join(packed, rel)).includes(marker));
  assert.equal(leaks.length, 0, 'public archive identity canary count');
  for (const rel of ['install.sh', 'SHA256SUMS']) assert.equal(fs.readFileSync(path.join(f.out, rel)).includes(marker), false);
  const probe = spawnSync(process.execPath, [path.join(packed, 'scripts/zak.cjs'), '--help'], { encoding: 'utf8' });
  assert.equal(probe.status, 0); assert.equal(probe.stdout.includes('--repo'), false);
  assert.equal(fs.existsSync(path.join(packed, 'agents')), false);
  for (const command of [['update'], ['kit', 'update']]) {
    const empty = spawnSync(process.execPath, [path.join(packed, 'scripts/zak.cjs'), ...command, packed], {
      encoding: 'utf8', env: { ...process.env, HOME: f.root, XDG_DATA_HOME: path.join(f.root, 'data') },
    });
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(empty.stdout.trim(), 'No installed kits to update');
    assert.equal(fs.existsSync(path.join(f.root, 'data')), false);
  }
});
test('missing required runtime and unresolved imports prevent release outputs', t => {
  for (const rel of ['src/zak/kit-control-runner.js', 'src/zak/kit-update-picker.js', 'src/zak/cli-lock.js']) {
    const f = fixture(t); fs.unlinkSync(path.join(f.source, rel));
    assert.throws(() => buildRelease(f.source, f.out, ENV), /runtime/);
    assert.equal(fs.existsSync(f.out), false);
  }
});
test('workflow passes public configuration only to the build and keeps publishing isolated', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
  const block = workflow.split('      - name: Build configured CLI\n')[1].split('      - name: Publish verified assets\n')[0];
  for (const key of Object.keys(ENV)) assert.ok(block.includes(key + ': ${{ vars.' + key + ' }}'));
  assert.equal(block.includes('GH_TOKEN'), false); assert.equal(block.includes('secrets.'), false);
  assert.ok(workflow.includes('contents: write'));
});
