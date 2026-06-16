
// node 04-libuv-threadpool/measure.js

const { execFileSync } = require("child_process");
const path = require("path");
const os = require("os");

const bench = path.join(__dirname, "bench.js");
const TASKS = 8; // her testte aynı anda 8 ağır iş
const sizes = [1, 2, 4, 8]; // denenecek pool boyutları

const cores = os.cpus().length;
console.log("libuv thread pool etkisi (crypto.pbkdf2)\n");
console.log(`CPU çekirdek sayısı: ${cores}`);
console.log(`Her test: ${TASKS} eşzamanlı pbkdf2 görevi\n`);
console.log("Beklenti: pool büyüdükçe (çekirdek sınırına kadar) süre kısalır.\n");

for (const size of sizes) {
  execFileSync("node", [bench], {
    stdio: "inherit",
    env: {
      ...process.env,
      UV_THREADPOOL_SIZE: String(size),
      TASKS: String(TASKS),
    },
  });
}

console.log(
  `\nNot: ${cores} çekirdekten fazla thread genelde ek fayda getirmez; ` +
    "thread'ler çekirdek için sıraya girer."
);
