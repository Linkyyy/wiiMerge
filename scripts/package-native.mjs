import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import yazl from "yazl";

const root = path.resolve(import.meta.dirname, "..");
const directory = path.join(root, ".native-build");
const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const baseline = JSON.parse(
  await fs.readFile(path.join(root, "build/size-baseline.json"), "utf8"),
);
for (const name of [
  "wiiMerge.exe",
  "runtime/node.exe",
  "Microsoft.Web.WebView2.Core.dll",
  "Microsoft.Web.WebView2.WinForms.dll",
  "runtimes/win-x64/native/WebView2Loader.dll",
  "app/server.cjs",
  "app/core/worker.mjs",
  "app/dist/index.html",
  "licenses/WebView2-LICENSE.txt",
  "licenses/Node-LICENSE.txt",
])
  assert.ok(
    (await fs.stat(path.join(directory, name))).size,
    `Missing native runtime file: ${name}`,
  );
const zip = new yazl.ZipFile(),
  files = [];
let unpackedBytes = 0;
for (const entry of await fs.readdir(directory, {
  recursive: true,
  withFileTypes: true,
}))
  if (entry.isFile()) {
    const filename = path.join(entry.parentPath, entry.name),
      relative = path.relative(directory, filename).replaceAll("\\", "/");
    assert.ok(
      !relative.includes("node_modules/") && !/\.(map|pdb)$/.test(relative),
      `Redundant file: ${relative}`,
    );
    const bytes = (await fs.stat(filename)).size;
    unpackedBytes += bytes;
    files.push({ filename, relative, bytes });
  }
await fs.mkdir(path.join(root, "release"), { recursive: true });
const filename = `wiiMerge-${pkg.version}-WebView2-Windows-x64.zip`;
const output = path.join(root, "release", filename);
const writing = pipeline(zip.outputStream, createWriteStream(output));
for (const file of files.sort((a, b) =>
  a.relative.localeCompare(b.relative, "en"),
))
  zip.addFile(file.filename, file.relative, { compressionLevel: 9 });
zip.end();
await writing;
const bytes = (await fs.stat(output)).size;
assert.ok(
  bytes < 60 * 1024 * 1024,
  "WebView2 ZIP exceeds the 60 MiB size budget",
);
const report = {
  version: pkg.version,
  format: "WebView2 portable ZIP",
  baseline,
  current: { portableBytes: bytes, unpackedBytes, files: files.length },
  reductionPercent: {
    portable: Math.round((1 - bytes / baseline.portableBytes) * 1000) / 10,
    unpacked:
      Math.round((1 - unpackedBytes / baseline.unpackedBytes) * 1000) / 10,
  },
  prerequisites: [
    "Windows 10/11 x64",
    ".NET Framework 4.8",
    "Microsoft Edge WebView2 Runtime",
  ],
  browserBundled: false,
  nodeRuntimeBundled: true,
};
const buffer = await fs.readFile(output);
const digest = createHash("sha256").update(buffer).digest("hex");
await fs.writeFile(
  path.join(root, "release/WebView2-size-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
await fs.writeFile(
  path.join(root, "release/WebView2-SHA256SUMS.txt"),
  `${digest}  ${filename}\n`,
);
await fs.writeFile(
  path.join(directory, "size-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
const fileHashes = [];
for (const file of files)
  fileHashes.push(
    `${createHash("sha256")
      .update(await fs.readFile(file.filename))
      .digest("hex")}  ${file.relative}`,
  );
await fs.writeFile(
  path.join(directory, "SHA256SUMS.txt"),
  fileHashes.join("\n") + "\n",
);
console.log(JSON.stringify(report, null, 2));
