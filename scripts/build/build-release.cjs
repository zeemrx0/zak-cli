#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { assertNode } = require('../../src/shared/node-runtime');
const { STABLE, BETA, releaseRepository } = require('../../src/release/release-metadata');
const { renderBootstrap } = require('../../src/release/bootstrap-template');
const { unpack } = require('../../src/release/archive-package');
const { buildConfig } = require('../../src/zak/kit-source-config');
const { buildUpdatePicker } = require('./build-update-picker.cjs');
const RUNTIME = ['scripts/zak.cjs', 'scripts/install-zak.cjs', 'src/zak/zak-cli.js',
  'src/zak/cli-uninstall.js', 'src/release/release-download.js', 'scripts/release/install.sh.template',
  'src/zak/kit-lifecycle.js', 'src/zak/kit-source-config.js', 'src/zak/github-discovery.js',
  'src/zak/kit-source-pins.js', 'src/zak/kit-private-state.js', 'src/zak/kit-target-locator.js',
  'src/zak/kit-control-runner.js', 'src/zak/kit-update-picker.js', 'dist/installer/update-picker.cjs', 'src/zak/kit-snapshot.js', 'src/zak/pinned-source-refresh.js'];
function buildRelease(root = path.resolve(__dirname, '../..'), out = path.join(root, 'dist/release'), env = process.env) {
  assertNode();
  buildUpdatePicker(root);
  let pkg, lock;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  } catch { throw new Error('invalid CLI release metadata'); }
  if (!(STABLE.test(pkg.version) || BETA.test(pkg.version)) || lock.version !== pkg.version || lock.packages[''].version !== pkg.version)
    throw new Error('release version and lock must match a stable or beta.N version');
  const repository = releaseRepository(pkg);
  const config = buildConfig(env, repository);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zak-build-'));
  try {
    const result = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', timeout: 30000 });
    if (result.error || result.status !== 0) throw new Error('npm pack failed; no release assets written');
    let packed;
    try { packed = JSON.parse(result.stdout); } catch { throw new Error('invalid npm pack output'); }
    const entries = packed[0]?.files?.map(file => file.path);
    for (const rel of RUNTIME) if (!entries?.includes(rel)) throw new Error(`missing CLI runtime: ${rel}`);
    if (entries.some(rel => rel.startsWith('agents/') || rel.startsWith('tests/') || rel.includes('node_modules/')))
      throw new Error('unexpected guidance or development payload in CLI archive');
    const stage = unpack(fs.readFileSync(path.join(temporary, packed[0].filename)), path.join(temporary, 'stage'));
    const stagedMetadata = JSON.parse(fs.readFileSync(path.join(stage, 'package.json')));
    stagedMetadata.kitSourceConfig = config;
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(stagedMetadata, null, 2) + '\n');
    const closure = spawnSync(process.execPath, ['-e', "require('./src/zak/zak-cli')"], { cwd: stage, encoding: 'utf8', timeout: 30000 });
    if (closure.error || closure.status !== 0) throw new Error('CLI runtime closure failed; no release assets written');
    const stagedArchive = path.join(temporary, 'configured.tgz');
    const archived = spawnSync('tar', ['-czf', stagedArchive, '-C', path.dirname(stage), 'package'], { encoding: 'utf8', timeout: 30000 });
    if (archived.error || archived.status !== 0) throw new Error('configured CLI archive failed');
    const bytes = fs.readFileSync(stagedArchive);
    const digest = createHash('sha256').update(bytes).digest('hex'), archive = `zak-cli-v${pkg.version}.tgz`;
    const bootstrap = renderBootstrap(root, digest);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, archive), bytes);
    fs.writeFileSync(path.join(out, 'SHA256SUMS'), `${digest}  ${archive}\n`);
    fs.writeFileSync(path.join(out, 'install.sh'), bootstrap, { mode: 0o755 });
    return { version: pkg.version, tag: `v${pkg.version}`, repository, archive, digest, out };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
if (require.main === module) {
  try { console.log(JSON.stringify(buildRelease())); }
  catch (error) { console.error(`build-release: ${error.message}`); process.exitCode = 1; }
}
module.exports = { buildRelease, RUNTIME };
