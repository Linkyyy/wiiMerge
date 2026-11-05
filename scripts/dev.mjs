import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";
const server = await createServer();
await server.listen();
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, WIIMERGE_DEV: "1" },
});
const close = async () => {
  child.kill();
  await server.close();
};
child.on("exit", async (code) => {
  await server.close();
  process.exitCode = code ?? 1;
});
process.on("SIGINT", close);
process.on("SIGTERM", close);
