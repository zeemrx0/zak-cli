const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const KIT = process.env.ZAK_TARGET_KIT_SOURCE;
test('independent kit and CLI releases vendor identical checkbox components', { skip: !KIT }, () => {
  for (const file of ['checkbox-tree.js', 'checkbox-list.js'])
    assert.equal(fs.readFileSync(path.resolve(__dirname, '../../src/zak/ui', file), 'utf8'),
      fs.readFileSync(path.join(KIT, 'src/installer/ui', file), 'utf8'), file);
});
