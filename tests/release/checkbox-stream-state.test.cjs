const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { selectInstalledTargets } = require('../../src/zak/kit-update-picker');
for (const cancel of [false, true]) test(`picker restores initially flowing input after ${cancel ? 'cancel' : 'submit'}`, async () => {
  const input = new PassThrough(), output = new PassThrough();
  input.resume(); input.setRawMode = mode => { input.isRaw = mode; }; output.resume();
  const pending = selectInstalledTargets(['pi'], { input, output });
  input.write(cancel ? '\x03' : ' \r');
  assert.deepEqual(await pending, { code: cancel ? 130 : 0, targets: cancel ? [] : ['pi'] });
  assert.equal(input.readableFlowing, true);
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount('keypress'), 0);
});
