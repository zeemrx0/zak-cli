// The bundled UI has no runtime npm dependencies, including in installed releases.
const { reportMessage } = require('../../dist/installer/update-picker.cjs');
const info = (message, options) => reportMessage('info', message, options);
const success = (message, options) => reportMessage('success', message, options);
const error = (message, options) => reportMessage('error', message, options);
module.exports = { info, success, error };
