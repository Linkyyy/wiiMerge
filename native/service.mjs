import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { validateRules, DEFAULT_RULES } from "../core/rules.mjs";
import { Workspace } from "../core/workspace.mjs";

const json = (response, status, value) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
};
const same = (a, b) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function createService({
  appRoot,
  dataDir,
  nativeToken,
  workerURL = pathToFileURL(path.join(appRoot, "core/worker.mjs")),
}) {
  if (typeof nativeToken !== "string" || nativeToken.length < 32)
    throw new Error("Missing native host credential");
  const session = randomBytes(32).toString("hex");
  const cookieName = `wm_${randomBytes(8).toString("hex")}`;
  const allowedPaths = new Set(),
    listeners = new Set();
  const rulesPath = path.join(dataDir, "rules.json");
  let activeWorker,
    lastReport,
    origin,
    stopping = false;

  function execute(data) {
    if (activeWorker) return Promise.reject(new Error("已有任务正在运行"));
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerURL, {
        workerData: data,
        resourceLimits: { maxOldGenerationSizeMb: 768 },
      });
      activeWorker = worker;
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (activeWorker === worker) activeWorker = null;
        worker.terminate();
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(
        () =>
          finish(new Error("任务超过 120 秒，已停止。请缩小范围或简化规则。")),
        120000,
      );
      worker.on("message", (message) => {
        if (message.type === "result") finish(null, message.value);
        else if (message.type === "error") finish(new Error(message.message));
        else if (message.type === "progress")
          for (const client of listeners)
            client.write(`data: ${JSON.stringify(message.value)}\n\n`);
      });
      worker.on("error", finish);
      worker.on("exit", () => finish(new Error("任务已取消")));
    });
  }

  async function body(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      // JSON escaping can expand each logical text character up to six bytes;
      // preserve the existing 2 MiB-per-side limit after transport encoding.
      if (size > 25 * 1024 * 1024) throw new Error("请求超过 25 MiB 上限");
      chunks.push(chunk);
    }
    return chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : {};
  }
  const workspace = new Workspace(execute, dataDir, (report) => {
    for (const client of listeners)
      client.write(`data: ${JSON.stringify({ reportUpdated: report })}\n\n`);
  });

  const server = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) {
        json(response, 403, { error: "不允许的请求主机" });
        return;
      }
      const url = new URL(request.url, origin);
      if (url.origin !== origin) {
        json(response, 403, { error: "不允许的请求地址" });
        return;
      }
      if (request.method === "GET" && url.pathname === `/launch/${session}`) {
        response.writeHead(302, {
          Location: "/" + url.search,
          "Set-Cookie": `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        });
        response.end();
        return;
      }
      const native = url.pathname.startsWith("/native/");
      const cookies = request.headers.cookie
        ?.split(/;\s*/)
        .find((s) => s.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1);
      if (
        native
          ? !same(request.headers["x-wiimerge-native"], nativeToken)
          : !same(cookies, session)
      ) {
        json(response, 403, { error: "未授权的请求" });
        return;
      }
      if (
        !native &&
        request.method === "POST" &&
        request.headers.origin !== origin
      ) {
        json(response, 403, { error: "不允许的请求来源" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/progress") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        response.write(": ready\n\n");
        listeners.add(response);
        response.on("close", () => listeners.delete(response));
        return;
      }
      if (request.method === "POST") {
        const input = await body(request);
        let result;
        switch (url.pathname) {
          case "/native/authorize": {
            if (typeof input.path !== "string" || !path.isAbsolute(input.path))
              throw new Error("无效的路径");
            const absolute = path.resolve(input.path),
              stat = await fs.lstat(absolute);
            if (
              stat.isSymbolicLink() ||
              (!stat.isFile() && !stat.isDirectory())
            )
              throw new Error("请选择普通文件或文件夹");
            allowedPaths.add(absolute);
            result = {
              path: absolute,
              kind: stat.isDirectory() ? "folder" : "file",
            };
            break;
          }
          case "/api/compare": {
            if (!["text", "files", "folders"].includes(input.mode))
              throw new Error("无效的比较模式");
            if (input.mode !== "text")
              for (const side of ["left", "right"])
                if (
                  typeof input[side] !== "string" ||
                  !allowedPaths.has(path.resolve(input[side]))
                )
                  throw new Error("请通过选择按钮或拖放授权读取路径");
            input.rules = validateRules(input.rules);
            lastReport = await execute({ action: "compare", request: input });
            result = workspace.add(lastReport, input);
            break;
          }
          case "/api/report":
            result = workspace.getReport(input.id);
            break;
          case "/native/report-info":
            result = { id: workspace.session(input.id).report.id };
            break;
          case "/native/release-report":
            workspace.release(input.id);
            result = true;
            break;
          case "/api/open-document":
            result = await workspace.open(input.reportId, input.itemKey);
            break;
          case "/api/preview-document":
            result = workspace.preview(input.id, input.left, input.right);
            break;
          case "/native/document-info": {
            const d = workspace.describe(workspace.document(input.id));
            result = { id: d.id, sides: d.sides };
            break;
          }
          case "/native/save-document":
            result = await workspace.save(input.id, input.side, input.path);
            break;
          case "/native/adopt-file":
            result = await workspace.adoptFile(
              input.reportId,
              input.itemKey,
              input.from,
            );
            break;
          case "/api/cancel":
            activeWorker?.terminate();
            result = true;
            break;
          case "/api/load-rules":
            try {
              result = validateRules(
                JSON.parse(await fs.readFile(rulesPath, "utf8")),
              );
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
              result = structuredClone(DEFAULT_RULES);
            }
            break;
          case "/api/save-rules": {
            result = validateRules(input);
            await fs.mkdir(dataDir, { recursive: true });
            await fs.writeFile(
              rulesPath + ".tmp",
              JSON.stringify(result, null, 2),
              { mode: 0o600 },
            );
            await fs.rename(rulesPath + ".tmp", rulesPath);
            break;
          }
          case "/native/export-report": {
            if (!["html", "xlsx"].includes(input.format))
              throw new Error("不支持的导出格式");
            const exportReport = workspace.getReport(input.id);
            const content = await execute({
              action: "export",
              report: exportReport,
              format: input.format,
            });
            await fs.writeFile(
              input.path,
              typeof content === "string" ? content : Buffer.from(content),
            );
            result = input.path;
            break;
          }
          case "/native/import-rules": {
            if ((await fs.stat(input.path)).size > 65536)
              throw new Error("规则文件不能超过 64 KiB");
            result = validateRules(
              JSON.parse(await fs.readFile(input.path, "utf8")),
            );
            break;
          }
          case "/native/export-rules":
            await fs.writeFile(
              input.path,
              JSON.stringify(validateRules(input.rules), null, 2),
              { mode: 0o600 },
            );
            result = input.path;
            break;
          default:
            json(response, 404, { error: "未知操作" });
            return;
        }
        json(response, 200, result);
        return;
      }
      if (request.method !== "GET") {
        json(response, 405, { error: "不支持的方法" });
        return;
      }
      const name =
        decodeURIComponent(url.pathname) === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname).slice(1);
      const dist = path.join(appRoot, "dist"),
        filename = path.resolve(dist, name);
      if (
        !filename.startsWith(dist + path.sep) ||
        ![".html", ".js", ".css", ".png", ".svg", ".ico"].includes(
          path.extname(filename),
        )
      ) {
        json(response, 404, { error: "文件不存在" });
        return;
      }
      const data = await fs.readFile(filename);
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
      };
      response.writeHead(200, {
        "Content-Type": types[path.extname(filename)],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(data);
    } catch (error) {
      if (!response.headersSent)
        json(response, error.code === "ENOENT" ? 404 : 400, {
          error: error.message,
        });
      else response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    launchURL: `${origin}/launch/${session}`,
    async close() {
      if (stopping) return;
      stopping = true;
      await activeWorker?.terminate();
      for (const response of listeners) response.end();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
