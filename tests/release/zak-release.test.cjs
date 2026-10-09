const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { buildRelease } = require('../../scripts/build/build-release.cjs');
const { runZak, runProcess } = require('../zak-release-helper.cjs');
const { unpack } = require('../../src/release/archive-package');
const { hash } = require('../../src/zak/cli-safety');
const ROOT = path.resolve(__dirname, '../..');
function metadata(tag, name, bytes) {
  return { tag_name: tag, draft: false, prerelease: tag.includes('-beta.'), published_at: '2026-10-08T00:00:00Z', assets: [{ name, digest: `sha256:${hash(bytes)}` }] };
}
test('real CLI release upgrades independently and preserves kit state/cache', { timeout: 90000 }, async t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-e2e-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home'), project = path.join(dir, 'project'); fs.mkdirSync(home); fs.mkdirSync(project);
  const firstRoot = path.join(dir, 'cli-source'); fs.mkdirSync(firstRoot);
  for (const rel of ['src', 'scripts', 'package.json', 'package-lock.json', 'README.md', 'LICENSE'])
    fs.cpSync(path.join(ROOT, rel), path.join(firstRoot, rel), { recursive: true });

  const buildEnv = { ZAK_PUBLIC_REPO: 'fixture/kit' };
  const first = buildRelease(firstRoot, path.join(dir, 'release0'), buildEnv);
  const firstBytes = fs.readFileSync(path.join(first.out, first.archive));
  const nextRoot = unpack(firstBytes, path.join(dir, 'next-source'));
  const pkg = JSON.parse(fs.readFileSync(path.join(nextRoot, 'package.json')));
  const [major, minor, patch] = pkg.version.split('-')[0].split('.').map(Number);
  pkg.version = `${major}.${minor}.${patch + 1}`;
  fs.writeFileSync(path.join(nextRoot, 'package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(nextRoot, 'package-lock.json'), JSON.stringify({ version: pkg.version, lockfileVersion: 3, packages: { '': { version: pkg.version } } }));
  const second = buildRelease(nextRoot, path.join(dir, 'release1'), buildEnv);
  assert.notEqual(second.archive, first.archive, 'upgrade fixture must use a distinct version');
  const secondBytes = fs.readFileSync(path.join(second.out, second.archive));
  const kitRoot = path.join(dir, 'kit/package'); fs.mkdirSync(path.join(kitRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(kitRoot, 'package.json'), JSON.stringify({ name: 'z-agent-kit', version: '9.0.0',
    kitControlProtocol: 1, repository: 'https://github.com/fixture/kit.git' }));
  fs.mkdirSync(path.join(kitRoot, 'src/installer/cli'), { recursive: true });
  fs.writeFileSync(path.join(kitRoot, 'src/installer/cli/kit-control.js'), '// fixture protocol');
  fs.copyFileSync(path.join(ROOT, 'src/zak/kit-target-locator.js'), path.join(kitRoot, 'target-locator.js'));
  fs.writeFileSync(path.join(kitRoot, 'scripts/ship-kit.cjs'), `
const fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2),f=p.join(process.cwd(),'.fixture-kit');
const host=a[a.indexOf('--target')+1];const descriptor=require('../target-locator').resolveTarget({host,scope:'project',project:process.cwd()});
process.on('message',m=>{if(m.sequence===1){
if(a.includes('--uninstall')){fs.rmSync(descriptor.lockPath,{force:true});fs.rmSync(f,{force:true});}
else if(!a.includes('--check')){fs.mkdirSync(descriptor.controlRoot,{recursive:true});fs.writeFileSync(descriptor.lockPath,'owned');fs.writeFileSync(f,'kit 9.0.0');}
else if(fs.readFileSync(f,'utf8')!=='kit 9.0.0')process.exitCode=2;
process.send({schema:1,kind:'result',sequence:2,descriptor,exitCode:process.exitCode||0,complete:!process.exitCode});
}else process.disconnect();});process.send({schema:1,kind:'prepare',sequence:1,descriptor});`);
  const kitArchive = path.join(dir, 'kit.tgz');
  assert.equal(spawnSync('tar', ['-czf', kitArchive, '-C', path.dirname(kitRoot), 'package']).status, 0);
  const kitBytes = fs.readFileSync(kitArchive); let corrupt = false, requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    if (req.url === '/api/latest') res.end(JSON.stringify(metadata(second.tag, second.archive, secondBytes)));
    else if (req.url === '/kit-api/latest') res.end(JSON.stringify(metadata('v9.0.0', 'z-agent-kit-v9.0.0.tgz', kitBytes)));
    else if (req.url === `/${first.archive}`) res.end(firstBytes);
    else if (req.url === `/${second.archive}`) res.end(corrupt ? Buffer.concat([secondBytes, Buffer.from('corrupt')]) : secondBytes);
    else if (req.url === '/z-agent-kit-v9.0.0.tgz') res.end(kitBytes);
    else res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, HOME: home, USERPROFILE: home, ZAK_RELEASE_BASE_URL: url, ZAK_RELEASE_API_URL: url + '/api' };
  for (const key of ['ZAK_ROOT', 'XDG_DATA_HOME', 'PI_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) delete env[key];
  const bootstrap = await runProcess('sh', [path.join(first.out, 'install.sh')], env, project);
  assert.equal(bootstrap.code, 0, bootstrap.output);
  const launcher = path.join(home, '.local/bin/zak');
  const command = async (args, overrides = {}) => {
    const result = await runZak(launcher, args, { ...env, ...overrides }, project);
    assert.equal(result.code, 0, result.output); return result.output;
  };
  assert.equal((await command(['--version'])).trim(), first.version);
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}\nprocess.stderr.write('not logged into any GitHub hosts');process.exit(1);`, { mode: 0o755 });
  const kitOptions = ['--target', 'omp,codex', '--json'];
  const kitEnv = { ZAK_RELEASE_API_URL: url + '/kit-api', PATH: bin + ':' + process.env.PATH, GH_TOKEN: '', GITHUB_TOKEN: '' };
  await command(['kit', 'install', ...kitOptions], kitEnv);
  const beforeKit = fs.readFileSync(path.join(project, '.fixture-kit'));
  const receipt = path.join(home, '.local/share/zak/receipt.json');
  corrupt = true;
  const failed = await runZak(launcher, ['self-update'], env, project);
  assert.notEqual(failed.code, 0); assert.match(failed.output, /checksum mismatch/);
  assert.equal((await command(['--version'])).trim(), first.version);
  corrupt = false; await command(['self-update']);
  assert.equal((await command(['--version'])).trim(), second.version);
  assert.deepEqual(fs.readFileSync(path.join(project, '.fixture-kit')), beforeKit);
  const beforeCli = fs.readFileSync(receipt);
  await command(['kit', 'update', ...kitOptions], kitEnv);
  assert.deepEqual(fs.readFileSync(receipt), beforeCli);
  const beforeRequests = requests;
  await command(['kit', 'check', ...kitOptions], kitEnv);
  assert.equal(requests, beforeRequests, 'check did not reuse cached kit');
  const active = JSON.parse(fs.readFileSync(receipt)), cliRoot = path.dirname(receipt);
  const uninstallModule = path.join(cliRoot, 'releases', active.active, 'package/src/zak/cli-uninstall.js');
  const interruptedScript = `const fs=require('node:fs'),rmdir=fs.rmdirSync;fs.rmdirSync=p=>{if(p===${JSON.stringify(cliRoot)})throw Error('injected final cleanup');return rmdir(p);};try{require(${JSON.stringify(uninstallModule)}).selfUninstall([]);}catch(error){console.error(error.message);process.exitCode=3;}`;
  const interrupted = await runProcess(process.execPath, ['-e', interruptedScript], env, project);
  assert.equal(interrupted.code, 3, interrupted.output);
  assert.ok(fs.existsSync(cliRoot + '.uninstall.json'));
  const resumed = await runProcess('sh', [path.join(first.out, 'install.sh'), '--uninstall'], env, project);
  assert.equal(resumed.code, 0, resumed.output);
  assert.equal(fs.existsSync(cliRoot + '.uninstall.json'), false);
  assert.equal(fs.existsSync(launcher), false);
  assert.deepEqual(fs.readFileSync(path.join(project, '.fixture-kit')), beforeKit);
  assert.ok(fs.existsSync(path.join(home, '.local/share/zak-kit-cache')));
});
