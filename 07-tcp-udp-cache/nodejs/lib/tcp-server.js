const net = require("net");

function createTcpServer(port, handler) {
  const server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        let userId;
        try {
          const parsed = JSON.parse(line);
          userId = parsed.userId;
        } catch {
          socket.write("REJECT invalid_json\n");
          continue;
        }

        if (!userId || typeof userId !== "string") {
          socket.write("REJECT missing_user\n");
          continue;
        }

        try {
          const result = await handler.validateAndPublish(userId);
          socket.write(result.ok ? "OK\n" : "REJECT not_in_cache\n");
        } catch {
          socket.write("REJECT error\n");
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

function closeTcpServer(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

module.exports = { createTcpServer, closeTcpServer };
