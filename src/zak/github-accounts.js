const { spawnSync } = require('node:child_process');

function accountAccessFailure(result) {
  if (result.error || result.signal) return false;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (/rate limit|retry-after:|x-ratelimit-remaining:\s*0\b/i.test(output)) return false;
  const status = /^HTTP\/[\d.]+\s+(\d{3})\b/m.exec(output)?.[1] || /\bHTTP (\d{3})(?:\)|:)/.exec(output)?.[1];
  return ['401', '403', '404'].includes(status);
}

// Credentials remain in this operation's environment, never in source receipts or gh config.
function accountSession({ env = process.env, run = spawnSync, now = Date.now,
  deadlineMs = 60000, tryAccounts = true, onAuthenticated = () => {} } = {}) {
  const started = now();
  const execute = (command, args, options = {}) => {
    const remaining = deadlineMs - (now() - started);
    if (remaining <= 0) throw new Error('GitHub account lookup timed out');
    return run(command, args, { ...options, timeout: Math.min(options.timeout || remaining, remaining) });
  };
  const canRetry = error => error.accountAccess && tryAccounts && !env.GH_TOKEN && !env.GITHUB_TOKEN;
  function* savedAccounts(original) {
    const options = { env: { ...env, GH_PROMPT_DISABLED: '1' }, encoding: 'utf8', maxBuffer: 1024 * 1024 };
    let accounts;
    try {
      const result = execute('gh', ['auth', 'status', '--hostname', 'github.com', '--json', 'hosts'], options);
      if (result.error || result.signal || result.status !== 0) throw original;
      accounts = JSON.parse(result.stdout).hosts?.['github.com'];
      if (!Array.isArray(accounts)) throw original;
    } catch { throw original; }
    const seen = new Set();
    for (const account of accounts) {
      const login = account?.login;
      if (typeof login !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(login) || seen.has(login)) continue;
      seen.add(login);
      let token;
      try {
        const result = execute('gh', ['auth', 'token', '--hostname', 'github.com', '--user', login], options);
        if (result.error || result.signal) throw original;
        if (result.status !== 0) continue;
        token = String(result.stdout || '').trim();
        if (!token || /\s/.test(token)) continue;
      } catch { throw original; }
      yield { ...env, GH_TOKEN: token };
    }
  }
  return { env, execute, canRetry, savedAccounts, onAuthenticated };
}
function withGithubAccounts(probe, options = {}) {
  const session = accountSession(options);
  const attempt = env => {
    const value = probe(env, session.execute);
    session.onAuthenticated(env);
    return value;
  };
  let original;
  try { return attempt(session.env); } catch (error) {
    if (!session.canRetry(error)) throw error;
    original = error;
  }
  for (const env of session.savedAccounts(original)) {
    try { return attempt(env); } catch (error) { if (!error.accountAccess) throw error; }
  }
  throw original;
}
async function withGithubAccountsAsync(probe, options = {}) {
  const session = accountSession(options);
  const attempt = async env => {
    const value = await probe(env, session.execute);
    session.onAuthenticated(env);
    return value;
  };
  let original;
  try { return await attempt(session.env); } catch (error) {
    if (!session.canRetry(error)) throw error;
    original = error;
  }
  for (const env of session.savedAccounts(original)) {
    try { return await attempt(env); } catch (error) { if (!error.accountAccess) throw error; }
  }
  throw original;
}
module.exports = { accountAccessFailure, withGithubAccounts, withGithubAccountsAsync };
