import { overviewObjects } from "./folders.mjs";

const order = (a, b) =>
  Number(b.container || false) - Number(a.container || false) ||
  a.path.localeCompare(b.path, "zh-CN", { numeric: true });
export function overviewTree(
  report,
  { filter = "all", search = "", folderKey = null } = {},
) {
  const objects = overviewObjects(report),
    byKey = new Map(objects.map((i) => [i.key, i])),
    children = new Map();
  for (const object of objects) {
    const parent = byKey.has(object.parentKey) ? object.parentKey : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(object);
  }
  for (const siblings of children.values()) siblings.sort(order);
  const query = search.trim().toLowerCase(),
    matches = new Set(),
    accepted = new Set(),
    autoExpanded = new Set();
  for (const item of objects) {
    const statusMatches =
      filter === "all" ||
      (filter === "differences"
        ? item.status !== "equal"
        : item.status === filter);
    if (!statusMatches || (query && !item.path.toLowerCase().includes(query)))
      continue;
    matches.add(item.key);
    let object = item;
    while (object && !accepted.has(object.key)) {
      accepted.add(object.key);
      const parent = byKey.get(object.parentKey);
      if (parent && (query || filter !== "all")) autoExpanded.add(parent.key);
      object = parent;
    }
  }
  return {
    byKey,
    children,
    matches,
    accepted,
    autoExpanded,
    rootKey: query ? null : folderKey,
  };
}

export function treeRows(tree, expanded = new Set()) {
  const rows = [],
    seen = new Set(),
    pending = (tree.children.get(tree.rootKey) || [])
      .map((item) => ({ item, level: 0 }))
      .reverse();
  while (pending.length) {
    const row = pending.pop(),
      { item, level } = row;
    if (!tree.accepted.has(item.key) || seen.has(item.key)) continue;
    seen.add(item.key);
    rows.push(row);
    if (item.container && expanded.has(item.key))
      for (const child of [...(tree.children.get(item.key) || [])].reverse())
        pending.push({ item: child, level: level + 1 });
  }
  return rows;
}
