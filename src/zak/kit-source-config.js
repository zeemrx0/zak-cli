const { validateGithubRepository } = require('../release/release-metadata');
const PRIVATE_VARIABLE = 'ZAK_PRIVATE_REPO_URL';
function repositoryFromUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid GitHub repository URL'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash)
    throw new Error('invalid GitHub repository URL');
  return validateGithubRepository(url.pathname.slice(1).replace(/\/$/, '').replace(/\.git$/, ''));
}
function validateConfig(value) {
  if (!value || value.schema !== 2) throw new Error('unsupported kit source configuration');
  const publicRepository = validateGithubRepository(value.publicRepository);
  const variableRepository = validateGithubRepository(value.variableRepository);
  if (value.privateVariable !== PRIVATE_VARIABLE || Object.keys(value).some(key =>
    !['schema', 'publicRepository', 'variableRepository', 'privateVariable'].includes(key)))
    throw new Error('invalid protected variable configuration');
  return Object.freeze({ schema: 2, publicRepository, variableRepository, privateVariable: PRIVATE_VARIABLE });
}
function buildConfig(env, variableRepository) {
  const value = env.ZAK_PUBLIC_REPO;
  const publicRepository = typeof value === 'string' && value.startsWith('https://') ? repositoryFromUrl(value) : value;
  return validateConfig({ schema: 2, publicRepository, variableRepository, privateVariable: PRIVATE_VARIABLE });
}
module.exports = { validateConfig, buildConfig, repositoryFromUrl, PRIVATE_VARIABLE };
