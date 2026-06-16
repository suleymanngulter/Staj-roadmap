// Tüm örnekleri sırayla çalıştırır.
// Çalıştır: node run-all.js

const { execFileSync } = require("child_process");
const path = require("path");

// Her bölüm: başlık + çalıştırılacak dosyalar (etiket -> dosya yolu).
const sections = [
  {
    title: "Read-Modify-Write (async lost update)",
    files: [
      ["BOZUK (broken.js)", "01-read-modify-write/broken.js"],
      ["DÜZELTİLMİŞ (fixed.js)", "01-read-modify-write/fixed.js"],
    ],
  },
  {
    title: "Shared Memory / data race (gerçek paralellik)",
    files: [
      ["BOZUK (broken.js)", "02-shared-memory/broken.js"],
      ["DÜZELTİLMİŞ (fixed.js)", "02-shared-memory/fixed.js"],
    ],
  },
];

function run(file) {
  try {
    const out = execFileSync("node", [file], { cwd: __dirname }).toString();
    process.stdout.write(out);
  } catch (e) {
    process.stdout.write((e.stdout || "").toString());
    process.stderr.write((e.stderr || "").toString());
  }
}

for (const { title, files } of sections) {
  console.log("\n========================================================");
  console.log("SENARYO:", title);
  console.log("========================================================");
  for (const [label, file] of files) {
    console.log(`\n--- ${label} ---`);
    run(file);
  }
}

console.log("\nNot: 'broken' örnekler zamanlamaya bağlıdır; bazen tek çalıştırmada");
console.log("yanlış sonuç görünmeyebilir. Birkaç kez çalıştırın.");
