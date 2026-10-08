const path = require('node:path');
const { assertNode } = require('../shared/node-runtime');
const { selfUpdate, selfUninstall } = require('./cli-self-management');
const { kitPackage, runKit } = require('./kit-cache');
const HELP = `zak — independent CLI and kit management
  zak --version
  zak self-update [--channel stable|beta]
  zak self-uninstall
  zak kit install|update|check|uninstall --repo owner/name [options]

Kit source: --transport curl|gh (default curl), --channel stable|beta
Private sources require authenticated gh transport. CLI releases contain no kits.
Kit options: [project] --target omp,pi,codex,claude --tier <tiers> --global --json
self-update never changes installed kits; self-uninstall leaves kits and cache.
Kit install/update retrieves verified releases independently of the CLI version.`;
function kitArgs(operation, args) {
  const mode = { install: [], update: ['--update'], check: ['--check'], uninstall: ['--uninstall'] }[operation];
  if (!mode) throw new Error('expected zak kit install|update|check|uninstall');
  if (args.some(arg => ['--update', '--check', '--uninstall', '--cli'].includes(arg)))
    throw new Error('use the kit subcommand, not a lifecycle/bootstrap flag');
  return [...args, ...mode];
}
function sourceArgs(args) {
  const source = { repository: null, channel: 'stable', transport: 'curl' }, rest = [], seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = { '--repo': 'repository', '--channel': 'channel', '--transport': 'transport' }[args[i]];
    if (!key) { rest.push(args[i]); continue; }
    if (seen.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`invalid or repeated ${args[i]}`);
    seen.add(key); source[key] = args[++i];
  }
  if (!source.repository) throw new Error('kit commands require --repo owner/name');
  return { source, rest };
}
async function main(argv, root = path.resolve(__dirname, '../..')) {
  assertNode();
  if (!argv.length || argv.length === 1 && ['--help', '-h'].includes(argv[0])) { console.log(HELP); return 0; }
  if (argv.length === 1 && ['--version', '-v'].includes(argv[0])) { console.log(require(path.join(root, 'package.json')).version); return 0; }
  const [command, ...args] = argv;
  if (command === 'self-update') return selfUpdate(args);
  if (command === 'self-uninstall') return selfUninstall(args);
  if (command !== 'kit') throw new Error(`unknown command: ${command}`);
  const [operation, ...options] = args;
  if (!operation || operation === '--help') { console.log(HELP); return 0; }
  const { source, rest } = sourceArgs(options);
  const forwarded = kitArgs(operation, rest);
  const pkg = await kitPackage(source, ['install', 'update'].includes(operation));
  return runKit(pkg, forwarded);
}
module.exports = { main, kitArgs, sourceArgs, HELP };
