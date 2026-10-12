import { stripVTControlCharacters } from 'node:util';
import { outro, log } from '@clack/prompts';
export { outro };
export const HOST_LABELS = Object.freeze({ omp: 'OMP', pi: 'Pi', codex: 'Codex', claude: 'Claude Code' });
const clean = value => stripVTControlCharacters(String(value)).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
/** Keep status output plain in pipes; share the Clack guide in terminals. */
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
