#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
function syncTargetLocator({ source = path.resolve(__dirname, '../../../z-agent-kit/src/installer/shared/target-contract.js'),
  destination = path.resolve(__dirname, '../../src/zak/kit-target-locator.js'), check = false } = {}) {
  const text = '// Generated from the authoritative kit target contract; do not edit.\n' + fs.readFileSync(source, 'utf8');
  if (check) {
    if (fs.readFileSync(destination, 'utf8') !== text) throw new Error('generated target locator is stale');
  } else fs.writeFileSync(destination, text);
}
if (require.main === module) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('expected --check or no arguments');
    syncTargetLocator({ check: process.argv.includes('--check') });
  } catch { console.error('target locator synchronization failed'); process.exitCode = 1; }
}
module.exports = { syncTargetLocator };
