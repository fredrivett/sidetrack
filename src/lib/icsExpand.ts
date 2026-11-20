// Working out a calendar's occurrences (icsEvents.mts) runs on another
// thread, with a time limit. The data is anyone's invite, and some repeat
// rules, such as one that can never match ("every 30 February"), send
// ical.js round a loop without end. On the server's own thread that would
// hold up every request; here the thread is stopped and the calendar's sync
// fails, to be tried again later. Framework-agnostic: no DB access.

import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import type { Occurrence } from "./icsEvents.mts";

const WORKER = "src/lib/icsWorker.mts";

/** How long one calendar's events may take to work out. */
export const EXPAND_TIMEOUT_MS = 10_000;

/** Working the events out took longer than EXPAND_TIMEOUT_MS. */
export class ExpandTimeoutError extends Error {
  constructor() {
    super("the calendar's events took too long to read");
  }
}

/** eventsIn(ics, window, opts), on a worker thread that's stopped after `timeoutMs`. */
export function expandEvents(
  ics: string[],
  window: { from: number; to: number },
  opts: { addresses: string[]; fallbackZone: string },
  timeoutMs = EXPAND_TIMEOUT_MS,
): Promise<Occurrence[]> {
  // The build sees this path and bundles the worker into a chunk of its
  // own, ical.js included; tests run the file itself, as TypeScript.
  const worker = new Worker(resolve(process.cwd(), WORKER), {
    workerData: { ics, window, opts },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<Occurrence[]>((resolve, reject) => {
    timer = setTimeout(() => reject(new ExpandTimeoutError()), timeoutMs);
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => reject(new Error(`event worker stopped (${code})`)));
  }).finally(() => {
    // Whatever happened, the thread doesn't outlive the answer.
    clearTimeout(timer);
    void worker.terminate();
  });
}
