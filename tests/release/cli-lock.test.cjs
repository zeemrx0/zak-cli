const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
test('competing stale-lock recoverers cannot enter concurrently or release another owner', { timeout: 5000 }, async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zak-lock-race-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.lifecycle-lock'));
  fs.writeFileSync(path.join(root, '.lifecycle-lock/owner.json'), JSON.stringify({ pid: 2147483647, token: 'dead' }));
  const modulePath = path.resolve(__dirname, '../../src/zak/cli-lock.js');
  const script = `let release;process.on('message',m=>{if(m==='go'){try{release=require(${JSON.stringify(modulePath)}).acquire(${JSON.stringify(root)},'.lifecycle-lock');process.send('entered');}catch(e){process.send('blocked');process.exitCode=0;process.disconnect();}}else if(m==='release'){release();process.disconnect();}});process.send('ready');`;
  const children = [], outcomes = [];
  const ready = [], finished = [];
  let settleOutcomes;
  const allOutcomes = new Promise(resolve => { settleOutcomes = resolve; });
  for (let i = 0; i < 2; i++) {
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    children.push(child);
    t.after(() => { if (child.exitCode === null) child.kill(); });
    ready.push(new Promise(resolve => child.on('message', message => {
      if (message === 'ready') resolve();
      else { outcomes.push({ child, message }); if (outcomes.length === 2) settleOutcomes(); }
    })));
    finished.push(new Promise(resolve => child.once('close', resolve)));
  }
  await Promise.all(ready); children.forEach(child => child.send('go'));
  await allOutcomes;
  assert.equal(outcomes.filter(outcome => outcome.message === 'entered').length, 1);
  outcomes.find(outcome => outcome.message === 'entered').child.send('release');
  await Promise.all(finished);
  assert.equal(fs.existsSync(path.join(root, '.lifecycle-lock')), false);
});
