const { PDFDocument } = require("pdf-lib");
const pdfParse = require("pdf-parse");

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

async function extractPageTexts(pdfBuffer) {
  const pageTexts = [];
  await pdfParse(pdfBuffer, {
    pagerender(pageData) {
      return pageData.getTextContent().then((textContent) => {
        const text = textContent.items.map((item) => item.str).join(" ");
        pageTexts.push(text);
        return text;
      });
    },
  });
  return pageTexts;
}

async function splitPayStubPdf(pdfBuffer) {
  const [sourceDoc, pageTexts] = await Promise.all([
    PDFDocument.load(pdfBuffer),
    extractPageTexts(pdfBuffer),
  ]);

  const pageCount = sourceDoc.getPageCount();
  const pages = [];

  for (let i = 0; i < pageCount; i += 1) {
    const pageNumber = i + 1;
    const text = pageTexts[i] || "";
    const meta = parsePageMetadata(text);

    const newDoc = await PDFDocument.create();
    const [copied] = await newDoc.copyPages(sourceDoc, [i]);
    newDoc.addPage(copied);
    const pdfBytes = Buffer.from(await newDoc.save());

    pages.push({
      pageNumber,
      pdfBytes,
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
