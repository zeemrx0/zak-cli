const MIN_NODE = '26.11.1';
function assertNode(version = process.versions.node) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const minimum = MIN_NODE.split('.').map(Number);
  const current = parts?.slice(1).map(Number);
  const difference = current?.findIndex((value, i) => value !== minimum[i]);
  if (!current || (difference >= 0 && current[difference] < minimum[difference]))
    throw new Error(`Node ${MIN_NODE}+ is required (found ${version})`);
}
module.exports = { MIN_NODE, assertNode };
