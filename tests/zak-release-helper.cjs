const { spawn } = require('node:child_process');
function runProcess(executable, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, output }));
  });
}
const runZak = (launcher, args, env, cwd) => runProcess(process.execPath, [launcher, ...args], env, cwd);
module.exports = { runZak, runProcess };
