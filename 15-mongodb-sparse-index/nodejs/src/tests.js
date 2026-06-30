/**
 * Sparse indeks kenar durumları ve API doğrulama testleri.
 * Çalıştır: npm test (sunucu gerekmez; doğrudan MongoDB)
 */
const { ObjectId } = require("mongodb");
const { parseVipCouponCode } = require("./server");
const { getUsersCollection, close } = require("./database");
const { createSparseIndex, dropVipIndex } = require("./indexManager");

const NEGATIVE = "___NONEXISTENT_VIP___";

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function winningStage(plan) {
  const p = plan?.queryPlanner?.winningPlan;
  if (p?.inputStage?.stage === "IXSCAN" || p?.stage === "IXSCAN") return "IXSCAN";
  return p?.inputStage?.stage ?? p?.stage ?? "?";
}

async function testParseVipCouponCode() {
  assert(parseVipCouponCode(undefined).skip, "undefined skip");
  assert(parseVipCouponCode(" GOLD ").value === "GOLD", "trim");
  assert(parseVipCouponCode("").error, "boş string red");
  assert(parseVipCouponCode(null, { allowUnset: true }).unset, "null unset");
  console.log("✓ parseVipCouponCode");
}

async function testSparseUnsetBehavior() {
  const col = await getUsersCollection();
  await dropVipIndex();
  await createSparseIndex();

  const { insertedId } = await col.insertOne({
    username: "_sparse_test",
    email: "_sparse@test.com",
    createdAt: new Date(),
    vipCouponCode: "TEMP",
  });

  await col.updateOne({ _id: insertedId }, { $unset: { vipCouponCode: "" } });
  const afterUnset = await col.findOne({ _id: insertedId });
  assert(!("vipCouponCode" in afterUnset), "$unset sonrası alan yok");

  await col.updateOne({ _id: insertedId }, { $set: { vipCouponCode: "" } });
  const afterEmpty = await col.findOne({ _id: insertedId });
  assert("vipCouponCode" in afterEmpty && afterEmpty.vipCouponCode === "", "boş string alan var");

  await col.deleteOne({ _id: insertedId });
  console.log("✓ sparse: unset vs boş string davranışı");
}

async function testNegativeQueryUsesIndex() {
  const col = await getUsersCollection();
  const explained = await col.find({ vipCouponCode: NEGATIVE }).explain("executionStats");
  const stage = winningStage(explained);
  assert(stage === "IXSCAN", `negatif sorgu IXSCAN olmalı, gelen: ${stage}`);
  assert(
    (explained.executionStats?.totalDocsExamined ?? 0) === 0,
    "eşleşmeyen sorguda döküman okunmamalı"
  );
  console.log("✓ negatif sorgu sparse indeksle IXSCAN (COLLSCAN değil)");
}

async function main() {
  await testParseVipCouponCode();
  await testSparseUnsetBehavior();
  await testNegativeQueryUsesIndex();
  console.log("\nTüm testler geçti.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => close());
