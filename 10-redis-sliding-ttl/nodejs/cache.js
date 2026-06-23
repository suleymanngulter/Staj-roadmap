const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const TTL_SEC = Number(process.env.TTL_SEC) || 5;

function createRedis() {
  return new Redis(REDIS_URL);
}

async function set(redis, key, value) {
  await redis.set(key, value, "EX", TTL_SEC);
}

// GETEX: okurken TTL'i yeniden başlatır (sliding expiration).
async function get(redis, key) {
  return redis.getex(key, "EX", TTL_SEC);
}

async function ttlMs(redis, key) {
  return redis.pttl(key);
}

module.exports = { REDIS_URL, TTL_SEC, createRedis, set, get, ttlMs };
