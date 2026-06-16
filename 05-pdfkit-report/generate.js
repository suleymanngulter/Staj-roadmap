const PDFDocument = require('pdfkit');
const fs = require('fs');
const doc = new PDFDocument();

doc.pipe(fs.createWriteStream(__dirname + '/fatura.pdf')); // dosyaya yaz

doc.fontSize(20).text('MOCK veri', 100, 100);

doc.end();
 