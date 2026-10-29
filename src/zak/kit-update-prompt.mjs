import { checkboxList } from './ui/checkbox-list.js';
import { select, text, isCancel } from '@clack/prompts';
import { outro, HOST_LABELS } from './ui/terminal-ui.mjs';
export { finishSession as finishKitSession, reportMessage } from './ui/terminal-ui.mjs';
export async function selectKitSource({ options, initialValue, current, input = process.stdin, output = process.stdout }) {
  const choice = await select({ message: `Select the kit source (current: ${current})`, options, initialValue, input, output });
  if (isCancel(choice)) { outro('Source selection cancelled; nothing changed.', { output }); return null; }
  return choice;
}
export async function promptKitPath({ initialValue, validate, input = process.stdin, output = process.stdout }) {
  const value = await text({ message: 'Path to the local z-agent-kit folder', initialValue, placeholder: './z-agent-kit', validate, input, output });
  if (isCancel(value)) { outro('Source selection cancelled; nothing changed.', { output }); return null; }
  return value;
}
export async function selectInstalledTargets(hosts, { input = process.stdin, output = process.stdout, operation = 'update' } = {}) {
  const selection = await checkboxList({
    message: operation === 'update' ? 'Select installed kits to update' : `Select targets for ${operation}`,
    options: hosts.map(value => ({ value, label: HOST_LABELS[value] })),
    initialValues: [], required: true, input, output,
  });
  if (selection === null) {
    outro(`${operation[0].toUpperCase()}${operation.slice(1)} cancelled; no kits changed.`, { output });
    return { code: 130, targets: [] };
  }
  return { code: 0, targets: selection };
}
