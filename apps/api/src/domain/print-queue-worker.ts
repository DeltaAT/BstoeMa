import type { PrinterStore } from "./printer-store";

// Minimal logger surface so we can pass Fastify's `app.log` without coupling to
// its full type.
type WorkerLogger = {
  info: (msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export interface PrintQueueWorkerOptions {
  intervalMs?: number;
  logger?: WorkerLogger;
}

/**
 * Periodically drains the active event's print queue so bons that failed to
 * print (printer offline) are delivered as soon as the printer comes back
 * online — the core of issue #130.
 *
 * Ticks never overlap: a slow drain (many queued bons, slow printer) simply
 * skips the next tick rather than piling up concurrent runs against the same
 * SQLite file. Returns a stop function; the timer is `unref`'d so it never
 * keeps the process alive on its own.
 */
export function startPrintQueueWorker(
  printerStore: PrinterStore,
  options: PrintQueueWorkerOptions = {}
): () => void {
  const intervalMs = options.intervalMs ?? 15000;
  const logger = options.logger;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await printerStore.processPrintQueue();
      if (result.printed > 0) {
        logger?.info(
          `Print queue: delivered ${result.printed} queued bon(s), ${result.remaining} still pending`
        );
      }
    } catch (error) {
      logger?.error(error, "Print queue worker tick failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}
