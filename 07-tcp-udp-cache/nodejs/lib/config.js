const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

module.exports = {
  ROOT,
  REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  RABBITMQ_URL: process.env.RABBITMQ_URL || "amqp://guest:guest@127.0.0.1:5672",
  QUEUE_NAME: process.env.QUEUE_NAME || "validated-events",
  TCP_PORT: Number(process.env.TCP_PORT) || 17007,
  UDP_PORT: Number(process.env.UDP_PORT) || 17008,
  COUNT: Number(process.env.COUNT) || 10000,
  REQUESTS: Number(process.env.REQUESTS) || 5000,
  RUNS: Number(process.env.RUNS) || 20,
  CONCURRENCY: Number(process.env.CONCURRENCY) || 100,
  INVALID_RATIO: Number(process.env.INVALID_RATIO) || 0.2,
};
