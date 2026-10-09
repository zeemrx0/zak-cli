const { spawnSync } = require('node:child_process');
const { validateGithubRepository } = require('../release/release-metadata');
const { validateConfig, repositoryFromUrl } = require('./kit-source-config');
function failure(code) {
  const error = new Error(`GitHub source lookup failed (${code}); no fallback performed`);
  error.code = code;
  return error;
}
function discoverSource(input, { env = process.env, run = spawnSync, now = Date.now,
  channel = 'stable', deadlineMs = 60000 } = {}) {
  const config = validateConfig(input), started = now();
  if (!['stable', 'beta'].includes(channel) || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1)
    throw failure('INVALID_OPTIONS');
  const publicSource = reason => ({ repository: config.publicRepository, transport: 'curl', channel,
    distribution: 'public', reason });
  function execute(args) {
    const remaining = deadlineMs - (now() - started);
    if (remaining <= 0) throw failure('TIMEOUT');
    let result;
    try { result = run('gh', args, { env: { ...env, GH_PROMPT_DISABLED: '1' },
      encoding: 'utf8', timeout: remaining, maxBuffer: 1024 * 1024 }); }
    catch { throw failure('TRANSPORT'); }
    if (result.error && result.error.code !== 'ENOENT')
      throw failure(result.error.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'TRANSPORT');
    return result;
  }
  const auth = execute(['auth', 'status', '--active', '--hostname', 'github.com']);
  if (auth.error?.code === 'ENOENT') return publicSource('gh-unavailable');
  if (auth.status !== 0) {
    if (!(env.GH_TOKEN || env.GITHUB_TOKEN) && !auth.signal && /not logged into any GitHub hosts/i.test(String(auth.stderr)))
      return publicSource('login-unavailable');
    throw failure('AUTHENTICATION');
  }
  function api(endpoint) {
    const result = execute(['api', '--hostname', 'github.com', '--method', 'GET', '--include', endpoint]);
    if (result.error || result.signal) throw failure('TRANSPORT');
    const output = String(result.stdout || ''), separator = /\r?\n\r?\n/.exec(output);
    const header = separator ? output.slice(0, separator.index) : '';
    const status = /^HTTP\/[\d.]+\s+(\d{3})\b/.exec(header)?.[1];
    if (status === '401') throw failure('AUTHENTICATION');
    if (status === '403' || status === '429') throw failure('ACCESS_OR_RATE_LIMIT');
    if (status !== '200' || result.status !== 0) throw failure('HTTP_OR_TRANSPORT');
    try { return JSON.parse(output.slice(separator.index + separator[0].length)); }
    catch { throw failure('INVALID_RESPONSE'); }
  }
  const variable = api(`repos/${config.variableRepository}/actions/variables/${config.privateVariable}`);
  if (!variable || variable.name !== config.privateVariable || typeof variable.value !== 'string') throw failure('INVALID_VARIABLE');
  if (variable.value === '') return publicSource('private-source-disabled');
  let repository;
  try { repository = repositoryFromUrl(variable.value); } catch { throw failure('INVALID_VARIABLE'); }
  function eligible(repo) {
    if (!repo || !Number.isSafeInteger(repo.id) || repo.id <= 0 || !Number.isSafeInteger(repo.owner?.id) || repo.owner.id <= 0 ||
        typeof repo.full_name !== 'string' || repo.private !== true || repo.fork !== false || repo.archived !== false || repo.disabled !== false)
      throw failure('INVALID_PRIVATE_SOURCE');
    try { validateGithubRepository(repo.full_name); } catch { throw failure('INVALID_PRIVATE_SOURCE'); }
    return repo;
  }
  const candidate = eligible(api(`repos/${repository}`));
  if (candidate.full_name.toLowerCase() !== repository.toLowerCase()) throw failure('SOURCE_CHANGED');
  const current = eligible(api(`repositories/${candidate.id}`));
  if (current.id !== candidate.id || current.owner.id !== candidate.owner.id) throw failure('SOURCE_CHANGED');
  return { repository: current.full_name, repositoryId: current.id, ownerId: current.owner.id,
    distribution: 'private', transport: 'gh', channel, reason: 'authorized-variable' };
}
module.exports = { discoverSource };
