import Database from "better-sqlite3";
import type {
  OrderPrintResponse,
  OrderPrintResultDto,
  PrinterCreateRequest,
  PrinterDto,
  PrinterTestPrintResponse,
  PrinterUpdateRequest,
} from "@serva/shared-types";
import { PrinterTypes, ThermalPrinter } from "node-thermal-printer";
import { ApiError } from "./api-error";
import type { EventStore } from "./event-store";

type PrinterRow = {
  id: number;
  name: string;
  ipAddress: string;
  connectionDetails: string;
};

type OrderRowForPrint = {
  id: number;
  timestamp: string;
  tableName: string;
  waiterUsername: string;
};

type OrderItemRowForPrint = {
  menuItemName: string;
  quantity: number;
  specialRequests: string;
  printerId: number | null;
  printerName: string | null;
  printerIpAddress: string | null;
  printerConnectionDetails: string | null;
};

// The subset of an order item needed to render a bon — everything else in
// OrderItemRowForPrint is routing metadata used before rendering.
type BonItem = {
  menuItemName: string;
  quantity: number;
  specialRequests: string;
};

// Self-contained snapshot persisted in PrintQueue.payload. Re-rendering from
// this never touches the (possibly since-edited) order/menu tables.
type PrintQueuePayload = {
  printerName: string;
  order: OrderRowForPrint;
  items: BonItem[];
};

type PrintQueueRow = {
  id: number;
  orderId: number;
  printerId: number;
  printerName: string;
  target: string;
  payload: string;
  itemCount: number;
  attempts: number;
};

// Renders an ISO timestamp as HH:MM in the host's local time. The kitchen only
// cares about wall-clock when the bon was placed, not the date.
function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Splits the stored special-requests string back into its constituent requests.
// The client joins requests with "; " and prefixes a count only when >1 unit
// shares the same note (e.g. "2x ohne Zwiebeln; extra Käse"). A missing prefix
// means a single unit.
function parseSpecialRequests(raw: string): Array<{ qty: number; text: string }> {
  if (!raw) return [];
  const requests: Array<{ qty: number; text: string }> = [];
  for (const part of raw.split("; ")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = /^(\d+)x (.+)$/.exec(trimmed);
    if (match) {
      requests.push({ qty: Number(match[1]), text: match[2] });
    } else {
      requests.push({ qty: 1, text: trimmed });
    }
  }
  return requests;
}

export class PrinterStore {
  constructor(private readonly eventStore: EventStore) {}

  private openActiveEventDb() {
    const activeEvent = this.eventStore.getActiveEvent();
    if (!activeEvent) {
      throw new ApiError(
        409,
        "NO_ACTIVE_EVENT",
        "No active event exists. Activate an event before calling this endpoint."
      );
    }

    const db = new Database(activeEvent.dbFilePath);
    this.ensurePrinterSchema(db);
    this.ensurePrintQueueSchema(db);
    return db;
  }

  private ensurePrinterSchema(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS Printers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        ipAddress TEXT NOT NULL,
        connectionDetails TEXT NOT NULL DEFAULT ''
      );

      CREATE UNIQUE INDEX IF NOT EXISTS Printers_name_key ON Printers(name);
    `);
  }

  // Holds bons that could not be delivered because their printer was offline.
  // `payload` is a self-contained JSON snapshot of the bon (see PrintQueuePayload)
  // so a retry re-renders exactly what was ordered, independent of any later
  // edits to the order. The UNIQUE(orderId, printerId) key means re-printing the
  // same order while the printer is still down refreshes the pending job rather
  // than stacking duplicates that would all fire at once on reconnect.
  private ensurePrintQueueSchema(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS PrintQueue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orderId INTEGER NOT NULL,
        printerId INTEGER NOT NULL,
        printerName TEXT NOT NULL,
        target TEXT NOT NULL,
        payload TEXT NOT NULL,
        itemCount INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        lastError TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS PrintQueue_order_printer_key
        ON PrintQueue(orderId, printerId);
    `);
  }

  private mapDbError(error: unknown): never {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      throw new ApiError(409, "PRINTER_ALREADY_EXISTS", "Printer name already exists");
    }

    throw error;
  }

  private toPrinterDto(row: PrinterRow): PrinterDto {
    return {
      id: row.id,
      name: row.name,
      ipAddress: row.ipAddress,
      connectionDetails: row.connectionDetails,
    };
  }

  private getPrinterRowById(db: Database.Database, printerId: number) {
    return db
      .prepare(
        `
        SELECT id, name, ipAddress, connectionDetails
        FROM Printers
        WHERE id = ?
        `
      )
      .get(printerId) as PrinterRow | undefined;
  }

  private getPort(connectionDetails: string) {
    const trimmed = connectionDetails.trim();
    if (!trimmed) {
      return 9100;
    }

    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }

    return 9100;
  }

  private getTestPrintTimeoutMs() {
    const raw = process.env.PRINTER_TEST_PRINT_TIMEOUT_MS;
    if (!raw) {
      return 4000;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 30000) {
      return 4000;
    }

    return parsed;
  }

  private mapPrinterConnectionError(input: {
    error: unknown;
    printerName: string;
    target: string;
  }): ApiError {
    const { error, printerName, target } = input;
    const reason = error instanceof Error ? error.message : String(error);
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";

    if (code === "ECONNREFUSED") {
      return new ApiError(
        409,
        "PRINTER_CONNECTION_REFUSED",
        `Printer '${printerName}' rejected the TCP connection at ${target}.`,
        {
          target,
          reason,
          hint: "Check IP/port configuration and ensure the printer is powered on.",
        }
      );
    }

    if (code === "ETIMEDOUT") {
      return new ApiError(
        409,
        "PRINTER_CONNECTION_TIMEOUT",
        `Connection to printer '${printerName}' timed out (${target}).`,
        {
          target,
          reason,
          hint: "Ensure the printer is reachable in the same network and not blocked by a firewall.",
        }
      );
    }

    if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
      return new ApiError(
        409,
        "PRINTER_HOST_UNREACHABLE",
        `Printer host for '${printerName}' is unreachable (${target}).`,
        {
          target,
          reason,
          hint: "Verify network routing and printer IP address.",
        }
      );
    }

    return new ApiError(
      409,
      "PRINTER_CONNECTION_FAILED",
      `Could not connect to printer '${printerName}' at ${target}.`,
      {
        target,
        reason,
        hint: "Check printer connectivity and connectionDetails (port).",
      }
    );
  }

  private createThermalPrinter(target: string) {
    return new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${target}`,
      options: { timeout: this.getTestPrintTimeoutMs() },
    });
  }

  listPrinters(): PrinterDto[] {
    const db = this.openActiveEventDb();
    try {
      const rows = db
        .prepare(
          `
          SELECT id, name, ipAddress, connectionDetails
          FROM Printers
          ORDER BY name COLLATE NOCASE ASC
          `
        )
        .all() as PrinterRow[];
      return rows.map((row) => this.toPrinterDto(row));
    } finally {
      db.close();
    }
  }

  getPrinter(printerId: number): PrinterDto {
    const db = this.openActiveEventDb();
    try {
      const row = this.getPrinterRowById(db, printerId);
      if (!row) {
        throw new ApiError(404, "PRINTER_NOT_FOUND", "Printer not found");
      }

      return this.toPrinterDto(row);
    } finally {
      db.close();
    }
  }

  createPrinter(input: PrinterCreateRequest): PrinterDto {
    const db = this.openActiveEventDb();
    try {
      let result: Database.RunResult;
      try {
        result = db
          .prepare("INSERT INTO Printers (name, ipAddress, connectionDetails) VALUES (?, ?, ?)")
          .run(input.name, input.ipAddress, input.connectionDetails ?? "");
      } catch (error) {
        this.mapDbError(error);
      }

      const created = this.getPrinterRowById(db, Number(result!.lastInsertRowid));
      if (!created) {
        throw new ApiError(500, "PRINTER_CREATE_FAILED", "Failed to create printer");
      }

      return this.toPrinterDto(created);
    } finally {
      db.close();
    }
  }

  updatePrinter(printerId: number, input: PrinterUpdateRequest): PrinterDto {
    const db = this.openActiveEventDb();
    try {
      const existing = this.getPrinterRowById(db, printerId);
      if (!existing) {
        throw new ApiError(404, "PRINTER_NOT_FOUND", "Printer not found");
      }

      try {
        db
          .prepare(
            `
            UPDATE Printers
            SET name = ?, ipAddress = ?, connectionDetails = ?
            WHERE id = ?
            `
          )
          .run(
            input.name ?? existing.name,
            input.ipAddress ?? existing.ipAddress,
            input.connectionDetails ?? existing.connectionDetails,
            printerId
          );
      } catch (error) {
        this.mapDbError(error);
      }

      const updated = this.getPrinterRowById(db, printerId);
      if (!updated) {
        throw new ApiError(500, "PRINTER_UPDATE_FAILED", "Failed to update printer");
      }

      return this.toPrinterDto(updated);
    } finally {
      db.close();
    }
  }

  deletePrinter(printerId: number): void {
    const db = this.openActiveEventDb();
    try {
      const existing = this.getPrinterRowById(db, printerId);
      if (!existing) {
        throw new ApiError(404, "PRINTER_NOT_FOUND", "Printer not found");
      }

      const usage = db
        .prepare("SELECT COUNT(*) as count FROM MenuCategories WHERE printer_id = ?")
        .get(printerId) as { count: number };
      if (usage.count > 0) {
        throw new ApiError(
          409,
          "PRINTER_IN_USE",
          "Cannot delete printer while it is assigned to menu categories"
        );
      }

      db.prepare("DELETE FROM Printers WHERE id = ?").run(printerId);
    } finally {
      db.close();
    }
  }

  async printOrder(orderId: number): Promise<OrderPrintResponse> {
    const db = this.openActiveEventDb();
    try {
      this.ensureOrderPrintReadSchema(db);

      const order = db
        .prepare(
          `
          SELECT
            o.id as id,
            o.timestamp as timestamp,
            COALESCE(t.name, '') as tableName,
            COALESCE(u.username, '') as waiterUsername
          FROM Orders o
          LEFT JOIN Tables t ON t.id = o.table_id
          LEFT JOIN Users u ON u.id = o.user_id
          WHERE o.id = ?
          `
        )
        .get(orderId) as OrderRowForPrint | undefined;

      if (!order) {
        throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found");
      }

      const items = db
        .prepare(
          `
          SELECT
            mi.name as menuItemName,
            oi.quantity as quantity,
            COALESCE(oi.specialRequests, '') as specialRequests,
            mc.printer_id as printerId,
            p.name as printerName,
            p.ipAddress as printerIpAddress,
            p.connectionDetails as printerConnectionDetails
          FROM OrderItems oi
          JOIN MenuItems mi ON mi.id = oi.menuItem_id
          JOIN MenuCategories mc ON mc.id = mi.menuCategory_id
          LEFT JOIN Printers p ON p.id = mc.printer_id
          WHERE oi.order_id = ?
          ORDER BY mc.weight ASC, mi.weight ASC, mi.name COLLATE NOCASE ASC
          `
        )
        .all(orderId) as OrderItemRowForPrint[];

      type Group = {
        printerId: number | null;
        printerName: string;
        printerIpAddress: string | null;
        printerConnectionDetails: string | null;
        items: OrderItemRowForPrint[];
      };

      const groups = new Map<string, Group>();
      for (const item of items) {
        const key = item.printerId === null ? "none" : String(item.printerId);
        const existing = groups.get(key);
        if (existing) {
          existing.items.push(item);
          continue;
        }
        groups.set(key, {
          printerId: item.printerId,
          printerName: item.printerName ?? "(kein Drucker zugewiesen)",
          printerIpAddress: item.printerIpAddress,
          printerConnectionDetails: item.printerConnectionDetails,
          items: [item],
        });
      }

      const results: OrderPrintResultDto[] = [];
      for (const group of groups.values()) {
        const itemCount = group.items.reduce((sum, it) => sum + it.quantity, 0);

        if (group.printerId === null || group.printerIpAddress === null) {
          results.push({
            printerName: group.printerName,
            status: "skipped",
            itemCount,
            message:
              "Diese Artikel haben keinen Drucker zugewiesen und wurden nicht gedruckt.",
            code: "NO_PRINTER_ASSIGNED",
          });
          continue;
        }

        const port = this.getPort(group.printerConnectionDetails ?? "");
        const target = `${group.printerIpAddress}:${port}`;

        try {
          await this.printBon({
            target,
            printerName: group.printerName,
            order,
            items: group.items,
          });

          results.push({
            printerId: group.printerId,
            printerName: group.printerName,
            status: "ok",
            itemCount,
            message: `Bon an '${group.printerName}' gedruckt.`,
            target,
          });
        } catch (error) {
          const apiError =
            error instanceof ApiError
              ? error
              : this.mapPrinterConnectionError({
                  error,
                  printerName: group.printerName,
                  target,
                });

          const details = apiError.details as
            | { target?: string; hint?: string }
            | undefined;

          // Printer offline → don't drop the bon. Persist a self-contained
          // snapshot to the queue so the background worker can print it once
          // the printer is reachable again (issue #130).
          this.enqueuePrintJob(db, {
            orderId: order.id,
            printerId: group.printerId,
            printerName: group.printerName,
            target,
            itemCount,
            payload: { printerName: group.printerName, order, items: group.items },
            errorMessage: apiError.message,
          });

          results.push({
            printerId: group.printerId,
            printerName: group.printerName,
            status: "queued",
            itemCount,
            message: `Drucker '${group.printerName}' offline — Bon in Warteschlange, wird bei Wiederverbindung gedruckt.`,
            code: apiError.code,
            target: details?.target ?? target,
            hint: details?.hint,
          });
        }
      }

      return {
        orderId: order.id,
        printingEnabled: true,
        results,
      };
    } finally {
      db.close();
    }
  }

  private ensureOrderPrintReadSchema(db: Database.Database) {
    // Defensive: the order/menu/table tables are normally created by their own
    // stores before printing happens, but in tests we may print right after
    // submitting and expect the joins to resolve cleanly.
    db.exec(`
      CREATE TABLE IF NOT EXISTS Orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        table_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS OrderItems (
        order_id INTEGER NOT NULL,
        menuItem_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        specialRequests TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (order_id, menuItem_id)
      );
    `);
  }

  // Connects to a single printer and prints one bon. Throws an ApiError on any
  // connection/execution failure so callers can decide whether to surface the
  // error (interactive print) or enqueue for retry (queue worker).
  private async printBon(input: {
    target: string;
    printerName: string;
    order: OrderRowForPrint;
    items: BonItem[];
  }): Promise<void> {
    const { target, printerName, order, items } = input;
    const printer = this.createThermalPrinter(target);

    let connected = false;
    try {
      connected = await printer.isPrinterConnected();
    } catch (error) {
      throw this.mapPrinterConnectionError({ error, printerName, target });
    }

    if (!connected) {
      throw new ApiError(
        409,
        "PRINTER_CONNECTION_FAILED",
        `No response from printer '${printerName}' at ${target}.`,
        {
          target,
          hint: "Check IP/port configuration and printer power/network state.",
        }
      );
    }

    this.formatOrderBon(printer, { printerName, order, items });

    try {
      await printer.execute();
    } catch (error) {
      throw this.mapPrinterConnectionError({ error, printerName, target });
    }
  }

  private enqueuePrintJob(
    db: Database.Database,
    input: {
      orderId: number;
      printerId: number;
      printerName: string;
      target: string;
      itemCount: number;
      payload: PrintQueuePayload;
      errorMessage: string;
    }
  ) {
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO PrintQueue
        (orderId, printerId, printerName, target, payload, itemCount, attempts, lastError, createdAt, updatedAt)
      VALUES
        (@orderId, @printerId, @printerName, @target, @payload, @itemCount, 1, @lastError, @now, @now)
      ON CONFLICT(orderId, printerId) DO UPDATE SET
        printerName = excluded.printerName,
        target = excluded.target,
        payload = excluded.payload,
        itemCount = excluded.itemCount,
        attempts = PrintQueue.attempts + 1,
        lastError = excluded.lastError,
        updatedAt = excluded.updatedAt
      `
    ).run({
      orderId: input.orderId,
      printerId: input.printerId,
      printerName: input.printerName,
      target: input.target,
      payload: JSON.stringify(input.payload),
      itemCount: input.itemCount,
      lastError: input.errorMessage,
      now,
    });
  }

  // Drains the active event's print queue: retries every pending bon, deleting
  // the ones that print successfully and bumping the attempt counter on the
  // rest. No-op when no event is active. Called on an interval by the print
  // queue worker (see print-queue-worker.ts) and directly by tests.
  async processPrintQueue(): Promise<{ printed: number; failed: number; remaining: number }> {
    const activeEvent = this.eventStore.getActiveEvent();
    if (!activeEvent) {
      return { printed: 0, failed: 0, remaining: 0 };
    }

    const db = new Database(activeEvent.dbFilePath);
    this.ensurePrintQueueSchema(db);
    try {
      const jobs = db
        .prepare(
          `
          SELECT id, orderId, printerId, printerName, target, payload, itemCount, attempts
          FROM PrintQueue
          ORDER BY createdAt ASC, id ASC
          `
        )
        .all() as PrintQueueRow[];

      let printed = 0;
      let failed = 0;

      for (const job of jobs) {
        let payload: PrintQueuePayload;
        try {
          payload = JSON.parse(job.payload) as PrintQueuePayload;
        } catch {
          // Unparseable payload can never succeed — drop it so it stops
          // blocking the queue.
          db.prepare("DELETE FROM PrintQueue WHERE id = ?").run(job.id);
          continue;
        }

        try {
          await this.printBon({
            target: job.target,
            printerName: payload.printerName,
            order: payload.order,
            items: payload.items,
          });
          db.prepare("DELETE FROM PrintQueue WHERE id = ?").run(job.id);
          printed += 1;
        } catch (error) {
          failed += 1;
          const reason = error instanceof Error ? error.message : String(error);
          db.prepare(
            "UPDATE PrintQueue SET attempts = attempts + 1, lastError = ?, updatedAt = ? WHERE id = ?"
          ).run(reason, new Date().toISOString(), job.id);
        }
      }

      const remaining = (
        db.prepare("SELECT COUNT(*) as count FROM PrintQueue").get() as { count: number }
      ).count;

      return { printed, failed, remaining };
    } finally {
      db.close();
    }
  }

  private formatOrderBon(
    printer: ThermalPrinter,
    input: {
      printerName: string;
      order: OrderRowForPrint;
      items: BonItem[];
    }
  ) {
    const { printerName, order, items } = input;
    const orderedAt = formatTimeOnly(order.timestamp);

    // Table name dominates the header — it's what kitchen staff scan for at a
    // glance. setTextSize(2,2) is large but leaves the line on a single row.
    printer.alignCenter();
    printer.setTextSize(2, 2);
    printer.println(`${order.tableName || "?"}`);
    printer.setTextNormal();
    printer.newLine();
    printer.println(printerName);
    printer.drawLine();

    printer.alignLeft();
    printer.println(`Bestellung #${order.id}`);
    printer.println(`Kellner: ${order.waiterUsername || "?"}`);
    printer.println(`Zeit: ${orderedAt}`);
    printer.drawLine();

    for (const item of items) {
      // Special-request units print on their own line so the kitchen sees
      // exactly how many of the item are modified. The client encodes each
      // request as "[Nx ]text" joined by "; " (see waiter-web toOrderItems),
      // and `quantity` already includes those units — so the plain (un-noted)
      // count is the total minus the special-request units.
      const requests = parseSpecialRequests(item.specialRequests);
      const specialUnits = requests.reduce((sum, r) => sum + r.qty, 0);
      const plainQty = item.quantity - specialUnits;

      if (plainQty > 0) {
        printer.setTextQuadArea();
        printer.println(`${plainQty}x ${item.menuItemName}`);
        printer.setTextNormal();
      }

      for (const request of requests) {
        printer.setTextQuadArea();
        printer.println(`${request.qty}x ${item.menuItemName}`);
        printer.println(` *${request.text}`);
        printer.setTextNormal();
      }
    }

    printer.drawLine();
    printer.alignCenter();
    printer.println("Ende Bon");
    printer.newLine();
    printer.cut();
  }

  async sendTestPrint(printerId: number): Promise<PrinterTestPrintResponse> {
    const db = this.openActiveEventDb();
    try {
      const printerRow = this.getPrinterRowById(db, printerId);
      if (!printerRow) {
        throw new ApiError(404, "PRINTER_NOT_FOUND", "Printer not found");
      }

      const port = this.getPort(printerRow.connectionDetails);
      const target = `${printerRow.ipAddress}:${port}`;
      const printer = this.createThermalPrinter(target);

      let connected = false;
      try {
        connected = await printer.isPrinterConnected();
      } catch (error) {
        throw this.mapPrinterConnectionError({
          error,
          printerName: printerRow.name,
          target,
        });
      }

      if (!connected) {
        throw new ApiError(
          409,
          "PRINTER_CONNECTION_FAILED",
          `No response from printer '${printerRow.name}' at ${target}.`,
          {
            target,
            hint: "Check IP/port configuration and printer power/network state.",
          }
        );
      }

      const now = new Date().toISOString();
      printer.alignCenter();
      printer.bold(true);
      printer.println("Serva Print Demo");
      printer.bold(false);
      printer.drawLine();

      printer.alignLeft();
      printer.println(`Printer: ${printerRow.name}`);
      printer.println(`Address: ${target}`);
      printer.println(`Time: ${now}`);
      printer.newLine();

      //printer.println("Textgroessen:");
      //printer.setTextNormal();
      //printer.println("Normal");
      //printer.setTextDoubleHeight();
      //printer.println("Double Height");
      //printer.setTextDoubleWidth();
      //printer.println("Double Width");
      //printer.setTextQuadArea();
      //printer.println("Quad Area");
      //printer.setTextSize(1, 1);
      //printer.println("Text 1, 1");
      //printer.setTextSize(2, 2);
      //printer.println("Text 2, 2");
      //printer.setTextSize(3, 3);
      //printer.println("Text 3, 3");
      //printer.setTextNormal();
      //printer.newLine();
//
      //printer.println("Stile:");
      //printer.bold(true);
      //printer.println("Bold");
      //printer.bold(false);
      //printer.underline(true);
      //printer.println("Underline");
      //printer.underline(false);
      //printer.invert(true);
      //printer.println("Invert");
      //printer.invert(false);

      printer.drawLine();
      printer.println("Ende Testdruck");
      printer.newLine();
      printer.cut();

      try {
        await printer.execute();
      } catch (error) {
        throw this.mapPrinterConnectionError({
          error,
          printerName: printerRow.name,
          target,
        });
      }

      return {
        ok: true,
        message: "Test print sent successfully",
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw this.mapPrinterConnectionError({
        error,
        printerName: "unknown",
        target: "unknown",
      });
    } finally {
      db.close();
    }
  }
}

