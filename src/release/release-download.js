const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { STABLE, BETA, validateGithubRepository } = require('./release-metadata');
const LIMIT = 128 * 1024 * 1024;
function gh(args, env) {
  const result = spawnSync('gh', args, { env: { ...env, GH_PROMPT_DISABLED: '1' }, timeout: 60000, maxBuffer: LIMIT });
  if (result.error || result.status !== 0) throw new Error('gh request failed; check authentication and repository access');
  return result.stdout;
}
async function request(url) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`release request HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > LIMIT) throw new Error('release response exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function validateSource(source, env = process.env) {
  validateGithubRepository(source.repository);
  if (!['stable', 'beta'].includes(source.channel) || !['curl', 'gh'].includes(source.transport))
    throw new Error('unsupported release channel or transport');
  if (source.transport === 'gh' && (env.ZAK_RELEASE_API_URL || env.ZAK_RELEASE_BASE_URL))
    throw new Error('URL overrides are not supported with authenticated transport');
}
async function selectRelease(source, env = process.env) {
  validateSource(source, env);
  const api = env.ZAK_RELEASE_API_URL || `https://api.github.com/repos/${source.repository}/releases`;
  async function json(suffix) {
    const bytes = source.transport === 'gh' ? gh(['api', '--hostname', 'github.com', `repos/${source.repository}/releases${suffix}`], env) : await request(api + suffix);
    try { return JSON.parse(bytes.toString('utf8')); }
    catch (cause) { throw new Error('invalid release API JSON', { cause }); }
  }
  const eligible = release => release && release.draft === false && release.prerelease === (source.channel === 'beta') &&
    typeof release.published_at === 'string' && (source.channel === 'beta' ? BETA : STABLE).test(release.tag_name?.slice(1)) && release.tag_name.startsWith('v');
  if (source.channel === 'stable') {
    const release = await json('/latest');
    if (!eligible(release)) throw new Error('no published stable release');
    return release;
  }
  let selected, highest;
  for (let page = 1; page <= 100; page++) {
    const releases = await json(`?per_page=100&page=${page}`);
    if (!Array.isArray(releases)) throw new Error('invalid release list');
    for (const release of releases.filter(eligible)) {
      const version = release.tag_name.slice(1).replace('-beta.', '.').split('.').map(BigInt);
      const difference = highest ? version.findIndex((n, i) => n !== highest[i]) : -1;
      if (!highest || difference >= 0 && version[difference] > highest[difference]) { highest = version; selected = release; }
    }
    if (releases.length < 100) {
      if (!selected) throw new Error('no published beta release');
      return selected;
    }
  }
  throw new Error('release pagination limit exceeded');
}
async function downloadAsset(source, release, name, env = process.env) {
  validateSource(source, env);
  const assets = release.assets?.filter(asset => asset.name === name);
  if (assets?.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(assets[0].digest))
    throw new Error(`release is missing verified ${name}`);
  const base = env.ZAK_RELEASE_BASE_URL || `https://github.com/${source.repository}/releases/download/${release.tag_name}`;
  const bytes = source.transport === 'gh' ? gh(['release', 'download', release.tag_name, '--repo', `github.com/${source.repository}`, '--pattern', name, '--output', '-'], env) : await request(`${base}/${name}`);
  if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== assets[0].digest)
    throw new Error(`${name} checksum mismatch`);
  return bytes;
}
module.exports = { selectRelease, downloadAsset, validateSource };
