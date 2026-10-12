import { checkboxList } from './ui/checkbox-list.js';
import { outro, HOST_LABELS } from './ui/terminal-ui.mjs';
export { finishSession as finishKitSession, reportMessage } from './ui/terminal-ui.mjs';
export async function selectInstalledTargets(hosts, { input = process.stdin, output = process.stdout } = {}) {
  const selection = await checkboxList({
    message: 'Select installed kits to update',
    options: hosts.map(value => ({ value, label: HOST_LABELS[value] })),
    initialValues: [], required: true, input, output,
  });
  if (selection === null) {
    outro('Update cancelled; no kits changed.', { output });
    return { code: 130, targets: [] };
  }
  return { code: 0, targets: selection };
}
