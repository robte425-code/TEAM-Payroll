const path = require("path");
const XLSX = require("xlsx");
const { getRateCodeCategory } = require("./rateCodes");

const REQUIRED_HEADERS = ["Work Done By", "Provider ID", "Rate Code", "Units", "Adj/ Resub"];

function normalizeRow(rawRow = {}) {
  const employeeName = String(rawRow["Work Done By"] || "").trim();
  const providerId = String(rawRow["Provider ID"] || "").trim();
  const rateCode = String(rawRow["Rate Code"] || "").trim().toUpperCase();
  const units = Number(rawRow["Units"] || 0);
  const adjustmentOrResubmission = String(rawRow["Adj/ Resub"] || "").trim();

  return {
    employeeName,
    providerId,
    rateCode,
    rateCodeCategory: getRateCodeCategory(rateCode),
    units: Number.isFinite(units) ? units : 0,
    adjustmentOrResubmission,
    raw: rawRow,
  };
}

function parseInvoiceFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[firstSheetName];

  const allRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
  const headerIndex = allRows.findIndex((row) =>
    REQUIRED_HEADERS.every((header) => row.includes(header))
  );

  if (headerIndex === -1) {
    throw new Error(`Could not find expected header row in ${path.basename(filePath)}.`);
  }

  const headerRow = allRows[headerIndex];
  const rows = XLSX.utils.sheet_to_json(firstSheet, {
    header: headerRow,
    range: headerIndex + 1,
    defval: "",
  });

  const normalizedRows = rows
    .map(normalizeRow)
    .filter((row) => row.employeeName || row.providerId || row.rateCode);

  return {
    sourceFile: path.basename(filePath),
    worksheetName: firstSheetName,
    totalRows: normalizedRows.length,
    rows: normalizedRows,
  };
}

function summarizeByEmployeeAndCategory(normalizedRows = []) {
  const summaryMap = new Map();
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const toActualHours = (category, units) => {
    if (category === "case_work") return units / 10;
    if (category === "travel_wait") return units / 10;
    if (category === "report") return units / 2;
    if (category === "mileage") return units;
    return units;
  };

  for (const row of normalizedRows) {
    const key = `${row.providerId}::${row.employeeName}`;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        employeeName: row.employeeName,
        providerId: row.providerId,
        totals: {
          case_work: 0,
          travel_wait: 0,
          mileage: 0,
          report: 0,
        },
        otherCodes: {},
        rowCount: 0,
      });
    }

    const current = summaryMap.get(key);
    const convertedUnits = toActualHours(row.rateCodeCategory, row.units);
    if (row.rateCodeCategory === "other") {
      const code = row.rateCode || "UNKNOWN";
      current.otherCodes[code] = round2((current.otherCodes[code] || 0) + convertedUnits);
    } else {
      current.totals[row.rateCodeCategory] = round2(
        current.totals[row.rateCodeCategory] + convertedUnits
      );
    }
    current.rowCount += 1;
  }

  return Array.from(summaryMap.values()).sort((a, b) => {
    if (a.employeeName < b.employeeName) return -1;
    if (a.employeeName > b.employeeName) return 1;
    return 0;
  });
}

module.exports = {
  parseInvoiceFile,
  summarizeByEmployeeAndCategory,
};
