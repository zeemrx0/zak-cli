function selectInstalledTargets(hosts, options) {
  return require('../../dist/installer/update-picker.cjs').selectInstalledTargets(hosts, options);
}
function finishKitSession(code) {
  require('../../dist/installer/update-picker.cjs').finishKitSession(code);
}
module.exports = { selectInstalledTargets, finishKitSession };
