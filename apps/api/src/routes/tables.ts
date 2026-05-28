import {
  ApiErrorEnvelopeSchema,
  TableBulkCreateRequest,
  TableBulkCreateRequestSchema,
  TableBulkCreateResponseSchema,
  TableCreateRequest,
  TableCreateRequestSchema,
  TableCreateResponseSchema,
  TableParams,
  TableParamsSchema,
  TablesQuery,
  TablesQuerySchema,
  TablesResponseSchema,
  TableUpdateRequest,
  TableUpdateRequestSchema,
  TableUpdateResponseSchema,
} from "@serva/shared-types";
import type { FastifyInstance } from "fastify";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { z } from "zod";
import { tableStore } from "../domain/state";

const TableQrSvgResponseSchema = z.string().meta({
  description: "SVG image containing the QR code for a table.",
});

const TablesQrPdfResponseSchema = z.string().meta({
  description: "PDF document containing QR codes for all tables of the active event.",
});

const TablesQrPdfQuerySchema = z
  .object({
    layout: z
      .enum(["single", "double"])
      .optional()
      .describe("PDF layout: single = 1 Tisch pro Seite, double = 2 Tische pro Seite"),
  })
  .strict();

type TablesQrPdfQuery = z.infer<typeof TablesQrPdfQuerySchema>;

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
}) {
  const { pdfDoc, page, nameFont, bodyFont, table, slotX, slotY, slotWidth, slotHeight } = input;
  const title = table.name;
  const titleSize = fitTextSize({
    text: title,
    font: nameFont,
    maxWidth: slotWidth - 56,
    minSize: 34,
    maxSize: 76,
  });
  const titleTopPadding = 28;
  const metaGap = 10;
  const infoTextSize = 13;
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

  const infoText = `Tisch ${table.name}  |  ID ${table.id}  |  Serva QR`;
  const infoWidth = bodyFont.widthOfTextAtSize(infoText, infoTextSize);
  page.drawText(infoText, {
    x: slotX + (slotWidth - infoWidth) / 2,
    y: titleY - metaGap - infoTextSize,
    size: infoTextSize,
    font: bodyFont,
    color: rgb(0.32, 0.32, 0.32),
  });

  const qrPayload = JSON.stringify({ tableId: table.id, tableName: table.name });
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: 1200,
  });
  const qrBase64 = qrDataUrl.slice(qrDataUrl.indexOf(",") + 1);
  const qrImage = await pdfDoc.embedPng(Buffer.from(qrBase64, "base64"));

  const qrAreaTopY = titleY - metaGap - infoTextSize - 24;
  const qrAreaBottomY = slotY + 24;
  const availableQrHeight = Math.max(120, qrAreaTopY - qrAreaBottomY);
  const maxQrSize = Math.min(availableQrHeight, slotWidth - 96, 340);
  const qrSize = Math.max(150, maxQrSize);
  const qrX = slotX + (slotWidth - qrSize) / 2;
  const qrY = qrAreaBottomY + Math.max(0, (availableQrHeight - qrSize) / 2);

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
  options: { layout?: "single" | "double" }
) {
  const pdfDoc = await PDFDocument.create();
  const nameFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pageSize: [number, number] = [595.28, 841.89];
  const layout = options.layout ?? "double";
  const pagePadding = 18;

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
      });
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
    });

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
      });
    }
  }

  return Buffer.from(await pdfDoc.save());
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

  app.get<{ Querystring: TablesQrPdfQuery }>(
    "/tables/qr.pdf",
    {
      config: {
        requiresRole: "admin",
        requiresActiveEvent: true,
      },
      schema: {
        tags: ["tables"],
        operationId: "tablesQrExportPdf",
        summary: "QR-PDF fuer alle Tische exportieren",
        description:
          "Erzeugt eine PDF fuer alle Tische des aktiven Events. Standardlayout: zwei QR-Codes pro Seite mit Trennlinie.",
        security: [{ bearerAuth: [] }],
        querystring: TablesQrPdfQuerySchema,
        response: {
          200: TablesQrPdfResponseSchema,
          401: ApiErrorEnvelopeSchema,
          403: ApiErrorEnvelopeSchema,
          409: ApiErrorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const tables = tableStore.listTables({});
      const pdf = await buildTablesQrPdf(
        tables.map((table) => ({ id: table.id, name: table.name })),
        {
          layout: request.query.layout,
        }
      );
      return reply
        .header("Content-Disposition", "attachment; filename=tables-qr.pdf")
        .type("application/pdf")
        .send(pdf);
    }
  );
}

