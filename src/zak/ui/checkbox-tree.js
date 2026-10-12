/** Shared terminal checkbox tree. Vendored identically in zak-cli for independent releases. */
const { PassThrough } = require('node:stream');
const { Prompt } = require('@clack/core');
const { isCancel } = require('@clack/prompts');
const { styleText, stripVTControlCharacters } = require('node:util');
const clean = value => stripVTControlCharacters(String(value ?? '')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const color = Object.fromEntries(['dim', 'bold', 'underline', 'yellow', 'cyan', 'green', 'red'].map(tone => [tone, text => styleText(tone, String(text))]));

function clipLine(line, width) {
  let result = '', length = 0;
  for (const token of line.match(/\x1b\[[0-9;]*m|./gu) || []) {
    if (token.startsWith('\x1b')) result += token;
    else if (length++ < width) result += token;
    else return result + (result.includes('\x1b') ? '\x1b[0m' : '');
  }
  return result;
}
function renderCheckboxTree(tree, message, rows = 24, columns = 80, colors = color, adapter) {
  const { visibleNodes, descendants, marker } = adapter;
  const visible = visibleNodes(tree);
  const index = Math.max(0, visible.findIndex(node => node.id === tree.focus));
  const capacity = Math.max(1, rows - 12);
  const start = Math.max(0, Math.min(index - Math.floor(capacity / 2), visible.length - capacity));
  const rail = colors.dim('│');
  const lines = [colors.yellow('◆') + '  ' + colors.bold(clean(message)), rail,
    `${rail}  ${colors.dim('Search:')} ${clean(tree.query)}▏`];
  if (start) lines.push(`${rail}  ${colors.dim(`↑ ${start} more`)}`);
  const viewport = visible.slice(start, start + capacity);
  for (const node of viewport) {
    const count = descendants(tree, node.id).filter(item => tree.selected.has(item.id)).length;
    const suffix = node.id === '*' ? colors.dim(` (${count}/${tree.inventory.length})`) : '';
    const focused = node.id === tree.focus;
    const circle = marker(tree, node);
    const check = circle === '○' ? colors.dim(circle) : colors.green(circle);
    let branch = '';
    if (node.leaf && !tree.flat) branch = visible[visible.indexOf(node) + 1]?.parent === node.parent ? '├─ ' : '└─ ';
    else if (!node.leaf && node.id !== '*') branch = tree.expanded.has(node.id) || tree.query ? '▾ ' : '▸ ';
    let label = clean(node.label);
    if (!node.leaf) label = colors.bold(label);
    if (focused) label = colors.underline(label);
    if (node.disabled) label = colors.dim(label);
    if (node.hint) label += colors.dim(` (${clean(node.hint)})`);
    lines.push(`${rail} ${focused ? colors.cyan('❯') : ' '} ${'  '.repeat(node.depth)}${colors.dim(branch)}${check} ${label}${suffix}`);
    if (node.id === '*') lines.push(`${rail}  ${colors.dim('─'.repeat(Math.max(1, Math.min(48, columns - 5))))}`);
  }
  const remaining = visible.length - start - capacity;
  if (remaining > 0) lines.push(`${rail}  ${colors.dim(`↓ ${remaining} more`)}`);
  const focused = visible[index];
  const hiddenRequired = [...tree.selected].filter(id => !tree.inventory.some(item => item.id === id));
  const notice = hiddenRequired.length ? `New required items included: ${hiddenRequired.map(id => id.split('/').pop()).join(', ')}` : tree.notice;
  lines.push(rail, `${rail}  ${colors.dim('Description')}`,
    `${rail}  ${clean(!focused ? 'No matching items.' : focused.id === '*' ? 'Select or clear all items.' : focused.description || focused.label || focused.id)}`,
    `${rail}  ${colors.dim(`${tree.selected.size} selected`)} ${colors.yellow(clean(notice))}`, rail,
    `${colors.dim('└')}  ${colors.dim('↑↓ move · ←→ collapse/expand · Space: select · type search · Enter: confirm · Esc: clear/cancel')}`);
  return lines.map(line => clipLine(line, Math.max(1, columns - 1))).join('\n');
}
async function promptCheckboxTree({ tree, adapter, message, required = true, input = process.stdin, output = process.stdout }) {
  const { handleKey } = adapter;
  const controller = new AbortController();
  const source = input, raw = source.isRaw, flowing = source.readableFlowing;
  // Isolate Clack's readline error forwarding and unpipe cleanup from the caller's stream.
  input = new PassThrough();
  input.isTTY = source.isTTY;
  input.setRawMode = mode => { source.setRawMode?.(mode); input.isRaw = mode; };
  let action = 'continue', failure;
  const fail = error => { failure = error; queueMicrotask(() => controller.abort()); };
  const onStreamError = error => { failure = error; controller.abort(); };
  const prompt = new Prompt({ input, output, signal: controller.signal,
    validate: () => !required || tree.selected.size ? undefined : 'Select at least one item.',
    render() {
      if (failure) return color.red('■  Selection failed.');
      if (this.state === 'cancel') return color.yellow('■') + '  Selection cancelled.';
      if (this.state === 'submit') return color.green('◇') + `  ${clean(message)}\n${color.dim('│')}  ${tree.selected.size} selected`;
      try { return renderCheckboxTree(tree, message, output.rows, output.columns, color, adapter); }
      catch (error) { fail(error); return 'Selection failed.'; }
    },
  }, false);
  prompt.value = '';
  const onKey = (text, key) => {
    try { action = handleKey(tree, text, key); }
    catch (error) { fail(error); }
  };
  const onEnd = () => controller.abort();
  // Clack's key events omit modifiers and lowercase search text. Handle raw keys once,
  // before Clack renders; its finalize event lets Escape clear search before cancelling.
  input.prependListener('keypress', onKey);
  input.once('end', onEnd);
  source.once('close', onEnd);
  source.on('error', onStreamError);
  output.on('error', onStreamError);
  prompt.on('finalize', () => {
    if (prompt.state === 'cancel' && action === 'continue') prompt.state = 'active';
  });
  try {
    source.pipe(input);
    const result = await prompt.prompt();
    if (failure) throw failure;
    return isCancel(result) ? null : [...tree.selected];
  } finally {
    input.off('keypress', onKey);
    input.off('end', onEnd);
    source.off('close', onEnd);
    source.off('error', onStreamError);
    source.unpipe(input);
    output.off('error', onStreamError);
    input.setRawMode?.(raw || false);
    input.destroy();
    if (flowing === true) source.resume();
    else source.pause();
  }
}

module.exports = { renderCheckboxTree, promptCheckboxTree };
