const path = require('node:path');
const ui = require('./cli-ui');
const { validateConfig } = require('./kit-source-config');
const { discoverSource } = require('./github-discovery');
const { localSource, defaultLocalPath } = require('./kit-local-source');
const { readPreference, writePreference } = require('./kit-source-preference');
const USAGE = 'usage: zak kit source [public | private | local <path>]';
function label(preference) {
  return preference ? (preference.kind === 'local' ? `local ${preference.path}` : `${preference.kind} remote`) : 'automatic (private if authorized, else public)';
}
function privateAvailable(config, env, discover) {
  try { return discover(validateConfig(config), { env, channel: 'stable' }).distribution === 'private'; }
  catch { return false; }
}
async function kitSourceCommand(args, config, env = process.env, dependencies = {}) {
  const deps = { readPreference, writePreference, discoverSource, localSource, defaultLocalPath,
    prompt: () => require('../../dist/installer/update-picker.cjs'),
    tty: !!process.stdin.isTTY && !!process.stdout.isTTY, cwd: process.cwd(), ...dependencies };
  const [kind, value, ...extra] = args;
  if (extra.length || kind && !['public', 'private', 'local'].includes(kind) || kind === 'local' && !value ||
      kind && kind !== 'local' && value !== undefined) throw new Error(USAGE);
  const current = deps.readPreference(env);
  let preference;
  if (kind === 'public') { validateConfig(config); preference = { schema: 1, kind }; }
  else if (kind === 'private') {
    if (!privateAvailable(config, env, deps.discoverSource)) throw new Error('private kit source is not available for the current GitHub login');
    preference = { schema: 1, kind };
  } else if (kind === 'local') preference = { schema: 1, kind, path: deps.localSource(path.resolve(deps.cwd, value)).path };
  else if (!deps.tty) { ui.info(`Kit source: ${label(current)}`, { plain: true }); return 0; }
  else {
    const prompt = deps.prompt();
    let configured = true;
    try { validateConfig(config); } catch { configured = false; }
    const options = [{ value: 'public', label: 'Public remote', hint: configured ? undefined : 'not configured in this CLI build', disabled: !configured }];
    if (configured && privateAvailable(config, env, deps.discoverSource)) options.push({ value: 'private', label: 'Private remote' });
    options.push({ value: 'local', label: 'Local kit folder', hint: current?.kind === 'local' ? current.path : undefined });
    const initial = options.find(option => option.value === current?.kind && !option.disabled)?.value || 'local';
    const choice = await prompt.selectKitSource({ options, initialValue: initial, current: label(current) });
    if (choice === null) return 130;
    if (choice !== 'local') preference = { schema: 1, kind: choice };
    else {
      const chosen = await prompt.promptKitPath({ initialValue: current?.kind === 'local' ? current.path : deps.defaultLocalPath(deps.cwd),
        validate(input) { try { deps.localSource(path.resolve(deps.cwd, input || '')); } catch (error) { return error.message; } } });
      if (chosen === null) return 130;
      preference = { schema: 1, kind: 'local', path: deps.localSource(path.resolve(deps.cwd, chosen)).path };
    }
  }
  deps.writePreference(preference, env);
  ui.success(`Kit source: ${label(preference)}. New installs and \`zak update\` now use it.`, { plain: !deps.tty });
  return 0;
}
module.exports = { kitSourceCommand, USAGE };
