const test = require('node:test');
const assert = require('node:assert/strict');
const { targetArgs } = require('../../src/zak/kit-lifecycle');
test('-g normalizes to global and rejects project paths', () => {
  assert.equal(targetArgs(['-g']).scope, 'global');
  assert.deepEqual(targetArgs(['-g']).rest, ['--global']);
  assert.throws(() => targetArgs(['/project', '-g']), /repository path/);
});
