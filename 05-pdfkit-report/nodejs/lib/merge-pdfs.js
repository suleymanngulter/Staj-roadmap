const { PDFDocument } = require("pdf-lib");

async function mergePdfs(buffers) {
  const merged = await PDFDocument.create();

  for (const buf of buffers) {
    const doc = await PDFDocument.load(buf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  return Buffer.from(await merged.save());
}

module.exports = { mergePdfs };