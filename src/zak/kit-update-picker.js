function selectInstalledTargets(hosts, options) {
  return require('../../dist/installer/update-picker.cjs').selectInstalledTargets(hosts, options);
}
function finishKitSession(code, options) {
  require('../../dist/installer/update-picker.cjs').finishKitSession(code, options);
}
module.exports = { selectInstalledTargets, finishKitSession };
