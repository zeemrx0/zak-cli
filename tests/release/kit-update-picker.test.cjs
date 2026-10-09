const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { selectInstalledTargets } = require('../../src/zak/kit-update-picker');
function fixture() {
  const input = new PassThrough(), output = new PassThrough();
  let text = '';
  output.on('data', chunk => { text += chunk; });
  return { input, output, text: () => text };
}
test('picker lists only supplied installed hosts and supports multiple choices', async () => {
  const f = fixture();
  const selection = selectInstalledTargets(['pi', 'claude'], f);
  assert.match(f.text(), /1\. Pi\n.*2\. Claude Code/);
  assert.doesNotMatch(f.text(), /OMP|Codex/);
  f.input.write(' 2, 1, 2 \n');
  assert.deepEqual(await selection, { code: 0, targets: ['claude', 'pi'] });
  assert.equal(f.input.listenerCount('data'), 0);
});
test('blank, malformed and out-of-range choices retry without selecting an unlisted host', async () => {
  const f = fixture(), selection = selectInstalledTargets(['codex'], f);
  for (const value of ['', '0', '2', '-1', '1x', '1,', '1.0']) f.input.write(value + '\n');
  assert.equal(f.text().split('Choose at least one number').length - 1, 7);
  f.input.write('1\n');
  assert.deepEqual(await selection, { code: 0, targets: ['codex'] });
});
test('EOF and terminal Ctrl+C cancel selection and release input listeners', async () => {
  for (const interrupt of [false, true]) {
    const f = fixture(), modes = [];
    if (interrupt) {
      f.input.isTTY = true; f.output.isTTY = true;
      f.input.setRawMode = value => { modes.push(value); f.input.isRaw = value; };
    }
    const selection = selectInstalledTargets(['pi'], f);
    if (interrupt) f.input.write('\x03'); else f.input.end();
    assert.deepEqual(await selection, { code: 130, targets: [] });
    assert.equal(f.input.listenerCount('keypress'), 0);
    assert.equal(f.input.listenerCount('end'), 0);
    if (interrupt) {
      assert.deepEqual(modes, [true, false]);
      assert.equal(f.input.isRaw, false);
      assert.equal(f.output.listenerCount('resize'), 0);
    } else assert.equal(f.input.listenerCount('data'), 0);
  }
});
test('terminal input remains usable by a subsequent installer prompt', async () => {
  const f = fixture(), modes = [];
  f.input.isTTY = true; f.output.isTTY = true; f.input.setRawMode = value => modes.push(value);
  const first = selectInstalledTargets(['pi'], f);
  f.input.write('1\r');
  assert.deepEqual(await first, { code: 0, targets: ['pi'] });
  const readline = require('node:readline');
  const rl = readline.createInterface({ input: f.input, output: f.output, terminal: true });
  const answer = new Promise(resolve => rl.question('Installer confirmation: ', resolve));
  f.input.write('yes\r');
  assert.equal(await answer, 'yes');
  rl.close();
  assert.deepEqual(modes, [true, false, true, false]);
});
