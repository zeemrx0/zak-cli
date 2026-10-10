const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { stripVTControlCharacters } = require('node:util');
const ui = require('../../src/zak/cli-ui');
const { finishKitSession, selectInstalledTargets } = require('../../src/zak/kit-update-picker');
function fixture(tty = false) {
  const input = new PassThrough(), output = new PassThrough();
  input.pause(); input.isTTY = true; output.isTTY = tty;
  input.setRawMode = value => { input.isRaw = value; };
  output.columns = 80; output.rows = 24;
  let text = '';
  output.on('data', chunk => { text += chunk; });
  return { input, output, text: () => stripVTControlCharacters(text) };
}
test('status components preserve exact plain text in pipes', () => {
  const f = fixture();
  ui.info('No installed kits to update', f);
  ui.success('zak 0.1.6 installed', f);
  ui.error('zak: invalid kit targets', f);
  assert.equal(f.text(), 'No installed kits to update\nzak 0.1.6 installed\nzak: invalid kit targets\n');
});
test('plain mode keeps JSON-related messages undecorated even on a terminal', () => {
  const f = fixture(true);
  ui.info('No installed kits to update', { output: f.output, plain: true });
  assert.equal(f.text(), 'No installed kits to update\n');
});
test('terminal status components share Clack guide and remove control sequences', () => {
  const f = fixture(true);
  ui.info('No installed kits to update', f);
  ui.success('zak 0.1.6 installed', f);
  ui.error('zak: bad\x1b[2Jinput\nmessage', f);
  assert.match(f.text(), /│/);
  assert.match(f.text(), /No installed kits to update/);
  assert.match(f.text(), /zak 0.1.6 installed/);
  assert.match(f.text(), /zak: badinput message/);
});
test('session endings use the supplied stream for success, failure, and cancellation', () => {
  for (const [code, message] of [[0, 'Done.'], [2, 'Finished with exit 2; review the messages above.'], [130, 'Selection cancelled.']]) {
    for (const tty of [false, true]) {
      const f = fixture(tty);
      finishKitSession(code, f);
      assert.ok(f.text().includes(message));
      if (tty) assert.match(f.text(), /└/);
      else assert.equal(f.text(), `${message}\n`);
    }
  }
});
test('focus and circular checkbox selection remain independent and toggles are reversible', async () => {
  const f = fixture(true), pending = selectInstalledTargets(['pi', 'codex'], f);
  assert.match(f.text(), /○ Pi ‹/);
  f.input.write('\x1b[B');
  assert.match(f.text(), /○ Codex ‹/);
  f.input.write(' ');
  assert.match(f.text(), /● Codex ‹/);
  f.input.write(' ');
  assert.ok(f.text().lastIndexOf('○ Codex ‹') > f.text().lastIndexOf('● Codex ‹'));
  f.input.write('\x1b[A \r');
  assert.deepEqual(await pending, { code: 0, targets: ['pi'] });
});
test('narrow terminal rendering keeps circular options selectable', async () => {
  const f = fixture(true); f.output.columns = 24;
  const pending = selectInstalledTargets(['pi', 'claude'], f);
  assert.match(f.text(), /○/);
  f.input.write('\x1b[B \r');
  assert.deepEqual(await pending, { code: 0, targets: ['claude'] });
});
test('input errors propagate and restore raw mode and listeners', async () => {
  const f = fixture(true); f.input.isRaw = true;
  const pending = selectInstalledTargets(['pi'], f);
  const rejected = assert.rejects(pending, /fixture input failure/);
  f.input.emit('error', new Error('fixture input failure'));
  await rejected;
  assert.equal(f.input.isRaw, true);
  assert.equal(f.input.listenerCount('error'), 0);
  assert.equal(f.output.listenerCount('error'), 0);
  assert.equal(f.output.listenerCount('resize'), 0);
});
test('Escape cancels the picker without selecting the focused agent', async () => {
  const f = fixture(true), pending = selectInstalledTargets(['pi'], f);
  f.input.write('\x1b');
  assert.deepEqual(await pending, { code: 130, targets: [] });
  assert.equal(f.input.isRaw, false);
  assert.equal(f.output.listenerCount('resize'), 0);
});
