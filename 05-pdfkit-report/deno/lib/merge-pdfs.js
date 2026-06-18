import { PDFDocument } from "pdf-lib";
import { Buffer } from "node:buffer";

export async function mergePdfs(buffers) {
  const merged = await PDFDocument.create();

  for (const buf of buffers) {
    const doc = await PDFDocument.load(buf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  return Buffer.from(await merged.save());
}
