import {
  ApiErrorEnvelopeSchema,
  QrPdfBranding,
  TableBulkCreateRequest,
  TableBulkCreateRequestSchema,
  TableBulkCreateResponseSchema,
  TableCreateRequest,
  TableCreateRequestSchema,
  TableCreateResponseSchema,
  TableParams,
  TableParamsSchema,
  TablesQrPdfProgressEvent,
  TablesQrPdfRequest,
  TablesQrPdfRequestSchema,
  TablesQuery,
  TablesQuerySchema,
  TablesResponseSchema,
  TableUpdateRequest,
  TableUpdateRequestSchema,
  TableUpdateResponseSchema,
} from "@bstoema/shared-types";
import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { PDFDocument, PDFImage, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { z } from "zod";
import { BSTOEMA_LOGO_PNG_BASE64, BSTOEMA_WEBSITE_URL } from "../assets/bstoema-logo";
import { tableStore } from "../domain/state";

const TableQrSvgResponseSchema = z.string().meta({
  description: "SVG image containing the QR code for a table.",
});

const TablesQrPdfResponseSchema = z.string().meta({
  description: "PDF document containing QR codes for all tables of the active event.",
});

/** Resolved, ready-to-draw branding block (logo already embedded in the doc). */
interface ResolvedBranding {
  label?: string;
  logo?: PDFImage;
}

/** Embeds the requested branding assets into the PDF once, up front. Returns
 *  `undefined` when no branding should be drawn. A logo that fails to embed is
 *  skipped so a broken upload never blocks the whole export. */
async function resolveBranding(
  pdfDoc: PDFDocument,
  branding: QrPdfBranding | undefined
): Promise<ResolvedBranding | undefined> {
  if (!branding || branding.mode === "none") {
    return undefined;
  }

  if (branding.mode === "bstoema") {
    const logo = await pdfDoc
      .embedPng(Buffer.from(BSTOEMA_LOGO_PNG_BASE64, "base64"))
      .catch(() => undefined);
    return { label: BSTOEMA_WEBSITE_URL, logo };
  }

  // custom
  let logo: PDFImage | undefined;
  if (branding.customLogo) {
    const commaIndex = branding.customLogo.indexOf(",");
    const header = branding.customLogo.slice(0, commaIndex);
    const bytes = Buffer.from(branding.customLogo.slice(commaIndex + 1), "base64");
    logo = await (header.includes("image/png")
      ? pdfDoc.embedPng(bytes)
      : pdfDoc.embedJpg(bytes)
    ).catch(() => undefined);
  }
  const label = branding.customLabel?.trim() || undefined;
  return label || logo ? { label, logo } : undefined;
}

function buildTableQrSvg(input: { id: number; name: string }) {
  const payload = JSON.stringify({ tableId: input.id, tableName: input.name });
  return QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 2,
    width: 320,
  });
}

function fitTextSize(input: {
  text: string;
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  maxWidth: number;
  minSize: number;
  maxSize: number;
}) {
  const { text, font, maxWidth, minSize, maxSize } = input;
  for (let size = maxSize; size >= minSize; size -= 1) {
    if (font.widthOfTextAtSize(text, size) <= maxWidth) {
      return size;
    }
  }
  return minSize;
}

function drawCutLine(input: {
  page: ReturnType<PDFDocument["addPage"]>;
  y: number;
  fromX: number;
  toX: number;
}) {
  const { page, y, fromX, toX } = input;
  const segment = 10;
  const gap = 5;
  let cursor = fromX;
  while (cursor < toX) {
    const end = Math.min(cursor + segment, toX);
    page.drawLine({
      start: { x: cursor, y },
      end: { x: end, y },
      thickness: 1,
      color: rgb(0.74, 0.74, 0.74),
    });
    cursor = end + gap;
  }
}

/** Draws the branding block (logo + label) as large as the given box allows,
 *  centred inside it.
 *
 *  - `stack` puts the label under the logo — used for the narrow column beside
 *    the QR code in the two-per-page layout.
 *  - `row` puts the label next to the logo — used for the wide banner at the
 *    bottom of a one-per-page sheet. */
function drawBrandingBlock(input: {
  page: ReturnType<PDFDocument["addPage"]>;
  bodyFont: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  branding: ResolvedBranding;
  x: number;
  y: number;
  width: number;
  height: number;
  orientation: "stack" | "row";
}) {
  const { page, bodyFont, branding, x, y, width, height, orientation } = input;
  const { label, logo } = branding;
  const labelColor = rgb(0.24, 0.24, 0.24);
  const gap = orientation === "stack" ? 16 : 24;
  const maxLabelSize = orientation === "stack" ? 24 : 34;

  if (orientation === "stack") {
    const labelSize = label
      ? fitTextSize({ text: label, font: bodyFont, maxWidth: width, minSize: 12, maxSize: maxLabelSize })
      : 0;
    const labelBand = label ? labelSize + gap : 0;
    let logoWidth = 0;
    let logoHeight = 0;
    if (logo) {
      const scale = Math.min(width / logo.width, (height - labelBand) / logo.height);
      logoWidth = logo.width * scale;
      logoHeight = logo.height * scale;
    }

    const blockHeight = logoHeight + labelBand;
    let cursorY = y + (height - blockHeight) / 2;
    if (label) {
      const labelWidth = bodyFont.widthOfTextAtSize(label, labelSize);
      page.drawText(label, {
        x: x + (width - labelWidth) / 2,
        y: cursorY,
        size: labelSize,
        font: bodyFont,
        color: labelColor,
      });
      cursorY += labelBand;
    }
    if (logo) {
      page.drawImage(logo, {
        x: x + (width - logoWidth) / 2,
        y: cursorY,
        width: logoWidth,
        height: logoHeight,
      });
    }
    return;
  }

  // row: the label sits to the right of the logo, both vertically centred.
  const labelBudget = logo ? width * 0.55 : width;
  const labelSize = label
    ? fitTextSize({ text: label, font: bodyFont, maxWidth: labelBudget, minSize: 12, maxSize: maxLabelSize })
    : 0;
  const labelWidth = label ? bodyFont.widthOfTextAtSize(label, labelSize) : 0;
  const logoBudget = width - labelWidth - (label && logo ? gap : 0);
  let logoWidth = 0;
  let logoHeight = 0;
  if (logo) {
    const scale = Math.min(logoBudget / logo.width, height / logo.height);
    logoWidth = logo.width * scale;
    logoHeight = logo.height * scale;
  }

  const blockWidth = logoWidth + labelWidth + (label && logo ? gap : 0);
  let cursorX = x + (width - blockWidth) / 2;
  if (logo) {
    page.drawImage(logo, {
      x: cursorX,
      y: y + (height - logoHeight) / 2,
      width: logoWidth,
      height: logoHeight,
    });
    cursorX += logoWidth + (label ? gap : 0);
  }
  if (label) {
    page.drawText(label, {
      x: cursorX,
      // Rough optical centring: Helvetica's cap height is ~0.72 em.
      y: y + height / 2 - labelSize * 0.36,
      size: labelSize,
      font: bodyFont,
      color: labelColor,
    });
  }
}

async function renderTableSlot(input: {
  pdfDoc: PDFDocument;
  page: ReturnType<PDFDocument["addPage"]>;
  nameFont: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  bodyFont: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  table: { id: number; name: string };
  slotX: number;
  slotY: number;
  slotWidth: number;
  slotHeight: number;
  branding?: ResolvedBranding;
  /** Where the branding block goes: `side` = left of the QR code (two per
   *  page), `bottom` = a wide banner under the QR code (one per page). */
  brandingPlacement?: "side" | "bottom";
}) {
  const {
    pdfDoc,
    page,
    nameFont,
    bodyFont,
    table,
    slotX,
    slotY,
    slotWidth,
    slotHeight,
    branding,
    brandingPlacement = "side",
  } = input;
  const title = table.name;
  const titleSize = fitTextSize({
    text: title,
    font: nameFont,
    maxWidth: slotWidth - 56,
    minSize: 34,
    maxSize: 76,
  });
  const titleTopPadding = 28;
  const qrFramePadding = 10;

  page.drawRectangle({
    x: slotX,
    y: slotY,
    width: slotWidth,
    height: slotHeight,
    borderWidth: 1,
    borderColor: rgb(0.84, 0.84, 0.84),
  });

  const titleWidth = nameFont.widthOfTextAtSize(title, titleSize);
  const titleY = slotY + slotHeight - titleTopPadding - titleSize;
  page.drawText(title, {
    x: slotX + (slotWidth - titleWidth) / 2,
    y: titleY,
    size: titleSize,
    font: nameFont,
    color: rgb(0.08, 0.08, 0.08),
  });

  const qrPayload = JSON.stringify({ tableId: table.id, tableName: table.name });
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 1200,
  });
  const qrBase64 = qrDataUrl.slice(qrDataUrl.indexOf(",") + 1);
  const qrImage = await pdfDoc.embedPng(Buffer.from(qrBase64, "base64"));

  // Everything below the title is shared between the QR code and the optional
  // branding block; how it is divided depends on the placement.
  const contentPadding = 26;
  const contentX = slotX + contentPadding;
  const contentWidth = slotWidth - contentPadding * 2;
  const contentTopY = titleY - 22;
  const contentBottomY = slotY + 22;
  const contentHeight = Math.max(140, contentTopY - contentBottomY);

  let qrSize: number;
  let qrX: number;
  let qrY: number;

  if (branding && brandingPlacement === "side") {
    // Branding column on the left, QR code on the right.
    const columnGap = 26;
    const brandingWidth = Math.min(contentWidth * 0.4, 240);
    const qrLaneWidth = contentWidth - brandingWidth - columnGap;
    qrSize = Math.max(150, Math.min(contentHeight, qrLaneWidth, 360));
    qrX = contentX + brandingWidth + columnGap + Math.max(0, (qrLaneWidth - qrSize) / 2);
    qrY = contentBottomY + Math.max(0, (contentHeight - qrSize) / 2);
    drawBrandingBlock({
      page,
      bodyFont,
      branding,
      x: contentX,
      y: contentBottomY,
      width: brandingWidth,
      // Keep the block from outgrowing the QR code it advertises next to.
      height: Math.min(contentHeight, qrSize),
      orientation: "stack",
    });
  } else if (branding) {
    // Wide branding banner under the QR code.
    const bannerGap = 28;
    const bannerHeight = Math.min(150, Math.max(70, contentHeight * 0.22));
    const qrLaneHeight = contentHeight - bannerHeight - bannerGap;
    qrSize = Math.max(150, Math.min(qrLaneHeight, contentWidth, 430));
    qrX = contentX + (contentWidth - qrSize) / 2;
    qrY = contentBottomY + bannerHeight + bannerGap + Math.max(0, (qrLaneHeight - qrSize) / 2);
    drawBrandingBlock({
      page,
      bodyFont,
      branding,
      x: contentX,
      y: contentBottomY,
      width: contentWidth,
      height: bannerHeight,
      orientation: "row",
    });
  } else {
    qrSize = Math.max(150, Math.min(contentHeight, contentWidth, 430));
    qrX = contentX + (contentWidth - qrSize) / 2;
    qrY = contentBottomY + Math.max(0, (contentHeight - qrSize) / 2);
  }

  page.drawRectangle({
    x: qrX - qrFramePadding,
    y: qrY - qrFramePadding,
    width: qrSize + qrFramePadding * 2,
    height: qrSize + qrFramePadding * 2,
    borderWidth: 1,
    borderColor: rgb(0.82, 0.82, 0.82),
  });
  page.drawImage(qrImage, {
    x: qrX,
    y: qrY,
    width: qrSize,
    height: qrSize,
  });
}

async function buildTablesQrPdf(
  tables: Array<{ id: number; name: string }>,
  options: {
    layout?: "single" | "double";
    branding?: QrPdfBranding;
    /** Invoked once with (0, total) before rendering, then after each table
     *  finishes. Awaited so a streaming caller can flush progress to the wire. */
    onProgress?: (done: number, total: number) => void | Promise<void>;
  }
) {
  const pdfDoc = await PDFDocument.create();
  const nameFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const branding = await resolveBranding(pdfDoc, options.branding);
  // Both layouts are A4 portrait: single stacks Tischname + QR on top and the
  // branding banner at the bottom, double splits the sheet along a cut line.
  const pageSize: [number, number] = [595.28, 841.89];
  const layout = options.layout ?? "double";
  const pagePadding = 18;

  const total = tables.length;
  let done = 0;
  await options.onProgress?.(done, total);
  const reportTableDone = async () => {
    done += 1;
    await options.onProgress?.(done, total);
  };

  if (tables.length === 0) {
    const page = pdfDoc.addPage(pageSize);
    page.drawText("No tables available", {
      x: 200,
      y: 420,
      size: 24,
      font: nameFont,
      color: rgb(0.2, 0.2, 0.2),
    });
    return Buffer.from(await pdfDoc.save());
  }

  if (layout === "single") {
    for (const table of tables) {
      const page = pdfDoc.addPage(pageSize);
      await renderTableSlot({
        pdfDoc,
        page,
        nameFont,
        bodyFont,
        table,
        slotX: pagePadding,
        slotY: pagePadding,
        slotWidth: page.getWidth() - pagePadding * 2,
        slotHeight: page.getHeight() - pagePadding * 2,
        branding,
        brandingPlacement: "bottom",
      });
      await reportTableDone();
    }

    return Buffer.from(await pdfDoc.save());
  }

  for (let index = 0; index < tables.length; index += 2) {
    const page = pdfDoc.addPage(pageSize);
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const dividerY = pageHeight / 2;
    const slotHeight = pageHeight / 2 - pagePadding - 6;
    const slotWidth = pageWidth - pagePadding * 2;

    drawCutLine({
      page,
      y: dividerY,
      fromX: pagePadding,
      toX: pageWidth - pagePadding,
    });

    const cutHint = "Schnittlinie";
    const cutHintSize = 10;
    const cutHintWidth = bodyFont.widthOfTextAtSize(cutHint, cutHintSize);
    page.drawText(cutHint, {
      x: (pageWidth - cutHintWidth) / 2,
      y: dividerY + 3,
      size: cutHintSize,
      font: bodyFont,
      color: rgb(0.5, 0.5, 0.5),
    });

    await renderTableSlot({
      pdfDoc,
      page,
      nameFont,
      bodyFont,
      table: tables[index],
      slotX: pagePadding,
      slotY: dividerY + 6,
      slotWidth,
      slotHeight,
      branding,
    });
    await reportTableDone();

    if (tables[index + 1]) {
      await renderTableSlot({
        pdfDoc,
        page,
        nameFont,
        bodyFont,
        table: tables[index + 1],
        slotX: pagePadding,
        slotY: pagePadding,
        slotWidth,
        slotHeight,
        branding,
      });
      await reportTableDone();
    }
  }

  return Buffer.from(await pdfDoc.save());
}

/** Resolves the export payload's `tableIds` against the active event's tables.
 *  `undefined` means "all tables"; otherwise only the requested IDs are kept,
 *  preserving the store's ordering. */
function selectExportTables(tableIds: number[] | undefined) {
  const tables = tableStore.listTables({});
  const selected =
    tableIds === undefined
      ? tables
      : (() => {
          const wanted = new Set(tableIds);
          return tables.filter((table) => wanted.has(table.id));
        })();
  return selected.map((table) => ({ id: table.id, name: table.name }));
}

export function registerTableRoutes(app: FastifyInstance) {
  app.get<{ Querystring: TablesQuery }>(
    "/tables",
    {
      config: {
        allowedRoles: ["waiter", "admin"],
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["tables"],
        operationId: "tablesList",
        summary: "Tische auflisten",
        description:
          "Liefert Tische des aktiven Events. Query-Beispiele: /tables?locked=false und /tables?sort=weight,name",
        security: [{ bearerAuth: [] }],
        querystring: TablesQuerySchema,
        response: {
          200: TablesResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      return {
        tables: tableStore.listTables({
          locked: request.query.locked,
        }),
      };
    }
  );

  app.post<{ Body: TableCreateRequest }>(
    "/tables",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["tables"],
        operationId: "tablesCreate",
        summary: "Tisch erstellen",
        description: "Erstellt einen einzelnen Tisch. Beispiel-Body: { name: 'A1', weight: 1 }",
        security: [{ bearerAuth: [] }],
        body: TableCreateRequestSchema,
        response: {
          201: TableCreateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = tableStore.createTable(request.body);
      return reply.status(201).send(created);
    }
  );

  app.post<{ Body: TableBulkCreateRequest }>(
    "/tables/bulk",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["tables"],
        operationId: "tablesBulkCreate",
        summary: "Tischbereich im Bulk erstellen",
        description:
          "Erstellt mehrere Tische aus Zeilen- und Zahlenbereich. Beispiel-Body: { rows: ['A','B'], from: 1, to: 5 }",
        security: [{ bearerAuth: [] }],
        body: TableBulkCreateRequestSchema,
        response: {
          201: TableBulkCreateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const created = tableStore.createTablesBulk(request.body);
      return reply.status(201).send({ tables: created });
    }
  );

  app.patch<{ Params: TableParams; Body: TableUpdateRequest }>(
    "/tables/:tableId",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["tables"],
        operationId: "tablesUpdate",
        summary: "Tisch aktualisieren",
        description: "Aktualisiert einzelne Tischfelder wie Name, Gewicht oder Lock-Status.",
        security: [{ bearerAuth: [] }],
        params: TableParamsSchema,
        body: TableUpdateRequestSchema,
        response: {
          200: TableUpdateResponseSchema,
          400: ApiErrorEnvelopeSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      return tableStore.updateTable(request.params.tableId, request.body);
    }
  );

  app.get<{ Params: TableParams }>(
    "/tables/:tableId/qr",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["tables"],
        operationId: "tablesQrGetSvg",
        summary: "Tisch-QR als SVG abrufen",
        description: "Liefert den QR-Code eines Tisches als SVG-Bild.",
        security: [{ bearerAuth: [] }],
        params: TableParamsSchema,
        response: {
          200: TableQrSvgResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const table = tableStore.getTable(request.params.tableId);
      const svg = await buildTableQrSvg({ id: table.id, name: table.name });
      return reply.type("image/svg+xml").send(svg);
    }
  );

  app.get<{ Params: TableParams }>(
    "/tables/:tableId/qr.pdf",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["tables"],
        operationId: "tablesQrExportPdfSingle",
        summary: "QR-PDF fuer einen einzelnen Tisch exportieren",
        description: "Erzeugt eine PDF mit dem QR-Code eines einzelnen Tisches.",
        security: [{ bearerAuth: [] }],
        params: TableParamsSchema,
        response: {
          200: TablesQrPdfResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          404: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const table = tableStore.getTable(request.params.tableId);
      const pdf = await buildTablesQrPdf([{ id: table.id, name: table.name }], {
        layout: "single",
      });
      return reply
        .header("Content-Disposition", `attachment; filename=table-${table.id}-qr.pdf`)
        .type("application/pdf")
        .send(pdf);
    }
  );

  app.post<{ Body: TablesQrPdfRequest }>(
    "/tables/qr.pdf",
    {
      // Custom-logo data URLs can be sizeable; lift the 1 MB default.
      bodyLimit: 8 * 1024 * 1024,
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["tables"],
        operationId: "tablesQrExportPdf",
        summary: "QR-PDF fuer alle Tische exportieren",
        description:
          "Erzeugt eine PDF (A4 Hochformat) fuer die gewaehlten Tische des aktiven Events. Standardlayout: zwei QR-Codes pro Seite mit Trennlinie, Branding links neben dem QR-Code. Layout `single`: ein QR-Code pro Seite mit Branding-Banner am Seitenende. Branding optional (BstöMa- oder eigenes Logo).",
        security: [{ bearerAuth: [] }],
        body: TablesQrPdfRequestSchema,
        response: {
          200: TablesQrPdfResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
          422: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const selected = selectExportTables(request.body.tableIds);
      const pdf = await buildTablesQrPdf(selected, {
        layout: request.body.layout,
        branding: request.body.branding,
      });
      return reply
        .header("Content-Disposition", "attachment; filename=tables-qr.pdf")
        .type("application/pdf")
        .send(pdf);
    }
  );

  app.post<{ Body: TablesQrPdfRequest }>(
    "/tables/qr.pdf/stream",
    {
      bodyLimit: 8 * 1024 * 1024,
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["tables"],
        operationId: "tablesQrExportPdfStream",
        summary: "QR-PDF exportieren mit Fortschritt (NDJSON-Stream)",
        description:
          "Wie POST /tables/qr.pdf, streamt aber den Fortschritt als NDJSON: ein `progress`-Event pro Tisch, abschliessend ein `done`-Event mit der Base64-PDF (oder ein `error`-Event). Ermoeglicht Fortschrittsanzeige und Restzeit-Schaetzung im Client.",
        security: [{ bearerAuth: [] }],
        body: TablesQrPdfRequestSchema,
      },
    },
    async (request, reply) => {
      const selected = selectExportTables(request.body.tableIds);

      // Stream through Fastify's normal lifecycle (a PassThrough handed to
      // reply.send) rather than reply.hijack(). Hijacking skips the global
      // onSend hook that injects CORS headers, so the cross-origin desktop app
      // would reject the response with "Failed to fetch".
      const stream = new PassThrough();
      reply.header("Cache-Control", "no-store");
      reply.type("application/x-ndjson");
      reply.send(stream);

      const write = (event: TablesQrPdfProgressEvent) => {
        stream.write(`${JSON.stringify(event)}\n`);
      };

      try {
        const pdf = await buildTablesQrPdf(selected, {
          layout: request.body.layout,
          branding: request.body.branding,
          onProgress: async (done, total) => {
            write({ type: "progress", done, total });
            // Yield to the event loop so the write reaches the socket before the
            // next (CPU-bound) table render — otherwise progress arrives in one
            // burst at the end and the bar never moves.
            await new Promise((resolve) => setImmediate(resolve));
          },
        });
        write({ type: "done", pdfBase64: pdf.toString("base64") });
      } catch (err) {
        write({
          type: "error",
          code: "QR_EXPORT_FAILED",
          message: err instanceof Error ? err.message : "QR-Export fehlgeschlagen.",
        });
      } finally {
        stream.end();
      }
    }
  );
}

