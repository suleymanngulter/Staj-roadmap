const express = require("express");
const { ObjectId } = require("mongodb");
require("dotenv").config();

const { getUsersCollection, close } = require("./database");

const app = express();
const PORT = Number(process.env.PORT) || 3015;

app.use(express.json());

/**
 * Sparse indeks davranışı:
 * - Alan hiç yok → sparse indekste yer almaz (iyi)
 * - null veya "" set → alan VAR sayılır; sparse indekse girer (kötü)
 * Bu yüzden boş string reddedilir; kaldırmak için null + $unset kullanılır.
 */
function parseVipCouponCode(value, { allowUnset = false } = {}) {
  if (value === undefined) return { skip: true };
  if (value === null) {
    return allowUnset ? { unset: true } : { error: "vipCouponCode null; kaldırmak için PUT'ta null gönderin" };
  }
  if (typeof value !== "string") {
    return { error: "vipCouponCode string olmalı" };
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return { error: "vipCouponCode boş olamaz; sparse indeksi kirletir. Kaldırmak için null gönderin" };
  }
  return { value: trimmed };
}

app.post("/users", async (req, res, next) => {
  try {
    const { username, email, vipCouponCode } = req.body;
    if (!username || !email) {
      return res.status(400).json({ error: "username ve email zorunlu" });
    }

    const doc = { username, email, createdAt: new Date() };
    const parsed = parseVipCouponCode(vipCouponCode);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.value) doc.vipCouponCode = parsed.value;

    const col = await getUsersCollection();
    const result = await col.insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  } catch (err) {
    next(err);
  }
});

app.get("/users/vip/:code", async (req, res, next) => {
  try {
    const col = await getUsersCollection();
    const users = await col.find({ vipCouponCode: req.params.code }).limit(50).toArray();
    res.json({ count: users.length, users });
  } catch (err) {
    next(err);
  }
});

app.put("/users/:id", async (req, res, next) => {
  try {
    const col = await getUsersCollection();
    const { username, email, vipCouponCode } = req.body;
    const set = {};
    const unset = {};

    if (username !== undefined) set.username = username;
    if (email !== undefined) set.email = email;

    if (vipCouponCode !== undefined) {
      const parsed = parseVipCouponCode(vipCouponCode, { allowUnset: true });
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.unset) unset.vipCouponCode = "";
      else if (parsed.value) set.vipCouponCode = parsed.value;
    }

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;

    if (!Object.keys(update).length) {
      return res.status(400).json({ error: "Güncellenecek alan yok" });
    }

    const result = await col.findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      update,
      { returnDocument: "after" }
    );

    if (!result) return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.delete("/users/:id", async (req, res, next) => {
  try {
    const col = await getUsersCollection();
    const result = await col.deleteOne({ _id: new ObjectId(req.params.id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API http://127.0.0.1:${PORT}`);
  });

  process.on("SIGINT", async () => {
    await close();
    process.exit(0);
  });
}

module.exports = { app, parseVipCouponCode };
