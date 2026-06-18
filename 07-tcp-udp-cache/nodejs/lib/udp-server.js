const dgram = require("dgram");

function createUdpServer(port, handler) {
  const server = dgram.createSocket("udp4");

  server.on("message", async (msg, rinfo) => {
    let userId;
    try {
      const parsed = JSON.parse(msg.toString("utf8"));
      userId = parsed.userId;
    } catch {
      server.send("REJECT invalid_json", rinfo.port, rinfo.address);
      return;
    }

    if (!userId || typeof userId !== "string") {
      server.send("REJECT missing_user", rinfo.port, rinfo.address);
      return;
    }

    try {
      const result = await handler.validateAndPublish(userId);
      const reply = result.ok ? "OK" : "REJECT not_in_cache";
      server.send(reply, rinfo.port, rinfo.address);
    } catch {
      server.send("REJECT error", rinfo.port, rinfo.address);
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.bind(port, "127.0.0.1", () => resolve(server));
  });
}

function closeUdpServer(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

module.exports = { createUdpServer, closeUdpServer };
