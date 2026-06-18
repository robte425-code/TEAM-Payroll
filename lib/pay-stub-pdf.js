const { PDFDocument } = require("pdf-lib");

let pdfjsModulePromise = null;

function loadPdfJs() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsModulePromise;
}

function parseUsDate(value) {
  const m = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function parsePageMetadata(text) {
  const joined = String(text || "").replace(/\s+/g, " ").trim();

  let extractedName = "";
  let payrollReliefEmpNo = "";
  let checkDate = null;
  let payPeriodStart = null;
  let payPeriodEnd = null;

  const ppMatch = joined.match(
    /P\/P:\s*(\d{2}\/\d{2}\/\d{4})-(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(\d+)\s+\d{2}\/\d{2}\/\d{4}/i
  );
  if (ppMatch) {
    payPeriodStart = parseUsDate(ppMatch[1]);
    payPeriodEnd = parseUsDate(ppMatch[2]);
    extractedName = ppMatch[3].trim();
    payrollReliefEmpNo = ppMatch[4];
  }

  if (!extractedName) {
    const payToMatch = joined.match(
      /PAY TO THE ORDER OF\s+\$[\d,]+\.?\d*\s+.+?\s+(.+?)\s+NON-NEGOTIABLE/i
    );
    if (payToMatch) extractedName = payToMatch[1].trim();
  }

  const checkDateMatch = joined.match(/Check Date\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (checkDateMatch) checkDate = parseUsDate(checkDateMatch[1]);

  return {
    extractedName,
    payrollReliefEmpNo,
    checkDate,
    payPeriodStart,
    payPeriodEnd,
  };
}

async function extractPageText(pdfBytes, pageNumber) {
  const pdfjs = await loadPdfJs();
  const bytes =
    pdfBytes instanceof Uint8Array && !Buffer.isBuffer(pdfBytes)
      ? pdfBytes
      : new Uint8Array(pdfBytes);
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((it) => it.str).join(" ");
}

async function splitPayStubPdf(pdfBuffer) {
  const sourceDoc = await PDFDocument.load(pdfBuffer);
  const pageCount = sourceDoc.getPageCount();
  const pages = [];

  for (let i = 0; i < pageCount; i += 1) {
    const pageNumber = i + 1;
    const text = await extractPageText(pdfBuffer, pageNumber);
    const meta = parsePageMetadata(text);

    const newDoc = await PDFDocument.create();
    const [copied] = await newDoc.copyPages(sourceDoc, [i]);
    newDoc.addPage(copied);
    const pdfBytes = await newDoc.save();

    pages.push({
      pageNumber,
      pdfBytes: Buffer.from(pdfBytes),
      ...meta,
    });
  }

  const firstWithDates = pages.find((p) => p.checkDate) || pages[0] || {};
  return {
    pageCount,
    checkDate: firstWithDates.checkDate || null,
    payPeriodStart: firstWithDates.payPeriodStart || null,
    payPeriodEnd: firstWithDates.payPeriodEnd || null,
    pages,
  };
}

module.exports = {
  splitPayStubPdf,
  parsePageMetadata,
};
