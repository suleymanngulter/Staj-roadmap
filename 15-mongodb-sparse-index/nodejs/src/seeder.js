const { faker } = require("@faker-js/faker");
const { getUsersCollection, close } = require("./database");

const TOTAL = Number(process.env.SEED_COUNT) || 2_000_000;
const BATCH = Number(process.env.BATCH_SIZE) || 10_000;

function buildUser(globalIndex) {
  const user = {
    username: faker.internet.username(),
    email: faker.internet.email(),
    createdAt: new Date(),
  };

  // Her 100 kullanıcının 5'ine (%5) vipCouponCode ekle; alanı yoksa key hiç yazılmaz.
  if (globalIndex % 100 < 5) {
    user.vipCouponCode =
      globalIndex % 500 === 0 ? "TEST_CODE" : faker.string.alphanumeric(10).toUpperCase();
  }

  return user;
}

async function seed() {
  const col = await getUsersCollection();
  const existing = await col.estimatedDocumentCount();

  if (existing >= TOTAL) {
    console.log(`Koleksiyonda zaten ${existing.toLocaleString()} kayıt var, seed atlandı.`);
    return;
  }

  if (existing > 0) {
    console.log(`Mevcut ${existing.toLocaleString()} kayıt siliniyor...`);
    await col.deleteMany({});
  }

  console.log(`${TOTAL.toLocaleString()} kullanıcı, batch=${BATCH.toLocaleString()}`);
  const started = Date.now();
  let inserted = 0;

  while (inserted < TOTAL) {
    const size = Math.min(BATCH, TOTAL - inserted);
    const batch = [];

    for (let i = 0; i < size; i++) {
      batch.push(buildUser(inserted + i));
    }

    const ops = batch.map((doc) => ({ insertOne: { document: doc } }));
    await col.bulkWrite(ops, { ordered: false });
    inserted += size;

    if (inserted % 100_000 === 0 || inserted === TOTAL) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  ${inserted.toLocaleString()} / ${TOTAL.toLocaleString()} (${elapsed}s)`);
    }
  }

  const vipCount = await col.countDocuments({ vipCouponCode: { $exists: true } });
  const testCodeCount = await col.countDocuments({ vipCouponCode: "TEST_CODE" });
  console.log(`\nTamamlandı: ${inserted.toLocaleString()} kayıt`);
  console.log(`vipCouponCode olan: ${vipCount.toLocaleString()} (~%${((vipCount / inserted) * 100).toFixed(1)})`);
  console.log(`TEST_CODE olan: ${testCodeCount.toLocaleString()}`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => close());
