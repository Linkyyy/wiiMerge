import path from "node:path";
import { createService } from "./service.mjs";

(async () => {
  const service = await createService({
    appRoot: path.dirname(process.argv[1]),
    dataDir: process.env.WIIMERGE_DATA_DIR,
    nativeToken: process.env.WIIMERGE_NATIVE_TOKEN,
  });
  process.stdout.write(
    JSON.stringify({ origin: service.origin, launchURL: service.launchURL }) +
      "\n",
  );
  const stop = async () => {
    await service.close();
    process.exit(0);
  };
  process.stdin.resume();
  process.stdin.on("end", stop);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
