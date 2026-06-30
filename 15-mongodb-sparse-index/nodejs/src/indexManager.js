const { getUsersCollection, close } = require("./database");

const INDEX_KEY = { vipCouponCode: 1 };
const INDEX_NAME = "vipCouponCode_1";

async function dropVipIndex() {
  const col = await getUsersCollection();
  const indexes = await col.indexes();
  const exists = indexes.some((idx) => idx.name === INDEX_NAME);
  if (exists) {
    await col.dropIndex(INDEX_NAME);
    console.log(`İndeks silindi: ${INDEX_NAME}`);
  } else {
    console.log(`Silinecek indeks yok: ${INDEX_NAME}`);
  }
}

async function createNormalIndex() {
  const col = await getUsersCollection();
  await dropVipIndex();
  await col.createIndex(INDEX_KEY);
  console.log("Normal indeks oluşturuldu:", JSON.stringify(INDEX_KEY));
}

/**
 * Sparse indeks — unique YOK (bilinçli seçim).
 *
 * users koleksiyonunda aynı kampanya kodunu (ör. TEST_CODE) birden fazla
 * kullanıcı paylaşabilir. unique: true burada seed ve benchmark'ı kırar.
 *
 * Gerçek dünyada tekil kupon tanımı için ayrı `coupons` koleksiyonunda
 * { code: 1 }, { unique: true, sparse: true } kullanın; users sadece referans tutsun.
 */
async function createSparseIndex() {
  const col = await getUsersCollection();
  await dropVipIndex();
  await col.createIndex(INDEX_KEY, { sparse: true });
  console.log("Sparse indeks oluşturuldu:", JSON.stringify(INDEX_KEY), "{ sparse: true }");
}

async function main() {
  const mode = process.argv[2];
  try {
    if (mode === "normal") await createNormalIndex();
    else if (mode === "sparse") await createSparseIndex();
    else if (mode === "drop") await dropVipIndex();
    else {
      console.error("Kullanım: node src/indexManager.js <normal|sparse|drop>");
      process.exit(1);
    }
  } finally {
    await close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { dropVipIndex, createNormalIndex, createSparseIndex, INDEX_NAME };
