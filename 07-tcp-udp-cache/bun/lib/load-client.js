const net = require("net");
const dgram = require("dgram");
const { TCP_PORT, UDP_PORT } = require("./config");

function tcpRequest(userId, port = TCP_PORT) {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(`${JSON.stringify({ userId })}\n`);
    });

    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.includes("\n")) {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const line = data.trim();
        socket.end();
        resolve({ ms, ok: line === "OK", response: line });
      }
    });

    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

function udpRequest(userId, port = UDP_PORT) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket("udp4");
    const start = process.hrtime.bigint();
    const payload = Buffer.from(JSON.stringify({ userId }));

    client.on("message", (msg) => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const line = msg.toString("utf8");
      client.close();
      resolve({ ms, ok: line === "OK", response: line });
    });

    client.on("error", (err) => {
      client.close();
      reject(err);
    });

    client.send(payload, port, "127.0.0.1", (err) => {
      if (err) reject(err);
    });
  });
}

async function runPool(requests, fn, concurrency) {
  const results = new Array(requests.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= requests.length) break;
      results[i] = await fn(requests[i]);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

function summarize(results) {
  const latencies = results.map((r) => r.ms);
  const accepted = results.filter((r) => r.ok).length;
  const rejected = results.length - accepted;
  const totalMs = latencies.reduce((sum, v) => sum + v, 0);
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

  return {
    count: results.length,
    accepted,
    rejected,
    avgMs: totalMs / results.length,
    p50Ms: p50,
    p99Ms: p99,
    totalMs,
  };
}

module.exports = {
  tcpRequest,
  udpRequest,
  runPool,
  summarize,
};
