const Redis = require("ioredis");
const Memcached = require("memcached");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const MEMCACHED_URL = process.env.MEMCACHED_URL || "127.0.0.1:11211";
const TTL_SEC = Number(process.env.TTL_SEC) || 300;

function createRedis() {
  return new Redis(REDIS_URL);
}

function createMemcached() {
  return new Memcached(MEMCACHED_URL, { maxValue: 1048576 });
}

function memCall(client, method, ...args) {
  return new Promise((resolve, reject) => {
    client[method](...args, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function memGetMulti(client, keys) {
  return new Promise((resolve, reject) => {
    client.getMulti(keys, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

async function flushRedis(redis) {
  await redis.flushdb();
}

async function flushMemcached(client) {
  await memCall(client, "flush");
}

module.exports = {
  REDIS_URL,
  MEMCACHED_URL,
  TTL_SEC,
  createRedis,
  createMemcached,
  memCall,
  memGetMulti,
  flushRedis,
  flushMemcached,
};
