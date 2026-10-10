const fs = require('node:fs');
const path = require('node:path');
const { resolveTarget } = require('./kit-target-locator');
const { discoverSource } = require('./github-discovery');
const { validateConfig } = require('./kit-source-config');
const { kitSnapshot, pinnedSnapshot } = require('./kit-snapshot');
const { runControlled } = require('./kit-control-runner');
const { selectInstalledTargets, finishKitSession } = require('./kit-update-picker');
const { refreshPinnedSource } = require('./pinned-source-refresh');
const { compatibleDescriptor, readPin, writePin, removePin, lockSources } = require('./kit-source-pins');
const HOSTS = ['omp', 'pi', 'codex', 'claude'];
function targetArgs(args) {
  const result = { hosts: null, scope: 'project', project: process.cwd(), readonly: false, rest: [] };
  let positional = false;
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === '--target') {
      if (result.hosts) throw new Error('--target may be supplied only once');
      const hosts = (args[++i] || '').split(',');
      if (hosts.some(host => !HOSTS.includes(host))) throw new Error('invalid kit targets');
      result.hosts = [...new Set(hosts)];
    } else {
      result.rest.push(value);
      if (value === '--global') result.scope = 'global';
      else if (value === '--dry-run') result.readonly = true;
      else if (value === '--tier' || value === '--no-tier') {
        const tier = args[++i];
        if (!tier || tier.startsWith('--')) throw new Error('missing kit tier value');
        result.rest.push(tier);
      } else if (!value.startsWith('-')) {
        if (positional) throw new Error('only one kit project is allowed');
        positional = true; result.project = path.resolve(value);
      } else if (!['--force', '--json', '--help', '-h'].includes(value)) throw new Error('unknown kit option');
    }
  }
  if (result.scope === 'global' && positional) throw new Error('--global cannot be combined with a repository path');
  return result;
}
function compatible(source, options, operation) {
  if (options.transport && options.transport !== source.transport) throw new Error('transport conflicts with pinned source');
  if (options.channel && options.channel !== source.channel && operation !== 'update')
    throw new Error('channel changes require an explicit update');
  return { ...source, channel: options.channel || source.channel };
}
function legacy(descriptor) {
  const roots = new Set([descriptor.controlRoot, descriptor.skillsRoot,
    ...['skills', 'rules', 'z-rules', 'agents', 'extensions'].map(rel => path.join(descriptor.controlRoot, rel))]);
  let evidence = fs.existsSync(descriptor.lockPath);
  for (const root of roots) {
    const entry = fs.lstatSync(root, { throwIfNoEntry: false });
    if (!entry) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('unsafe legacy target inspection');
    if (fs.readdirSync(root).some(name => /^z[-_]|^\.z-/.test(name))) evidence = true;
  }
  const startups = [path.join(descriptor.controlRoot, 'AGENTS.md'), path.join(descriptor.controlRoot, 'APPEND_SYSTEM.md')];
  if (descriptor.project) startups.push(path.join(descriptor.project, 'AGENTS.md'));
  for (const file of startups) {
    const entry = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!entry) continue;
    if (entry.isSymbolicLink() || !entry.isFile() || entry.size > 4 * 1024 * 1024) throw new Error('unsafe legacy startup inspection');
    if (/z-agent-kit|zAgentKit/.test(fs.readFileSync(file, 'utf8'))) evidence = true;
  }
  if (evidence) throw new Error('untrusted legacy target; remove it with its original installer, review retained edits, then reinstall');
}
async function kitLifecycle(operation, options, args, config, env = process.env, dependencies = {}) {
  if (!['install', 'update', 'check', 'uninstall'].includes(operation)) throw new Error('invalid kit lifecycle operation');
  const deps = { resolveTarget, discoverSource, kitSnapshot, pinnedSnapshot, runControlled,
    readPin, writePin, removePin, lockSources, refreshPinnedSource, selectInstalledTargets, finishKitSession, ...dependencies };
  const parsed = targetArgs(args), readonly = parsed.readonly || operation === 'check';
  const operationFlags = { install: [], update: ['--update'], check: ['--check'], uninstall: ['--uninstall'] }[operation];
  const descriptorFor = host => deps.resolveTarget({ host, scope: parsed.scope, project: parsed.project, env });
  let releaseLock, picker, sessionStarted = false, sessionExit = 1;
  const visual = !args.includes("--json") && !!process.stdout.isTTY;
  try {
    let hosts = parsed.hosts;
    if (!hosts && operation === 'update') {
      const installedHosts = () => HOSTS.filter(host => deps.readPin(descriptorFor(host), env)?.state === 'installed');
      let eligible = installedHosts();
      if (!eligible.length) { console.log('No installed kits to update'); return 0; }
      if (!process.stdin.isTTY || !process.stdout.isTTY || args.includes('--json')) throw new Error('choose hosts with --target');
      if (!readonly) releaseLock = deps.lockSources(env);
      eligible = installedHosts();
      if (!eligible.length) { console.log('No installed kits to update'); return 0; }
      const selection = await deps.selectInstalledTargets(eligible);
      if (selection.code) return selection.code;
      hosts = selection.targets;
      if (!hosts?.length || hosts.some(host => !eligible.includes(host))) throw new Error('invalid installed kit selection');
    } else {
      if (!readonly) releaseLock = deps.lockSources(env);
      if (!hosts) {
        if (!process.stdin.isTTY || !process.stdout.isTTY || args.includes('--json')) throw new Error('choose hosts with --target');
        const descriptors = HOSTS.map(descriptorFor);
        const pins = descriptors.map(descriptor => deps.readPin(descriptor, env));
        const pin = pins.find(Boolean);
        if (pin) picker = deps.pinnedSnapshot(pin, env);
        else {
          if (operation !== 'install') throw new Error('no trusted source pin; use the original installer to remove legacy targets');
          const source = deps.discoverSource(validateConfig(config), { env, channel: options.channel || 'stable' });
          if (options.transport === 'curl' && source.distribution === 'private') throw new Error('private kit requires authenticated transport');
          picker = await deps.kitSnapshot({ ...source, transport: options.transport || source.transport }, { readonly: true }, env);
        }
        sessionStarted = visual;
        const selection = await deps.runControlled(picker.pkg, [...parsed.rest, ...operationFlags], { mode: 'select', env });
        if (selection.code) { sessionExit = selection.code; return selection.code; }
        hosts = selection.targets;
      }
    }
    const descriptors = hosts.map(descriptorFor);
    const plans = descriptors.map(descriptor => {
      const pin = deps.readPin(descriptor, env);
      if (!pin) {
        if (operation !== 'install') throw new Error('no trusted source pin; remove legacy targets with the original installer');
        legacy(descriptor);
      } else {
        compatible(pin.source, options, operation);
        if (pin.state !== 'installed' && operation !== 'uninstall' && pin.operation !== operation)
          throw new Error('pending source operation must be resumed or uninstalled');
        if (pin.state !== 'installed' && options.channel && options.channel !== pin.source.channel)
          throw new Error('pending source channel cannot change');
      }
      return { descriptor, pin };
    });
    let exitCode = 0;
    for (const { descriptor, pin } of plans) {
      let handle;
      try {
        let source;
        if (pin) source = compatible(pin.source, options, operation);
        else {
          source = deps.discoverSource(validateConfig(config), { env, channel: options.channel || 'stable' });
          if (options.transport === 'curl' && source.distribution === 'private') throw new Error('private kit requires authenticated transport');
          source = { ...source, transport: options.transport || source.transport };
        }
        const exact = pin && (pin.state !== 'installed' || operation === 'check' || operation === 'uninstall' || operation === 'install');
        if (pin && !exact) source = deps.refreshPinnedSource(source, { env });
        handle = exact ? deps.pinnedSnapshot(pin, env) : await deps.kitSnapshot(source, { readonly }, env);
        const pending = { schema: 1, descriptor, source, snapshot: handle.snapshot, state: 'pending', operation };
        const forwarded = [...parsed.rest, '--target', descriptor.host,
          ...operationFlags];
        sessionStarted = visual;
        const result = await deps.runControlled(handle.pkg, forwarded, { env, descriptor,
          onPrepare(actual) {
            if (!compatibleDescriptor(actual, descriptor)) throw new Error('installer target mismatch');
            pending.descriptor = actual;
            if (!readonly) deps.writePin(pending, env);
          },
          onResult(packet) {
            if (readonly) return;
            if (operation === 'uninstall' && packet.complete && packet.exitCode === 0) deps.removePin(descriptor, env);
            else deps.writePin({ ...pending, state: packet.complete && packet.exitCode === 0 ? 'installed' :
              operation === 'uninstall' ? 'cleanup-required' : 'pending' }, env);
          } });
        const code = result.code || (!readonly && result.result?.complete === false ? 2 : 0);
        if (code === 1 || exitCode === 1) exitCode = 1;
        else if (code) exitCode = code;
      } catch {
        console.error(`zak kit (${descriptor.host}): source-bound operation failed; retained state must be inspected before retrying`);
        exitCode = 1;
      } finally { handle?.cleanup(); }
    }
    sessionExit = exitCode;
    return exitCode;
  } catch (error) {
    if (!sessionStarted) throw error;
    console.error(`zak: ${error.message}`);
    return 1;
  } finally {
    picker?.cleanup(); releaseLock?.();
    if (sessionStarted) deps.finishKitSession(sessionExit);
  }
}
module.exports = { kitLifecycle, targetArgs, compatible };
