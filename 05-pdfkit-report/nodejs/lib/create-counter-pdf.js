const PDFDocument = require("pdfkit");
const { getLoremChunks } = require("./lorem");

const TABLE_ROWS = 18;
const COL_WIDTHS = [40, 200, 60, 80, 80];
const COL_X = [50, 90, 290, 350, 430];

function drawTable(doc, n) {
  const headers = ["#", "Açıklama", "Adet", "Birim", "Toplam"];
  let y = doc.y + 10;

  doc.fontSize(10).font("Helvetica-Bold");
  headers.forEach((h, i) => doc.text(h, COL_X[i], y, { width: COL_WIDTHS[i] }));
  y += 18;
  doc.moveTo(50, y).lineTo(545, y).stroke();
  y += 8;

  doc.font("Helvetica");
  for (let row = 1; row <= TABLE_ROWS; row++) {
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    const lineNo = n * 100 + row;
    const values = [
      String(row),
      `Kalem ${lineNo} — lorem ürün tanımı`,
      String((n + row) % 9 + 1),
      `${(n * row * 3) % 500 + 50} TL`,
      `${((n + row) * 127) % 9000 + 100} TL`,
    ];
    values.forEach((val, i) => doc.text(val, COL_X[i], y, { width: COL_WIDTHS[i] }));
    y += 16;
  }
  doc.y = y + 10;
}

function drawBarChart(doc, n) {
  const baseY = 400;
  const baseX = 80;
  const barWidth = 36;
  const gap = 14;
  const colors = ["#2563eb", "#16a34a", "#dc2626", "#ca8a04", "#9333ea", "#0891b2"];

  doc.fontSize(12).font("Helvetica-Bold").text("Aylık özet grafik", 50, doc.y + 10);
  doc.font("Helvetica");

  for (let i = 0; i < 8; i++) {
    const height = ((n * 17 + i * 43) % 220) + 40;
    const x = baseX + i * (barWidth + gap);
    const color = colors[(n + i) % colors.length];

    doc.save();
    doc.rect(x, baseY - height, barWidth, height).fill(color);
    doc.fillColor("#111").fontSize(9).text(`Q${i + 1}`, x, baseY + 6, {
      width: barWidth,
      align: "center",
    });
    doc.restore();
  }

  doc.moveTo(60, baseY).lineTo(520, baseY).stroke();
  doc.y = baseY + 30;
}

function createCounterPdf(n) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const lorem = getLoremChunks(n);

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Sayfa 1 — başlık + lorem + tablo
    doc.fontSize(28).font("Helvetica-Bold").text(`${n}. pdf`, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).font("Helvetica");
    doc.text(lorem[0], { align: "justify" });
    doc.moveDown();
    doc.text(lorem[1], { align: "justify" });
    doc.moveDown();

    doc.fontSize(14).font("Helvetica-Bold").text("Kalem Tablosu");
    drawTable(doc, n);

    // Sayfa 2 — grafik + lorem
    doc.addPage();
    doc.fontSize(22).font("Helvetica-Bold").text(`${n}. pdf — Grafik`, { align: "center" });
    doc.moveDown();
    drawBarChart(doc, n);
    doc.fontSize(11).font("Helvetica").text(lorem[2], { align: "justify" });
    doc.moveDown();
    doc.text(lorem[3], { align: "justify" });

    // Sayfa 3 — ek lorem (her belge farklı içerik)
    doc.addPage();
    doc.fontSize(22).font("Helvetica-Bold").text(`${n}. pdf — Ekler`, { align: "center" });
    doc.moveDown();
    doc.fontSize(11).font("Helvetica");
    for (let i = 4; i < lorem.length; i++) {
      doc.text(lorem[i], { align: "justify" });
      doc.moveDown();
    }

    doc.end();
  });
}

module.exports = { createCounterPdf };
