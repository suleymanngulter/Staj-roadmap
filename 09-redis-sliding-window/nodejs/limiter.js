const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const WINDOW_MS = Number(process.env.WINDOW_MS) || 10_000;
const LIMIT = Number(process.env.LIMIT) || 5;

// ZSET: score = zaman damgası, pencere dışındakiler silinir, sayım limit ile kıyaslanır.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, window)

local count = redis.call("ZCARD", key)
if count > limit then
  redis.call("ZREM", key, member)
  return 0
end
return 1
`;

function createRedis() {
  return new Redis(REDIS_URL);
}

async function allow(redis, key) {
  const now = Date.now();
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  const ok = await redis.eval(
    SLIDING_WINDOW_LUA,
    1,
    key,
    now,
    WINDOW_MS,
    LIMIT,
    member,
  );
  return ok === 1;
}

module.exports = { REDIS_URL, WINDOW_MS, LIMIT, createRedis, allow };
