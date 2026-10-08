const fs = require('node:fs');
const path = require('node:path');
const { paths, readReceipt, verifyOwned, locked } = require('./cli-safety');
const { acquire } = require('./cli-lock');
const { recover } = require('./cli-transaction');
const { selfUninstall } = require('./cli-uninstall');
async function selfUpdate(args, env = process.env) {
  let channel;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--channel' || !['stable', 'beta'].includes(args[1]))
      throw new Error('self-update accepts only --channel stable|beta');
    channel = args[1];
  }
  const { root, launcher } = paths(env), release = acquire(root, '.update-lock');
  try {
    locked(root, () => recover(root, launcher));
    const receipt = readReceipt(root, launcher); verifyOwned(receipt);
    return await require('./release-install').installRelease({ repository: receipt.repository, transport: receipt.transport, channel: channel || receipt.channel }, env);
  } finally { release(); }
}
module.exports = { selfUpdate, selfUninstall };
