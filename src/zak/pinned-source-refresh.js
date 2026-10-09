const { spawnSync } = require('node:child_process');
const { validateGithubRepository } = require('../release/release-metadata');
function refreshPinnedSource(source, { env = process.env, run = spawnSync } = {}) {
  if (source.distribution !== 'private') return source;
  let result, repo;
  try {
    result = run('gh', ['api', '--hostname', 'github.com', '--method', 'GET', `repositories/${source.repositoryId}`],
      { env: { ...env, GH_PROMPT_DISABLED: '1' }, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
    if (result.error || result.signal || result.status !== 0) throw new Error('request failed');
    repo = JSON.parse(result.stdout);
    validateGithubRepository(repo.full_name);
  } catch { throw new Error('pinned source access could not be verified; no fallback performed'); }
  if (repo.id !== source.repositoryId || repo.owner?.id !== source.ownerId || repo.private !== true ||
      repo.fork !== false || repo.archived !== false || repo.disabled !== false)
    throw new Error('pinned source identity changed; no fallback performed');
  return { ...source, repository: repo.full_name };
}
module.exports = { refreshPinnedSource };
