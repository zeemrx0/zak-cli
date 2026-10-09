const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { kitPackage } = require('../../src/zak/kit-cache');
const { hash } = require('../../src/zak/cli-safety');
const { sourceArgs } = require('../../src/zak/zak-cli');

test('source parsing preserves kit options and rejects ambiguous sources', () => {
  const parsed = sourceArgs(['--transport', 'gh', '--channel', 'beta', '/project with spaces', '--target', 'pi']);
  assert.deepEqual(parsed.source, { transport: 'gh', channel: 'beta' });
  assert.deepEqual(parsed.rest, ['/project with spaces', '--target', 'pi']);
  assert.deepEqual(sourceArgs([]).source, {});
  assert.throws(() => sourceArgs(['--repo', 'a/b']), /no longer supported/);
  assert.throws(() => sourceArgs(['--repo=a/b']), /no longer supported/);
});
test('private kit transport uses gh only and refuses anonymous fallback', async t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-gh-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home'), project = path.join(dir, 'project'), bin = path.join(dir, 'bin'), pkg = path.join(dir, 'kit/package');
  for (const folder of [home, project, bin, path.join(pkg, 'scripts')]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'z-agent-kit', version: '8.0.0', private: true, repository: 'https://github.com/fixture/private-kit.git' }));
  fs.writeFileSync(path.join(pkg, 'scripts/ship-kit.cjs'), "require('node:fs').writeFileSync('.private-kit', 'authenticated');");
  const archive = path.join(dir, 'kit.tgz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', path.dirname(pkg), 'package']).status, 0);
  const release = { tag_name: 'v8.0.0', draft: false, prerelease: false, published_at: '2026-10-08T00:00:00Z', assets: [{ name: 'z-agent-kit-v8.0.0.tgz', digest: `sha256:${hash(fs.readFileSync(archive))}` }] };
  fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify(release));
  const fake = `#!${process.execPath}\nconst fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2);if(process.env.GH_FAIL)process.exit(1);if(a[0]==='api')process.stdout.write(fs.readFileSync(p.join(process.env.GH_FIXTURE,'release.json')));else if(a[0]==='release'&&a[1]==='download')process.stdout.write(fs.readFileSync(p.join(process.env.GH_FIXTURE,'kit.tgz')));else process.exit(1);`;
  fs.writeFileSync(path.join(bin, 'gh'), fake, { mode: 0o755 });
  const env = { ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH, GH_FIXTURE: dir };
  for (const key of ['ZAK_ROOT', 'XDG_DATA_HOME', 'ZAK_RELEASE_API_URL', 'ZAK_RELEASE_BASE_URL']) delete env[key];
  const source = { repository: 'fixture/private-kit', transport: 'gh', channel: 'stable' };
  const installed = await kitPackage(source, true, env);
  assert.equal(fs.readFileSync(path.join(installed, 'scripts/ship-kit.cjs'), 'utf8'),
    "require('node:fs').writeFileSync('.private-kit', 'authenticated');");
  await assert.rejects(kitPackage(source, true, { ...env, GH_FAIL: '1' }), /gh request failed/);
  await assert.rejects(kitPackage(source, true, { ...env, ZAK_RELEASE_BASE_URL: 'http://127.0.0.1:1' }), /overrides/);
});
