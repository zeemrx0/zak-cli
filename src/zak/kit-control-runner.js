const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { validateDescriptor, compatibleDescriptor } = require('./kit-source-pins');
function runControlled(pkg, args, { mode = 'apply', env = process.env, descriptor,
  onPrepare, onResult, timeoutMs = 900000 } = {}) {
  if (!['apply', 'select'].includes(mode) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new Error('invalid controlled kit execution');
  let metadata;
  try { metadata = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')); }
  catch { throw new Error('invalid controlled kit metadata'); }
  if (metadata.kitControlProtocol !== 1 || !fs.existsSync(path.join(pkg, 'src/installer/cli/kit-control.js')))
    throw new Error('kit release requires source-control protocol 1');
  const childEnv = { ...env, ZAK_KIT_CONTROL: mode };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete childEnv[key];
  const expected = mode === 'apply' ? validateDescriptor(descriptor) : null;
  return new Promise((resolve, reject) => {
    let child, fatal, killTimer, prepared = false, preparedDescriptor, result, targets, nextSequence = 1, busy = false;
    const error = () => new Error('controlled kit failed; any pending source binding was retained');
    const stop = () => {
      if (fatal) return;
      fatal = true;
      child?.kill('SIGTERM');
      killTimer = setTimeout(() => child?.kill('SIGKILL'), 2000);
    };
    try { child = fork(path.join(pkg, 'scripts/ship-kit.cjs'), args,
      { env: childEnv, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] }); }
    catch { reject(error()); return; }
    const timer = setTimeout(stop, timeoutMs);
    child.on('message', packet => {
      if (fatal || busy) return stop();
      busy = true;
      Promise.resolve().then(async () => {
        if (!packet || packet.schema !== 1 || packet.sequence !== nextSequence++ ||
            Buffer.byteLength(JSON.stringify(packet)) > 65536) throw error();
        if (mode === 'select' && packet.kind === 'selection' && !targets) {
          if (!Array.isArray(packet.targets) || !packet.targets.length || packet.targets.length > 4 ||
              packet.targets.some(host => !['omp', 'pi', 'codex', 'claude'].includes(host)) ||
              new Set(packet.targets).size !== packet.targets.length) throw error();
          targets = packet.targets;
        } else if (mode === 'apply' && packet.kind === 'prepare' && !prepared) {
          if (!compatibleDescriptor(packet.descriptor, expected) || typeof onPrepare !== 'function') throw error();
          await onPrepare(packet.descriptor);
          preparedDescriptor = validateDescriptor(packet.descriptor);
          prepared = true;
        } else if (mode === 'apply' && packet.kind === 'result' && prepared && !result) {
          if (JSON.stringify(validateDescriptor(packet.descriptor)) !== JSON.stringify(preparedDescriptor) ||
              !Number.isInteger(packet.exitCode) || packet.exitCode < 0 || packet.exitCode > 255 ||
              typeof packet.complete !== 'boolean' || typeof onResult !== 'function') throw error();
          await onResult(packet);
          result = packet;
        } else throw error();
        if (fatal || !child.connected) throw error();
        busy = false;
        child.send({ schema: 1, kind: 'ack', sequence: packet.sequence, approve: true }, sendError => { if (sendError) stop(); });
      }).catch(stop);
    });
    child.once('error', () => { clearTimeout(timer); clearTimeout(killTimer); reject(error()); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (fatal || signal || code === null || busy || code !== 130 && (mode === 'select' ? !targets : !result)) return reject(error());
      resolve({ code, targets: targets || [], result });
    });
  });
}
module.exports = { runControlled };
