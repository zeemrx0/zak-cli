import { PassThrough } from 'node:stream';
import { multiselect, isCancel, outro } from '@clack/prompts';
export function finishKitSession(code) {
  outro(code === 130 ? 'Selection cancelled.' : code ? `Finished with exit ${code}; review the messages above.` : 'Done.');
}
const LABELS = { omp: 'OMP', pi: 'Pi', codex: 'Codex', claude: 'Claude Code' };
export async function selectInstalledTargets(hosts, { input = process.stdin, output = process.stdout } = {}) {
  const source = input, raw = source.isRaw, flowing = source.readableFlowing;
  const controller = new AbortController();
  input = new PassThrough();
  input.isTTY = source.isTTY;
  input.setRawMode = mode => { source.setRawMode?.(mode); input.isRaw = mode; };
  let failure;
  const onEnd = () => controller.abort();
  const onError = error => { failure = error; controller.abort(); };
  input.once('end', onEnd);
  source.once('close', onEnd);
  source.on('error', onError);
  output.on('error', onError);
  try {
    source.pipe(input);
    const selection = await multiselect({
      message: 'Select installed kits to update',
      options: hosts.map(value => ({ value, label: LABELS[value] })),
      initialValues: [], required: true,
      input, output, signal: controller.signal,
    });
    if (failure) throw failure;
    if (isCancel(selection)) {
      outro('Update cancelled; no kits changed.', { output });
      return { code: 130, targets: [] };
    }
    return { code: 0, targets: selection };
  } finally {
    input.off('end', onEnd);
    source.off('close', onEnd);
    source.off('error', onError);
    output.off('error', onError);
    source.unpipe(input);
    input.setRawMode(raw || false);
    input.destroy();
    if (flowing !== true) source.pause();
  }
}
