/** Flat options use the same searchable checkbox tree, cursor and stream lifecycle. */
const { promptCheckboxTree } = require('./checkbox-tree');
function checkboxList({ options, initialValues = [], required = true, ...prompt }) {
  const inventory = options.map(option => ({ ...option, id: option.value, leaf: true, depth: 0 }));
  const tree = { flat: true, inventory, nodes: inventory, selected: new Set(initialValues), expanded: new Set(),
    query: '', focus: inventory[0]?.id, notice: '' };
  const adapter = {
    visibleNodes: tree => tree.nodes.filter(node => `${node.label} ${node.hint || ''}`.toLowerCase().includes(tree.query.toLowerCase())),
    descendants: (tree, id) => tree.nodes.filter(node => node.id === id),
    marker: (tree, node) => tree.selected.has(node.id) ? '●' : '○',
    handleKey(tree, text, key = {}) {
      const visible = adapter.visibleNodes(tree);
      let index = Math.max(0, visible.findIndex(node => node.id === tree.focus));
      const node = visible[index];
      tree.notice = '';
      if (key.ctrl && key.name === 'c') return 'cancel';
      if (key.name === 'escape') {
        if (!tree.query) return 'cancel';
        tree.query = '';
      } else if (key.name === 'return') {
        if (tree.selected.size || !required) return 'submit';
        tree.notice = 'Select at least one item.';
      } else if (key.name === 'up' || key.name === 'down') {
        index = Math.max(0, Math.min(visible.length - 1, index + (key.name === 'up' ? -1 : 1)));
        tree.focus = visible[index]?.id;
      } else if ((key.name === 'space' || text === ' ') && node && !node.disabled) {
        if (tree.selected.has(node.id)) tree.selected.delete(node.id); else tree.selected.add(node.id);
      } else if (key.name === 'backspace') tree.query = tree.query.slice(0, -1);
      else if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) tree.query += text;
      if (!adapter.visibleNodes(tree).some(node => node.id === tree.focus)) tree.focus = adapter.visibleNodes(tree)[0]?.id;
      return 'continue';
    },
  };
  return promptCheckboxTree({ ...prompt, tree, adapter, required });
}
module.exports = { checkboxList };
