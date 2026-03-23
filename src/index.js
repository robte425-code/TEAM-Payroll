const path = require("path");
const { parseInvoiceFile, summarizeByEmployeeAndCategory } = require("./parseInvoice");

function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.error("Usage: npm start -- <path-to-invoice-xlsx>");
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const parsed = parseInvoiceFile(absolutePath);
  const summary = summarizeByEmployeeAndCategory(parsed.rows);

  console.log(JSON.stringify(
    {
      sourceFile: parsed.sourceFile,
      worksheetName: parsed.worksheetName,
      totalRows: parsed.totalRows,
      employees: summary,
    },
    null,
    2
  ));
}

main();
