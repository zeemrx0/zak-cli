const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('./cli-safety');
const { acquire } = require('./cli-lock');
const { validateSource } = require('../release/release-download');
const { STABLE, BETA } = require('../release/release-metadata');
const { privateDirectory, readPrivate, writePrivate } = require('./kit-private-state');
function validateDescriptor(value) {
  if (!value || value.schema !== 1 || !['omp', 'pi', 'codex', 'claude'].includes(value.host) ||
      !['project', 'global'].includes(value.scope) ||
      (value.scope === 'global' ? value.project !== null : !path.isAbsolute(value.project || '')) ||
      ['controlRoot', 'skillsRoot', 'lockPath'].some(key => typeof value[key] !== 'string' || !path.isAbsolute(value[key])))
    throw new Error('invalid source target descriptor');
  if (Object.keys(value).some(key => !['schema', 'host', 'scope', 'project', 'controlRoot', 'skillsRoot', 'lockPath'].includes(key)))
    throw new Error('unexpected source target descriptor field');
  return { schema: 1, host: value.host, scope: value.scope, project: value.project,
    controlRoot: value.controlRoot, skillsRoot: value.skillsRoot, lockPath: value.lockPath };
}
function legacyDescriptor(descriptor) {
  const value = validateDescriptor(descriptor);
  return { ...value, lockPath: path.join(value.controlRoot, value.scope === 'global' ? 'z-global-lock.json' : 'z-lock.json') };
}
function compatibleDescriptor(actual, expected) {
  const value = validateDescriptor(expected);
  const key = pinKey(actual);
  return key === pinKey(value) || path.basename(value.lockPath) === 'zak-lock.json' && key === pinKey(legacyDescriptor(value));
}
function pinKey(descriptor) { return hash(Buffer.from(JSON.stringify(validateDescriptor(descriptor)))); }
function stateRoot(env, create = false) {
  if (typeof env.HOME !== 'string' || !path.isAbsolute(env.HOME) ||
      env.XDG_DATA_HOME && !path.isAbsolute(env.XDG_DATA_HOME)) throw new Error('absolute source state home is required');
  return privateDirectory(path.join(env.XDG_DATA_HOME || path.join(env.HOME, '.local/share'), 'zak-kit-sources'), create);
}
function validateSnapshot(value) {
  if (!value || !/^[a-f0-9]{64}$/.test(value.id) || typeof value.tag !== 'string' ||
      !(STABLE.test(value.tag.slice(1)) || BETA.test(value.tag.slice(1))) || !value.tag.startsWith('v') ||
      !value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw new Error('invalid pinned kit generation');
  for (const [rel, digest] of Object.entries(value.files)) {
    if (rel.includes('\\') || rel.includes('\0') || rel.split('/').some(part => !part || part === '.' || part === '..') ||
        !/^[a-f0-9]{64}$/.test(digest)) throw new Error('unsafe pinned kit inventory');
  }
  if (!value.files['package.json'] || !value.files['scripts/ship-kit.cjs'] ||
      !value.files['src/installer/cli/kit-control.js']) throw new Error('incompatible pinned kit protocol');
}
function validatePin(value, descriptor) {
  if (!value || value.schema !== 1 || !['pending', 'installed', 'cleanup-required'].includes(value.state) ||
      !['install', 'update', 'uninstall'].includes(value.operation) ||
      pinKey(value.descriptor) !== pinKey(descriptor)) throw new Error('invalid installed source receipt');
  try { validateSource(value.source, {}); } catch { throw new Error('invalid installed source identity'); }
  if (!['public', 'private'].includes(value.source.distribution) ||
      value.source.distribution === 'private' && (value.source.transport !== 'gh' ||
        !Number.isSafeInteger(value.source.repositoryId) || value.source.repositoryId <= 0 ||
        !Number.isSafeInteger(value.source.ownerId) || value.source.ownerId <= 0))
    throw new Error('invalid installed source identity');
  validateSnapshot(value.snapshot);
  const version = value.snapshot.tag.slice(1);
  if (!(value.source.channel === 'stable' ? STABLE : BETA).test(version))
    throw new Error('pinned kit channel mismatch');
  return value;
}
function readPin(descriptor, env = process.env) {
  const value = readPrivate(path.join(stateRoot(env), pinKey(descriptor) + '.json'));
  if (value !== null) return validatePin(value, descriptor);
  if (path.basename(descriptor.lockPath) !== 'zak-lock.json') return null;
  const old = legacyDescriptor(descriptor);
  const prior = readPrivate(path.join(stateRoot(env), pinKey(old) + '.json'));
  return prior === null ? null : validatePin(prior, old);
}
function priorReceipt(descriptor, env) {
  if (path.basename(descriptor.lockPath) !== 'zak-lock.json') return null;
  const old = legacyDescriptor(descriptor);
  const file = path.join(stateRoot(env), pinKey(old) + '.json');
  const value = readPrivate(file);
  return value === null ? null : { file, value: validatePin(value, old) };
}
function writePin(value, env = process.env) {
  validatePin(value, value.descriptor);
  const prior = priorReceipt(value.descriptor, env);
  if (prior && ['repository', 'repositoryId', 'ownerId', 'distribution'].some(key => prior.value.source[key] !== value.source[key]))
    throw new Error('conflicting legacy source identity');
  writePrivate(path.join(stateRoot(env, true), pinKey(value.descriptor) + '.json'), value);
  if (prior) fs.unlinkSync(prior.file);
}
function removePin(descriptor, env = process.env) {
  const pin = readPin(descriptor, env);
  const prior = priorReceipt(descriptor, env);
  if (pin && prior && ['repository', 'repositoryId', 'ownerId', 'distribution'].some(key => prior.value.source[key] !== pin.source[key]))
    throw new Error('conflicting legacy source identity');
  if (pin !== null) fs.unlinkSync(path.join(stateRoot(env), pinKey(pin.descriptor) + '.json'));
  if (prior && pinKey(prior.value.descriptor) !== pinKey(pin?.descriptor || descriptor)) fs.unlinkSync(prior.file);
}
function lockSources(env = process.env) { return acquire(stateRoot(env, true), '.source-operation-lock'); }
module.exports = { compatibleDescriptor, legacyDescriptor, pinKey, stateRoot, validateDescriptor, validateSnapshot, readPin, writePin, removePin, lockSources };
