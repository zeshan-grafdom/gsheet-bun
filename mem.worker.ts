// mem.worker.ts
import { parentPort } from "worker_threads";

function mb(n: number) {
  return Math.round((n / 1024 / 1024) * 100) / 100;
}
function snapshot() {
  const m = process.memoryUsage();
  return {
    ts: Date.now(),
    rssMB: mb(m.rss),
    heapUsedMB: mb(m.heapUsed),
    heapTotalMB: mb(m.heapTotal),
  };
}

setInterval(() => {
  parentPort?.postMessage(snapshot());
}, 1000);
