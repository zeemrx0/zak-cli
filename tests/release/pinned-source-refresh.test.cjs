const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshPinnedSource } = require('../../src/zak/pinned-source-refresh');
const source = { repository: 'fixture/old-name', repositoryId: 11, ownerId: 7,
  transport: 'gh', channel: 'stable', distribution: 'private' };
const repo = { id: 11, owner: { id: 7 }, full_name: 'fixture/new-name',
  private: true, fork: false, archived: false, disabled: false };
test('private refresh follows immutable ID across rename without discovery', () => {
  let called = false;
  const refreshed = refreshPinnedSource(source, { env: {}, run(command, args) {
    called = true; assert.equal(command, 'gh'); assert.equal(args.at(-1), 'repositories/11');
    return { status: 0, stdout: JSON.stringify(repo) };
  } });
  assert.equal(called, true); assert.deepEqual(refreshed, { ...source, repository: 'fixture/new-name' });
});
test('public pins require no authenticated refresh', () => {
  const publicSource = { ...source, distribution: 'public' };
  assert.equal(refreshPinnedSource(publicSource, { run() { throw new Error('no network expected'); } }), publicSource);
});
test('ownership transfers, exposure changes, and invalid repository state fail closed', () => {
  for (const change of [{ id: 12 }, { owner: { id: 8 } }, { private: false }, { fork: true },
    { archived: true }, { disabled: true }, { full_name: '../unsafe' }]) {
    assert.throws(() => refreshPinnedSource(source, { run() {
      return { status: 0, stdout: JSON.stringify({ ...repo, ...change }) };
    } }), /pinned source/);
  }
});
test('authentication and malformed responses do not expose private identity or fallback', () => {
  for (const result of [{ status: 1, stderr: source.repository }, { status: 0, stdout: source.repository },
    { error: new Error(source.repository) }]) {
    assert.throws(() => refreshPinnedSource(source, { run() { return result; } }), error => {
      assert.equal(error.message.includes(source.repository), false); assert.match(error.message, /no fallback/); return true;
    });
  }
});
