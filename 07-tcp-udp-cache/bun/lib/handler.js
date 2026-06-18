const { QUEUE_NAME } = require("./clients");

function createHandler(redis, channel) {
  async function validateAndPublish(userId) {
    const exists = await redis.exists(`user:${userId}`);
    if (!exists) {
      return { ok: false, reason: "not_in_cache" };
    }

    const body = Buffer.from(
      JSON.stringify({ userId, acceptedAt: Date.now() })
    );
    channel.sendToQueue(QUEUE_NAME, body);
    return { ok: true };
  }

  return { validateAndPublish };
}

module.exports = { createHandler };
