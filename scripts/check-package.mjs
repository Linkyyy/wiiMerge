import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { extractFile, listPackage } from "@electron/asar";
process.on("uncaughtException", (error) => {
  console.error("::error::" + error.message.replaceAll("\n", "%0A"));
  process.exit(1);
});

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const baseline = JSON.parse(
  await fs.readFile(path.join(root, "build/size-baseline.json"), "utf8"),
);
const directory = path.join(root, "release/win-unpacked");
const archive = path.join(directory, "resources/app.asar");
const manifest = JSON.parse(extractFile(archive, "package.json").toString());
assert.equal(manifest.version, pkg.version, "Packaged version is stale");
assert.ok(
  !manifest.dependencies || !Object.keys(manifest.dependencies).length,
  "Runtime dependencies must be bundled",
);
const entries = listPackage(archive);
assert.ok(
  !entries.some((p) => /\/node_modules(?:\/|$)|\.map$/.test(p)),
  "Release contains redundant dependencies or source maps",
);
for (const name of [
  "electron/main.cjs",
  "electron/preload.cjs",
  "core/worker.mjs",
  "dist/index.html",
  "THIRD-PARTY-LICENSES.txt",
])
  assert.ok(extractFile(archive, name).length, `Missing ${name}`);
const locales = (await fs.readdir(path.join(directory, "locales")))
  .filter((name) => name.endsWith(".pak"))
  .sort();
assert.deepEqual(
  locales,
  ["en-US.pak", "zh-CN.pak", "zh-TW.pak"],
  "Unexpected language payload",
);
const asarBytes = (await fs.stat(archive)).size;
assert.ok(asarBytes <= 8 * 1024 * 1024, "App payload exceeds the 8 MiB budget");
let unpackedBytes = 0;
for (const entry of await fs.readdir(directory, {
  recursive: true,
  withFileTypes: true,
}))
  if (entry.isFile())
    unpackedBytes += (await fs.stat(path.join(entry.parentPath, entry.name)))
      .size;
const filename = `wiiMerge-${pkg.version}-Windows-x64.exe`;
const buffer = await fs.readFile(path.join(root, "release", filename));
assert.ok(
  buffer.length <= 100 * 1024 * 1024,
  `Compatibility EXE exceeds 100 MiB: ${buffer.length} bytes`,
);
const reduction = (old, current) => Math.round((1 - current / old) * 1000) / 10;
const report = {
  version: pkg.version,
  baseline,
  current: { portableBytes: buffer.length, unpackedBytes, asarBytes },
  reductionPercent: {
    portable: reduction(baseline.portableBytes, buffer.length),
    unpacked: reduction(baseline.unpackedBytes, unpackedBytes),
    appPayload: reduction(baseline.asarBytes, asarBytes),
  },
  locales,
};
const hash = createHash("sha256").update(buffer).digest("hex");
await fs.writeFile(
  path.join(root, "release/size-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
await fs.writeFile(
  path.join(root, "release/SHA256SUMS.txt"),
  `${hash}  ${filename}\n`,
);
console.log(JSON.stringify(report, null, 2));
