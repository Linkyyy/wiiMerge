import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".desktop-build");
const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, "electron"), { recursive: true });
await fs.mkdir(path.join(output, "core"), { recursive: true });
const shared = {
  absWorkingDir: root,
  bundle: true,
  platform: "node",
  target: "node22",
  minify: true,
  keepNames: true,
  sourcemap: false,
  legalComments: "external",
  metafile: true,
  logLevel: "info",
};
const builds = await Promise.all([
  build({
    ...shared,
    entryPoints: ["electron/main.cjs"],
    outfile: path.join(output, "electron/main.cjs"),
    format: "cjs",
    external: ["electron"],
  }),
  build({
    ...shared,
    entryPoints: ["core/worker.mjs"],
    outfile: path.join(output, "core/worker.mjs"),
    format: "esm",
    banner: {
      js: 'import { createRequire as __wmCreateRequire } from "node:module"; const require = __wmCreateRequire(import.meta.url);',
    },
  }),
]);

// Include the licenses of every package whose code actually enters a bundle.
const packageRoots = new Set();
const require = createRequire(import.meta.url);
for (const name of ["react", "react-dom", "scheduler", "lucide-react"])
  packageRoots.add(path.dirname(require.resolve(`${name}/package.json`)));
for (const result of builds)
  for (const input of Object.keys(result.metafile.inputs)) {
    const normalized = input.replaceAll("\\", "/");
    const start = normalized.lastIndexOf("node_modules/");
    if (start < 0) continue;
    const segments = normalized
      .slice(start + "node_modules/".length)
      .split("/");
    const name = segments[0].startsWith("@")
      ? segments.slice(0, 2).join("/")
      : segments[0];
    packageRoots.add(
      path.resolve(root, normalized.slice(0, start) + "node_modules/" + name),
    );
  }
const licenses = [],
  missing = [];
for (const directory of [...packageRoots].sort()) {
  const data = JSON.parse(
    await fs.readFile(path.join(directory, "package.json"), "utf8"),
  );
  const names = (await fs.readdir(directory)).filter((name) =>
    /^(?:licen[cs]e(?:[.-].*)?|copying(?:[.-].*)?|notice(?:[.-].*)?)$/i.test(
      name,
    ),
  );
  const texts = [];
  for (const name of names)
    if ((await fs.stat(path.join(directory, name))).isFile())
      texts.push(await fs.readFile(path.join(directory, name), "utf8"));
  if (!texts.length) {
    const readme = (await fs.readdir(directory)).find((name) =>
      /^readme(?:\.md|\.markdown|\.txt)?$/i.test(name),
    );
    if (readme) {
      const content = await fs.readFile(path.join(directory, readme), "utf8");
      const license = content.match(
        /(?:^|\n)#+\s+(?:license|copyright)\b[\s\S]*/i,
      );
      if (license) texts.push(license[0]);
    }
  }
  if (!texts.length) {
    try {
      texts.push(
        await fs.readFile(
          path.join(
            root,
            "build/licenses",
            `${data.name.replaceAll("/", "-")}-${data.version}.txt`,
          ),
          "utf8",
        ),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!texts.length) missing.push(`${data.name}@${data.version}`);
  licenses.push(
    `${data.name}@${data.version}\n${"=".repeat(70)}\n${texts.join("\n\n")}`,
  );
}
if (missing.length)
  throw new Error(`Missing bundled license text: ${missing.join(", ")}`);
await fs.writeFile(
  path.join(output, "THIRD-PARTY-LICENSES.txt"),
  licenses.join("\n\n"),
);
await fs.copyFile(path.join(root, "LICENSE"), path.join(output, "LICENSE"));
await fs.copyFile(
  path.join(root, "electron/preload.cjs"),
  path.join(output, "electron/preload.cjs"),
);
await fs.cp(path.join(root, "dist"), path.join(output, "dist"), {
  recursive: true,
});
await fs.mkdir(path.join(output, "build"));
await fs.copyFile(
  path.join(root, "build/icon.png"),
  path.join(output, "build/icon.png"),
);
// A separate app manifest prevents electron-builder from adding root dependencies
// (including React development builds, icon libraries and source maps) again.
await fs.writeFile(
  path.join(output, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      productName: pkg.build.productName,
      version: pkg.version,
      description: pkg.description,
      main: "electron/main.cjs",
      type: "module",
      author: pkg.author,
      license: pkg.license,
    },
    null,
    2,
  ) + "\n",
);
let bytes = 0,
  count = 0;
for (const entry of await fs.readdir(output, {
  recursive: true,
  withFileTypes: true,
}))
  if (entry.isFile()) {
    bytes += (await fs.stat(path.join(entry.parentPath, entry.name))).size;
    count++;
  }
if (bytes > 8 * 1024 * 1024)
  throw new Error("Staged app exceeds the 8 MiB size budget");
console.log(
  `Desktop payload: ${count} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB; ${packageRoots.size} bundled package licenses preserved`,
);
