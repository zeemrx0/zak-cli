const CORE = '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)';
const STABLE = new RegExp(`^${CORE}$`), BETA = new RegExp(`^${CORE}-beta\\.[1-9]\\d*$`);
function validateGithubRepository(repository) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository) ||
      ['.', '..'].includes(repository.split('/')[1])) throw new Error('expected GitHub owner/repo');
  return repository;
}
function releaseRepository(pkg) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\.git$/.exec(url || '');
  if (!match) throw new Error('package repository must be an exact GitHub URL');
  return validateGithubRepository(match[1]);
}
module.exports = { STABLE, BETA, validateGithubRepository, releaseRepository };
