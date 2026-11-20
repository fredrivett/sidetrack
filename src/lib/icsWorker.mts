// Runs eventsIn off the server's main thread (see expandEvents in
// icsExpand.ts): one calendar's data in, its occurrences out. The build
// bundles it on its own; tests have Node run it as TypeScript, so its
// imports name their files.

import { parentPort, workerData } from "node:worker_threads";
import { eventsIn } from "./icsEvents.mts";

const { ics, window, opts } = workerData as {
  ics: string[];
  window: { from: number; to: number };
  opts: { addresses: string[]; fallbackZone: string };
};
parentPort?.postMessage(eventsIn(ics, window, opts));
