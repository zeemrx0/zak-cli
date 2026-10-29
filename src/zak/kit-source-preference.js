const path = require('node:path');
const { stateRoot } = require('./kit-source-pins');
const { readPrivate, writePrivate } = require('./kit-private-state');
const { validateConfig } = require('./kit-source-config');
const { localSource } = require('./kit-local-source');
const FILE = 'source-preference.json';
// The selected source applies to new installs and to updates of installed kits.
function validatePreference(value) {
  if (!value || value.schema !== 1 || !['public', 'private', 'local'].includes(value.kind) ||
      Object.keys(value).some(key => !['schema', 'kind', 'path'].includes(key)) ||
      (value.kind === 'local' ? typeof value.path !== 'string' || !path.isAbsolute(value.path) : value.path !== undefined))
    throw new Error('invalid kit source preference');
  return value.kind === 'local' ? { schema: 1, kind: 'local', path: value.path } : { schema: 1, kind: value.kind };
}
function readPreference(env = process.env) {
  const value = readPrivate(path.join(stateRoot(env), FILE));
  return value === null ? null : validatePreference(value);
}
function writePreference(value, env = process.env) {
  const preference = validatePreference(value);
  writePrivate(path.join(stateRoot(env, true), FILE), preference);
  return preference;
}
// discover(config, channel) returns the authorized GitHub source.
function preferredSource(preference, config, { transport, channel, pinnedChannel } = {}, discover) {
  if (preference.kind === 'local') {
    if (transport) throw new Error('--transport does not apply to a local kit source');
    return localSource(preference.path, channel);
  }
  const settled = validateConfig(config), selected = channel || pinnedChannel || 'stable';
  if (preference.kind === 'public')
    return { repository: settled.publicRepository, transport: transport || 'curl', channel: selected, distribution: 'public' };
  if (transport === 'curl') throw new Error('private kit requires authenticated transport');
  const found = discover(settled, selected);
  if (found?.distribution !== 'private') throw new Error('private kit source is not available for the current GitHub login');
  return found;
}
function describeSource(source) {
  return source.distribution === 'local' ? `local ${source.path}` : `${source.distribution} ${source.repository}`;
}
module.exports = { validatePreference, readPreference, writePreference, preferredSource, describeSource };
