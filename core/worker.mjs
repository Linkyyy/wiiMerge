import { parentPort, workerData } from "node:worker_threads";
import { compare } from "./compare.mjs";
import { htmlReport, excelReport } from "./export.mjs";
try {
  let value;
  if (workerData.action === "export")
    value =
      workerData.format === "html"
        ? htmlReport(workerData.report)
        : await excelReport(workerData.report);
  else
    value = await compare(workerData.request, (progress) =>
      parentPort.postMessage({ type: "progress", value: progress }),
    );
  parentPort.postMessage({ type: "result", value });
} catch (error) {
  parentPort.postMessage({ type: "error", message: error.message });
}
