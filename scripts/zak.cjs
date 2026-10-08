#!/usr/bin/env node
require('../src/zak/zak-cli').main(process.argv.slice(2))
  .then(code => { process.exitCode = code; })
  .catch(error => { console.error(`zak: ${error.message}`); process.exitCode = 1; });
