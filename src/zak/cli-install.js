const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertNode } = require('../shared/node-runtime');
const { releaseRepository, STABLE, BETA, validateGithubRepository } = require('../release/release-metadata');
const { hash, safeParents, files, paths, readReceipt, verifyOwned, locked } = require('./cli-safety');
const { recover, begin } = require('./cli-transaction');
function launcherBytes(root) {
  return `#!/usr/bin/env node\nconst fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');\nconst root = ${JSON.stringify(root)};\ntry {\n const receipt = JSON.parse(fs.readFileSync(path.join(root, 'receipt.json')));\n if (!/^[a-f0-9]{64}$/.test(receipt.active)) throw Error('invalid CLI generation');\n const result = cp.spawnSync(process.execPath, [path.join(root, 'releases', receipt.active, 'package/scripts/zak.cjs'), ...process.argv.slice(2)], {stdio:'inherit', env:{...process.env, ZAK_ROOT:root}});\n if (result.error) throw result.error;\n process.exitCode = result.status ?? 1;\n} catch (error) { console.error('zak: ' + error.message); process.exitCode = 1; }\n`;
}
function installCli(source, installer, repository, transport, env = process.env) {
  assertNode(); validateGithubRepository(repository);
  if (!['curl', 'gh'].includes(transport)) throw new Error('invalid CLI transport');
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'))); }
  catch (cause) { throw new Error('cannot read CLI package metadata', { cause }); }
  const channel = STABLE.test(pkg.version) ? 'stable' : BETA.test(pkg.version) ? 'beta' : null;
  if (!channel || releaseRepository(pkg) !== repository) throw new Error('CLI release identity mismatch');
  const distribution = 'public', sourceFiles = files(source);
  for (const required of ['scripts/zak.cjs'])
    if (!sourceFiles[required]) throw new Error(`incomplete CLI payload: ${required}`);
  const bootstrap = Buffer.isBuffer(installer) ? installer : fs.readFileSync(installer);
  const inventory = Object.fromEntries(Object.entries(sourceFiles).map(([rel, digest]) => [`package/${rel}`, digest]));
  inventory['install.sh'] = hash(bootstrap);
  const id = hash(Buffer.from(JSON.stringify(Object.entries(inventory).sort())));
  const { root, launcher } = paths(env), createdRoot = !fs.existsSync(root);
  if (!createdRoot && !fs.existsSync(path.join(root, 'receipt.json')) &&
      !fs.existsSync(path.join(root, '.transaction.json')) && !fs.existsSync(path.join(root, '.lifecycle-lock')))
    throw new Error('foreign CLI root; kept');
  fs.mkdirSync(root, { recursive: true });
  try {
    return locked(root, () => {
      if (fs.existsSync(root + '.uninstall.json')) throw new Error('interrupted uninstall; rerun bootstrap with --uninstall');
      recover(root, launcher);
      const existing = fs.existsSync(path.join(root, 'receipt.json')) ? readReceipt(root, launcher) : null;
      if (existing) {
        if (existing.repository !== repository || existing.distribution !== distribution || existing.transport !== transport)
          throw new Error('CLI source switch refused; self-uninstall before reinstalling');
        verifyOwned(existing);
        if (existing.active === id) return { version: pkg.version, root, launcher, changed: false };
      } else {
        if (fs.existsSync(launcher)) throw new Error(`foreign launcher; kept: ${launcher}`);
        const entries = fs.readdirSync(root).filter(entry => entry !== '.lifecycle-lock');
        if (entries.some(entry => entry !== 'releases') ||
            (entries.includes('releases') && fs.readdirSync(path.join(root, 'releases')).length))
          throw new Error('foreign CLI files; kept');
      }
      const releases = path.join(root, 'releases'), generation = path.join(releases, id);
      const stageName = `.stage-${crypto.randomUUID()}`, stage = path.join(root, stageName);
      const bytes = launcherBytes(root), launcherHash = existing?.launcherHash || hash(Buffer.from(bytes));
      const createdGeneration = !existing?.generations[id];
      const receipt = { schema: 1, root, launcher, launcherHash, repository, distribution, transport,
        channel, version: pkg.version, active: id, generations: { ...existing?.generations, [id]: inventory } };
      const next = `.receipt-${crypto.randomUUID()}.json`, nextBytes = JSON.stringify(receipt, null, 2) + '\n';
      begin(root, { id, stage: stageName, inventory, previous: existing?.active ?? null, launcherHash, createdGeneration, next, nextBytes });
      try {
        if (createdGeneration) {
        fs.mkdirSync(path.join(stage, 'package'), { recursive: true });
        for (const rel of Object.keys(sourceFiles)) {
          const dest = path.join(stage, 'package', rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(path.join(source, rel), dest);
          fs.chmodSync(dest, fs.statSync(path.join(source, rel)).mode & 0o777);
        }
        fs.writeFileSync(path.join(stage, 'install.sh'), bootstrap);
        if (JSON.stringify(Object.entries(files(stage)).sort()) !== JSON.stringify(Object.entries(inventory).sort()))
          throw new Error('CLI staging integrity mismatch');
        fs.mkdirSync(releases, { recursive: true }); fs.renameSync(stage, generation);
        }
        fs.mkdirSync(path.dirname(launcher), { recursive: true }); safeParents(launcher);
        if (!existing) fs.writeFileSync(launcher, bytes, { flag: 'wx', mode: 0o755 });
        fs.writeFileSync(path.join(root, next), nextBytes, { flag: 'wx', mode: 0o600 });
        fs.renameSync(path.join(root, next), path.join(root, 'receipt.json'));
        recover(root, launcher);
        return { version: pkg.version, root, launcher, changed: true };
      } catch (error) { recover(root, launcher); throw error; }
    });
  } catch (error) {
    if (createdRoot && !fs.existsSync(path.join(root, 'receipt.json'))) {
      const releases = path.join(root, 'releases');
      if (fs.existsSync(releases) && !fs.readdirSync(releases).length) fs.rmdirSync(releases);
      if (!fs.readdirSync(root).length) fs.rmdirSync(root);
    }
    throw error;
  }
}
module.exports = { installCli, launcherBytes };
