const readline = require('node:readline');
const LABELS = { omp: 'OMP', pi: 'Pi', codex: 'Codex', claude: 'Claude Code' };
function selectInstalledTargets(hosts, { input = process.stdin, output = process.stdout } = {}) {
  output.write('Select installed kits to update:\n');
  hosts.forEach((host, index) => output.write(`  ${index + 1}. ${LABELS[host]}\n`));
  const rl = readline.createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  return new Promise(resolve => {
    function finish(selection) {
      rl.removeListener('line', onLine);
      rl.removeListener('SIGINT', onCancel);
      rl.removeListener('close', onCancel);
      rl.close();
      resolve(selection);
    }
    function onCancel() { finish({ code: 130, targets: [] }); }
    function prompt() { rl.setPrompt('Choose numbers separated by commas (Ctrl+C to cancel): '); rl.prompt(); }
    function onLine(line) {
      const choices = line.split(',').map(value => value.trim());
      if (choices.some(value => !/^[1-9]\d*$/.test(value) || Number(value) > hosts.length)) {
        output.write('Choose at least one number from the list.\n');
        prompt(); return;
      }
      finish({ code: 0, targets: [...new Set(choices.map(value => hosts[Number(value) - 1]))] });
    }
    rl.on('line', onLine);
    rl.on('SIGINT', onCancel);
    rl.on('close', onCancel);
    prompt();
  });
}
module.exports = { selectInstalledTargets };
