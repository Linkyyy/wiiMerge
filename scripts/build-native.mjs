import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import yauzl from "yauzl";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, ".native-build"),
  app = path.join(output, "app");
const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const version = "24.22.1";
const checksum =
  "d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5";
const cache = path.join(root, ".cache");
await fs.mkdir(cache, { recursive: true });

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(app, { recursive: true });
await fs.cp(path.join(root, "dist"), path.join(app, "dist"), {
  recursive: true,
});
await fs.cp(path.join(root, ".desktop-build/core"), path.join(app, "core"), {
  recursive: true,
});
await fs.copyFile(
  path.join(root, ".desktop-build/THIRD-PARTY-LICENSES.txt"),
  path.join(output, "THIRD-PARTY-LICENSES.txt"),
);
await fs.copyFile(path.join(root, "LICENSE"), path.join(output, "LICENSE"));
const result = await build({
  absWorkingDir: root,
  entryPoints: ["native/server-entry.mjs"],
  outfile: path.join(app, "server.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  minify: true,
  keepNames: true,
  legalComments: "external",
  metafile: true,
});
// The service adds only Node built-ins to packages already licensed by the
// shared comparison worker (safe-regex2 + rules). The native host is first party.
await fs.writeFile(
  path.join(app, "package.json"),
  JSON.stringify({ name: pkg.name, version: pkg.version, type: "module" }),
);
await fs.writeFile(
  path.join(output, "使用说明.txt"),
  "wiiMerge " +
    pkg.version +
    " WebView2 精简版\r\n\r\n解压整个 ZIP 后运行 wiiMerge.exe，请勿只复制该文件。\r\n需要 Windows 10/11 x64、.NET Framework 4.8 和 Microsoft Edge WebView2 Runtime。Windows 11 通常自带。\r\n缺少 WebView2 时请安装微软官方 Evergreen Runtime：https://developer.microsoft.com/microsoft-edge/webview2/\r\n\r\n所有比较在本机进行。程序使用一个仅监听 127.0.0.1 随机端口、带独立会话认证的本地进程；不上传文件内容。\r\n比较引擎与兼容版相同，支持文本、文件夹、Excel、ZIP/WAR/JAR 及 HTML/Excel 导出。\r\n",
);

if (!process.argv.includes("--prepare-only")) {
  const filename = path.join(cache, `node-v${version}-win-x64.zip`);
  let archive;
  try {
    archive = await fs.readFile(filename);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!archive) {
    const response = await fetch(
      `https://nodejs.org/dist/v${version}/node-v${version}-win-x64.zip`,
    );
    if (!response.ok)
      throw new Error(`Node.js download failed: ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(archive).digest("hex") !== checksum)
      throw new Error("Node.js artifact checksum mismatch");
    await fs.writeFile(filename, archive);
  }
  if (createHash("sha256").update(archive).digest("hex") !== checksum)
    throw new Error("Cached Node.js artifact checksum mismatch");
  await fs.mkdir(path.join(output, "runtime"));
  await fs.mkdir(path.join(output, "licenses"));
  const selected = new Map([
    [
      `node-v${version}-win-x64/node.exe`,
      path.join(output, "runtime/node.exe"),
    ],
    [
      `node-v${version}-win-x64/LICENSE`,
      path.join(output, "licenses/Node-LICENSE.txt"),
    ],
  ]);
  const zip = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(archive, { lazyEntries: true }, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  );
  await new Promise((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry) => {
      if (!selected.has(entry.fileName)) {
        zip.readEntry();
        return;
      }
      (async () => {
        const stream = await new Promise((res, rej) =>
          zip.openReadStream(entry, (error, value) =>
            error ? rej(error) : res(value),
          ),
        );
        const chunks = [];
        let bytes = 0;
        for await (const chunk of stream) {
          bytes += chunk.length;
          if (bytes > 200 * 1024 * 1024)
            throw new Error("Unexpected Node runtime size");
          chunks.push(chunk);
        }
        await fs.writeFile(selected.get(entry.fileName), Buffer.concat(chunks));
        selected.delete(entry.fileName);
        zip.readEntry();
      })().catch((error) => {
        zip.close();
        reject(error);
      });
    });
    zip.readEntry();
  });
  if (selected.size)
    throw new Error("Official Node archive is missing required files");
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.env.WIIMERGE_DOTNET || "dotnet",
      [
        "build",
        path.join(root, "native/Host.csproj"),
        "-c",
        "Release",
        "-o",
        output,
        `-p:Version=${pkg.version}`,
        "--nologo",
        "-p:RestoreLockedMode=true",
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1" },
      },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Native host build failed (${code})`)),
    );
  });
  // This launcher is explicitly x64; preserve its loader, remove unused WPF and
  // other CPU loaders rather than shipping every SDK platform.
  for (const cpu of ["win-x86", "win-arm64"])
    await fs.rm(path.join(output, "runtimes", cpu), {
      recursive: true,
      force: true,
    });
  await fs.rm(path.join(output, "Microsoft.Web.WebView2.Wpf.dll"), {
    force: true,
  });
  for (const name of await fs.readdir(output))
    if (name.endsWith(".xml")) await fs.rm(path.join(output, name));
  const nuget =
    process.env.NUGET_PACKAGES ||
    path.join(process.env.USERPROFILE || process.env.HOME, ".nuget/packages");
  const sdk = path.join(nuget, "microsoft.web.webview2/1.0.4314.35");
  const license = (await fs.readdir(sdk)).find((name) =>
    /^licen[cs]e(?:\..*)?$/i.test(name),
  );
  if (!license) throw new Error("WebView2 SDK license was not found");
  await fs.copyFile(
    path.join(sdk, license),
    path.join(output, "licenses/WebView2-LICENSE.txt"),
  );
}
console.log(`Native application staged: ${output}`);
