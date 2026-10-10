#!/usr/bin/env node
const ui = require('../src/zak/cli-ui');
require('../src/zak/zak-cli').main(process.argv.slice(2))
  .then(code => { process.exitCode = code; })
  .catch(error => { ui.error(`zak: ${error.message}`, { plain: process.argv.includes('--json') }); process.exitCode = 1; });
