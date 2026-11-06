const counts = () => ({
  added: 0,
  removed: 0,
  changed: 0,
  equal: 0,
  error: 0,
  total: 0,
});

export function mergeFolders(left, right) {
  return [
    ...new Set([...left.containers.keys(), ...right.containers.keys()]),
  ].map((matchKey) => {
    const a = left.containers.get(matchKey),
      b = right.containers.get(matchKey),
      source = b || a;
    const conflict =
      (!a && left.entries.has(matchKey)) ||
      (!b && right.entries.has(matchKey)) ||
      (a && b && a.kind !== b.kind);
    const error = [...new Set([a?.error, b?.error].filter(Boolean))].join("；");
    return {
      key: "folder:" + matchKey,
      matchKey,
      path: source.displayPath || source.path,
      type: source.kind,
      container: true,
      leftPath: a?.path ?? null,
      rightPath: b?.path ?? null,
      leftParent: a?.parentKey ? "folder:" + a.parentKey : null,
      rightParent: b?.parentKey ? "folder:" + b.parentKey : null,
      parentKey: source.parentKey ? "folder:" + source.parentKey : null,
      baseStatus: error
        ? "error"
        : conflict
          ? "changed"
          : !a
            ? "added"
            : !b
              ? "removed"
              : "equal",
      error:
        error ||
        (conflict ? "同名路径类型不同：文件夹、归档或普通文件。" : undefined),
    };
  });
}

// Recomputed for exports after draft edits too; each file contributes once per ancestor.
export function updateFolderStatuses(report) {
  const folders = report.folders || [],
    byKey = new Map(folders.map((f) => [f.key, f]));
  for (const folder of folders) {
    folder.status = folder.baseStatus;
    folder.counts = counts();
  }
  for (const item of report.items) {
    if (item.type === "directory") continue;
    const seen = new Set(),
      pending = [item.leftParent, item.rightParent];
    while (pending.length) {
      const key = pending.pop(),
        folder = byKey.get(key);
      if (!folder || seen.has(key)) continue;
      seen.add(key);
      folder.counts[item.status]++;
      folder.counts.total++;
      pending.push(folder.leftParent, folder.rightParent);
    }
  }
  const pending = [...folders];
  for (const folder of folders) {
    if (folder.counts.error) folder.status = "error";
    else if (
      folder.status === "equal" &&
      folder.counts.total !== folder.counts.equal
    )
      folder.status = "changed";
  }
  while (pending.length) {
    const child = pending.pop();
    if (child.status === "equal") continue;
    for (const key of new Set([child.leftParent, child.rightParent])) {
      const parent = byKey.get(key);
      if (!parent) continue;
      const status =
        child.status === "error"
          ? "error"
          : parent.status === "equal"
            ? "changed"
            : parent.status;
      if (status !== parent.status) {
        parent.status = status;
        pending.push(parent);
      }
    }
  }
  report.folderSummary = counts();
  for (const folder of folders) {
    report.folderSummary[folder.status]++;
    report.folderSummary.total++;
  }
  report.objectSummary = counts();
  for (const object of overviewObjects(report)) {
    report.objectSummary[object.status]++;
    report.objectSummary.total++;
  }
  return report;
}

export function overviewObjects(report) {
  const folders = report.folders || [],
    matches = new Set(folders.map((f) => f.matchKey));
  return [
    ...folders,
    ...report.items.filter(
      (i) => i.type !== "directory" && !matches.has(i.key),
    ),
  ];
}
