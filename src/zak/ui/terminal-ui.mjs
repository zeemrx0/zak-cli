import { MultiSelectPrompt, wrapTextWithPrefix } from '@clack/core';
import { styleText, stripVTControlCharacters } from 'node:util';
import { isCancel, outro, log, limitOptions, symbol, symbolBar, S_BAR, S_BAR_END } from '@clack/prompts';

export { isCancel, outro };
export const HOST_LABELS = Object.freeze({ omp: 'OMP', pi: 'Pi', codex: 'Codex', claude: 'Claude Code' });
const clean = value => stripVTControlCharacters(String(value)).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

/** Circular checkboxes are multi-select: focus does not imply selection. */
export function circleMultiselect({ message, options, initialValues = [], required = true,
  input = process.stdin, output = process.stdout, signal }) {
  const color = (tone, text) => styleText(tone, text, { stream: output });
  const wrap = (text, prefix, first = prefix) => wrapTextWithPrefix(output, text, prefix, first);
  return new MultiSelectPrompt({
    options, initialValues, required, input, output, signal,
    validate: value => required && !value?.length ? 'Please select at least one option.' : undefined,
    render() {
      const bar = `${symbolBar(this.state)}  `;
      const heading = `${color('gray', S_BAR)}\n${wrap(clean(message), bar, `${symbol(this.state)}  `)}\n`;
      const selected = this.value ?? [];
      if (this.state === 'submit' || this.state === 'cancel') {
        const labels = this.options.filter(option => selected.includes(option.value)).map(option => clean(option.label ?? option.value));
        return `${heading}${wrap(color('dim', labels.join(', ') || (this.state === 'submit' ? 'none' : '')), bar)}\n${color('gray', S_BAR)}`;
      }
      const lines = limitOptions({ options: this.options, cursor: this.cursor, output,
        columnPadding: 3, rowPadding: heading.split('\n').length + 3,
        style: (option, active) => {
          const checked = selected.includes(option.value);
          const mark = color(checked ? 'green' : active ? 'cyan' : 'dim', checked ? '●' : '○');
          const label = clean(option.label ?? option.value);
          const text = option.disabled ? color(['dim', 'strikethrough'], label) : active ? color('bold', label) : color('dim', label);
          return `${mark} ${text}${active ? color('cyan', ' ‹') : ''}`;
        },
      });
      const instructions = '↑/↓: navigate • Space: select • Enter: confirm • Esc: cancel';
      const footer = this.state === 'error' ? color('yellow', this.error) : color('dim', instructions);
      return `${heading}${lines.map(line => `${bar}${line}`).join('\n')}\n${wrap(footer, bar)}\n${color('cyan', S_BAR_END)}\n`;
    },
  }).prompt();
}

/** Keep status output plain in pipes; use the same Clack guide as prompts in terminals. */
export function reportMessage(level, message, { output = level === 'error' ? process.stderr : process.stdout, plain = false } = {}) {
  if (output.isTTY && !plain) log[level](clean(message), { output });
  else if (output === process.stdout) console.log(clean(message));
  else if (output === process.stderr) console.error(clean(message));
  else output.write(`${clean(message)}\n`);
}
export function finishSession(code, { output = process.stdout } = {}) {
  const message = code === 130 ? 'Selection cancelled.' : code ? `Finished with exit ${code}; review the messages above.` : 'Done.';
  if (output.isTTY) outro(message, { output });
  else output.write(`${message}\n`);
}
