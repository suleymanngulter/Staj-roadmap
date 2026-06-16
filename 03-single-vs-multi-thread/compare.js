// SENARYO 3 — ANA GİRİŞ NOKTASI
//
// Single-thread ve multi-thread demolarını arka arkaya çalıştırır.
// İkisini yan yana görmek için bunu kullanın.
//
// Çalıştır: node 03-single-vs-multi-thread/compare.js

const { execFileSync } = require("child_process");
const path = require("path");

const dir = __dirname;

function run(label, file) {
  console.log("\n" + "=".repeat(56));
  console.log(label);
  console.log("=".repeat(56));
  execFileSync("node", [path.join(dir, file)], { stdio: "inherit" });
}

console.log("Senaryo 3: Single vs Multi-Thread karşılaştırması");
console.log("(cpu-task.js yardımcı modüldür; doğrudan çalıştırılmaz)\n");

run("1/2 — SINGLE THREAD", "single-thread.js");
run("2/2 — MULTI THREAD", "multi-thread.js");

console.log("\nÖzet: single-thread'de event loop bloklanır (heartbeat ~0),");
console.log("multi-thread'de iş Worker'lara dağılır (heartbeat devam eder, süre kısalır).");
