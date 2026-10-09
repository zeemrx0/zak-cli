const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverSource } = require('../../src/zak/github-discovery');
const { validateConfig, buildConfig, repositoryFromUrl } = require('../../src/zak/kit-source-config');
const config = { schema: 2, publicRepository: 'official/public-fixture', variableRepository: 'official/cli-fixture',
  privateVariable: 'ZAK_PRIVATE_REPO_URL' };
const repository = changes => ({ id: 42, full_name: 'official/private-fixture', owner: { id: 7 },
  private: true, fork: false, archived: false, disabled: false, ...changes });
const variable = changes => ({ name: config.privateVariable, value: 'https://github.com/official/private-fixture.git', ...changes });
function response(body, status = 200) {
  return { status: status === 200 ? 0 : 1, stdout: `HTTP/2.0 ${status} Test\nContent-Type: application/json\n\n${JSON.stringify(body)}` };
}
function fixture({ value = variable(), detail = repository(), current = detail } = {}) {
  const calls = [];
  const run = (_, args) => {
    calls.push(args);
    if (args[0] === 'auth') return { status: 0 };
    const endpoint = args.at(-1);
    const body = endpoint.includes('/actions/variables/') ? value : endpoint === 'repositories/42' ? current : detail;
    return body?.stdout !== undefined ? body : response(body);
  };
  return { calls, run, env: {} };
}
test('public configuration names only fallback and protected variable location', () => {
  const value = buildConfig({ ZAK_PUBLIC_REPO: 'https://github.com/official/public-fixture.git',
    ZAK_PRIVATE_REPO_URL: 'ignored-private-canary' }, config.variableRepository);
  assert.deepEqual(value, config); assert.ok(Object.isFrozen(value));
  for (const changes of [{ schema: 1 }, { privateVariable: 'OTHER' }, { variableRepository: '../invalid' },
    { privateRepository: 'private-canary' }, { topic: 'obsolete' }, { ownerIds: [7] }])
    assert.throws(() => validateConfig({ ...config, ...changes }));
  assert.throws(() => buildConfig({}, config.variableRepository));
});
test('repository URLs must be credential-free HTTPS GitHub repository addresses', () => {
  assert.equal(repositoryFromUrl('https://github.com/owner/repo/'), 'owner/repo');
  for (const value of ['owner/repo', 'http://github.com/owner/repo', 'https://untrusted.test/owner/repo',
    'https://user:password@github.com/owner/repo', 'https://github.com/owner/repo?token=canary',
    'https://github.com/owner/repo#canary', 'https://github.com/owner', 'https://github.com/owner/repo/tree/main'])
    assert.throws(() => repositoryFromUrl(value));
});
test('protected URL is read from the CLI repository and private identity is revalidated', () => {
  const f = fixture(), source = discoverSource(config, f);
  assert.equal(source.repositoryId, 42); assert.equal(source.transport, 'gh'); assert.equal(source.reason, 'authorized-variable');
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[1].at(-1), 'repos/official/cli-fixture/actions/variables/ZAK_PRIVATE_REPO_URL');
  assert.equal(f.calls[2].at(-1), 'repos/official/private-fixture');
  assert.equal(f.calls[3].at(-1), 'repositories/42');
  assert.ok(!f.calls.some(args => /user\/repos|\/topics/.test(args.at(-1))));
});
test('only missing gh or genuinely absent login permits authentication fallback', () => {
  assert.equal(discoverSource(config, { env: {}, run: () => ({ error: { code: 'ENOENT' } }) }).reason, 'gh-unavailable');
  const run = () => ({ status: 1, stderr: 'You are not logged into any GitHub hosts.' });
  assert.equal(discoverSource(config, { env: {}, run }).reason, 'login-unavailable');
  assert.throws(() => discoverSource(config, { env: { GH_TOKEN: 'fixture-only' }, run }), /AUTHENTICATION/);
  assert.throws(() => discoverSource(config, { env: {}, run: () => ({ status: 1, stderr: 'invalid token private-canary' }) }),
    error => error.code === 'AUTHENTICATION' && !error.message.includes('private-canary'));
});
test('an explicitly empty variable disables private selection without repository enumeration', () => {
  const f = fixture({ value: variable({ value: '' }) });
  assert.equal(discoverSource(config, f).reason, 'private-source-disabled'); assert.equal(f.calls.length, 2);
});
test('missing variable, insufficient collaborator permission, rate limit, and outages never fallback', () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const f = fixture({ value: response({ message: 'private-canary' }, status) });
    assert.throws(() => discoverSource(config, f), error => !error.message.includes('private-canary'));
    assert.equal(f.calls.length, 2);
  }
});
test('variable values are validated without exposing malformed addresses or names', () => {
  for (const value of [null, {}, variable({ name: 'WRONG' }), variable({ value: 123 }),
    variable({ value: 'private-canary' }), variable({ value: 'https://user:private-canary@github.com/owner/repo' }),
    { status: 0, stdout: 'HTTP/2.0 200 OK\n\nprivate-canary' }]) {
    assert.throws(() => discoverSource(config, fixture({ value })), error => !error.message.includes('private-canary'));
  }
});
test('public, forked, archived, disabled, malformed or substituted private sources stop safely', () => {
  for (const change of [{ private: false }, { fork: true }, { archived: true }, { disabled: true },
    { id: 0 }, { owner: { id: 0 } }, { full_name: 'other/substitute' }])
    assert.throws(() => discoverSource(config, fixture({ detail: repository(change) })));
});
test('identity changes or revoked access during revalidation stop without substitution', () => {
  for (const current of [repository({ owner: { id: 8 } }), repository({ id: 43 }), response({}, 404)])
    assert.throws(() => discoverSource(config, fixture({ current })));
  const f = fixture({ current: repository({ full_name: 'official/renamed-fixture' }) });
  assert.equal(discoverSource(config, f).repository, 'official/renamed-fixture');
});
test('HTTP/header failures, timeouts, and subprocess errors remain bounded and redacted', () => {
  for (const value of [{ status: 0, stdout: 'not HTTP private-canary' },
    { status: 0, stdout: 'HTTP/2.0 200 OK\n\ninvalid' }])
    assert.throws(() => discoverSource(config, fixture({ value })));
  assert.throws(() => discoverSource(config, { env: {}, run: () => { throw new Error('private-canary'); } }),
    error => error.code === 'TRANSPORT' && !error.message.includes('private-canary'));
  let clock = 0;
  assert.throws(() => discoverSource(config, { ...fixture(), now: () => clock++ * 100, deadlineMs: 10 }), /TIMEOUT/);
  assert.throws(() => discoverSource(config, { env: {}, run: () => ({ error: { code: 'ETIMEDOUT' } }) }), /TIMEOUT/);
});
