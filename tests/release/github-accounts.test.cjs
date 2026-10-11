const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshPinnedSource } = require('../../src/zak/pinned-source-refresh');
const { discoverSource } = require('../../src/zak/github-discovery');
const { withGithubAccounts, accountAccessFailure } = require('../../src/zak/github-accounts');
const source = { repository: 'fixture/kit', repositoryId: 11, ownerId: 7,
  transport: 'gh', channel: 'stable', distribution: 'private' };
const repo = { id: 11, owner: { id: 7 }, full_name: source.repository,
  private: true, fork: false, archived: false, disabled: false };
function fixture({ denied = 404, allDenied = false, change = {} } = {}) {
  const calls = [], env = { HOME: '/fixture' };
  const run = (command, args, options) => {
    assert.equal(command, 'gh');
    calls.push({ args, token: options.env.GH_TOKEN });
    assert.ok(!args.includes('switch'));
    if (args.includes('--json')) return { status: 0, stdout: JSON.stringify({ hosts: {
      'github.com': [{ login: 'active', active: true }, { login: 'expired' }, { login: 'owner' }],
      'other.host': [{ login: 'never-use' }],
    } }) };
    if (args[1] === 'token') return args.at(-1) === 'expired' ? { status: 1 } :
      { status: 0, stdout: `token-${args.at(-1)}\n` };
    if (allDenied || options.env.GH_TOKEN !== 'token-owner') return {
      status: 1, stderr: `gh: inaccessible (HTTP ${denied})`,
    };
    return { status: 0, stdout: JSON.stringify({ ...repo, ...change }) };
  };
  return { calls, env, run };
}
test('pinned refresh tries saved accounts and returns credentials only through the callback', () => {
  const f = fixture(); let selected;
  const refreshed = refreshPinnedSource(source, { ...f, onAuthenticated(env) { selected = env; } });
  assert.deepEqual(refreshed, source);
  assert.equal(selected.GH_TOKEN, 'token-owner');
  assert.equal(f.env.GH_TOKEN, undefined);
  assert.ok(!JSON.stringify(refreshed).includes('token-'));
  assert.deepEqual(f.calls.filter(c => c.args[1] === 'token').map(c => c.args.at(-1)), ['active', 'expired', 'owner']);
});
test('explicit environment credentials prevent account enumeration', () => {
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN']) {
    const f = fixture();
    assert.throws(() => refreshPinnedSource(source, { ...f, env: { [key]: 'explicit' } }), /pinned source/);
    assert.equal(f.calls.length, 1);
  }
});
test('exhausted accounts fail closed with redacted errors and unchanged inputs', () => {
  const f = fixture({ allDenied: true }); let selected = false;
  assert.throws(() => refreshPinnedSource(source, { ...f, onAuthenticated() { selected = true; } }), error => {
    assert.ok(!/token-|fixture\/kit/.test(error.message)); return true;
  });
  assert.equal(selected, false); assert.deepEqual(f.env, { HOME: '/fixture' });
});
test('server errors and rate limits do not try saved accounts', () => {
  for (const denied of [429, 500, 503]) {
    const f = fixture({ denied });
    assert.throws(() => refreshPinnedSource(source, f)); assert.equal(f.calls.length, 1);
  }
  for (const stderr of ['gh: API rate limit exceeded (HTTP 403)', 'HTTP/2 403\nx-ratelimit-remaining: 0',
    'HTTP/2 403\nretry-after: 10']) assert.equal(accountAccessFailure({ stderr }), false);
  assert.equal(accountAccessFailure({ error: new Error(), stderr: 'HTTP/2 404' }), false);
});
test('selected accounts must still match pinned identity and security constraints', () => {
  for (const change of [{ id: 12 }, { owner: { id: 9 } }, { private: false }, { fork: true }]) {
    const f = fixture({ change }); let selected = false;
    assert.throws(() => refreshPinnedSource(source, { ...f, onAuthenticated() { selected = true; } }), /identity changed/);
    assert.equal(selected, false);
  }
});
test('discovery does not retry auth transport, termination, or rate-limit failures', () => {
  const config = { schema: 2, publicRepository: 'fixture/public', variableRepository: 'fixture/cli',
    privateVariable: 'ZAK_PRIVATE_REPO_URL' };
  for (const result of [{ status: 1, stderr: 'network unreachable' },
    { status: 1, stderr: 'API rate limit exceeded (HTTP 403)' },
    { status: null, signal: 'SIGTERM', stderr: 'invalid token' }]) {
    let calls = 0;
    assert.throws(() => discoverSource(config, { env: {}, run() { calls++; return result; } }));
    assert.equal(calls, 1);
  }
});
test('account attempts share one deadline', () => {
  let clock = 0, calls = 0;
  assert.throws(() => withGithubAccounts((env, run) => {
    run('gh', ['api'], { env });
    throw Object.assign(new Error('denied'), { accountAccess: true });
  }, { env: {}, now: () => clock, deadlineMs: 10, run() {
    calls++; clock = 11; return { status: 1 };
  } }), /denied/);
  assert.equal(calls, 1);
});
test('fresh discovery retries the protected variable and validates the complete source with one account', () => {
  const config = { schema: 2, publicRepository: 'fixture/public', variableRepository: 'fixture/cli',
    privateVariable: 'ZAK_PRIVATE_REPO_URL' };
  const f = fixture(); let selected;
  const run = (command, args, options) => {
    if (args[0] === 'auth' && args.includes('--active')) return { status: 0 };
    if (args[0] === 'auth' || options.env.GH_TOKEN !== 'token-owner') return f.run(command, args, options);
    const body = args.at(-1).includes('/variables/') ?
      { name: config.privateVariable, value: 'https://github.com/fixture/kit' } : repo;
    return { status: 0, stdout: `HTTP/2 200 OK\n\n${JSON.stringify(body)}` };
  };
  const found = discoverSource(config, { ...f, run, onAuthenticated(env) { selected = env; } });
  assert.equal(found.repositoryId, 11); assert.equal(selected.GH_TOKEN, 'token-owner');
});
