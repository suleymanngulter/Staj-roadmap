const Redis = require("ioredis");
const amqp = require("amqplib");
const { REDIS_URL, RABBITMQ_URL, QUEUE_NAME } = require("./config");

async function createRedis() {
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  await redis.connect();
  return redis;
}

async function seedRedis(redis, userIds) {
  await redis.flushdb();
  const pipeline = redis.pipeline();
  for (const userId of userIds) {
    pipeline.set(`user:${userId}`, "1");
  }
  await pipeline.exec();
}

async function createRabbit() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();
  await channel.assertQueue(QUEUE_NAME, { durable: false });
  return { connection, channel };
}

async function purgeQueue(channel) {
  await channel.purgeQueue(QUEUE_NAME);
}

async function getQueueDepth(channel) {
  const info = await channel.checkQueue(QUEUE_NAME);
  return info.messageCount;
}

async function closeRedis(redis) {
  if (redis && redis.status !== "end") {
    await redis.quit();
  }
}

async function closeRabbit({ connection, channel }) {
  if (channel) await channel.close();
  if (connection) await connection.close();
}

module.exports = {
  createRedis,
  seedRedis,
  createRabbit,
  purgeQueue,
  getQueueDepth,
  closeRedis,
  closeRabbit,
  QUEUE_NAME,
};
