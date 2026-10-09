#!/usr/bin/env node
const { assertNode } = require('../src/shared/node-runtime');
const { renderBootstrap } = require('../src/release/bootstrap-template');
const { releaseRepository } = require('../src/release/release-metadata');
const path = require('node:path');
async function main() {
  assertNode();
  const [source, digest, ...args] = process.argv.slice(2);
  if (!source || !/^[a-f0-9]{64}$/.test(digest || '')) throw new Error('invalid bootstrap arguments');
  if (args[0] === '--uninstall' && args.length === 1)
    return require('../src/zak/cli-self-management').selfUninstall([]);
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--channel' || !['stable', 'beta'].includes(args[1]))
      throw new Error('bootstrap accepts --channel stable|beta or --uninstall');
    return require('../src/zak/release-install').installRelease({ repository: releaseRepository(require(path.join(source, 'package.json'))), transport: 'curl', channel: args[1] });
  }
  const result = require('../src/zak/cli-install').installCli(source, renderBootstrap(source, digest), releaseRepository(require(path.join(source, 'package.json'))), 'curl');
  console.log(`zak ${result.version} ${result.changed ? 'installed' : 'already installed'}: ${result.launcher}`);
  console.log('Add $HOME/.local/bin to PATH. Run zak kit install --target pi.');
  return 0;
}
main().then(code => { process.exitCode = code; }).catch(error => { console.error(`install-zak: ${error.message}`); process.exitCode = 1; });
