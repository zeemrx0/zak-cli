import { checkboxList } from './ui/checkbox-list.js';
import { outro, HOST_LABELS } from './ui/terminal-ui.mjs';
export { finishSession as finishKitSession, reportMessage } from './ui/terminal-ui.mjs';
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
