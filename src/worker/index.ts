import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { processNextQueuedAnalysisJob } from "@/src/services/analysis/service";

const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

let acceptingJobs = true;

function handleShutdown(signal: NodeJS.Signals) {
  console.info(`[worker] received ${signal}; draining current work and stopping.`);
  acceptingJobs = false;
}

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);

async function runWorker() {
  while (acceptingJobs) {
    const handledWork = await processNextQueuedAnalysisJob(workerId);

    if (!handledWork) {
      await sleep(1_000);
    }
  }
}

runWorker().catch((error) => {
  console.error("[worker] fatal error", error);
  process.exitCode = 1;
});
