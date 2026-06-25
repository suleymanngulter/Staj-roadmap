const BASE = process.env.POSTGREST_URL || "http://127.0.0.1:3000";

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json", Prefer: "return=representation" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function main() {
  console.log(`PostgREST: ${BASE}\n`);

  const all = await api("GET", "/urunler");
  console.log("GET /urunler →", all.status, all.data);

  const pahali = await api("GET", "/urunler?fiyat=gt.5000");
  console.log("\nGET /urunler?fiyat=gt.5000 →", pahali.status, pahali.data);

  const inserted = await api("POST", "/urunler", {
    ad: "Mouse",
    fiyat: 450,
    kategori: "elektronik",
  });
  console.log("\nPOST /urunler →", inserted.status, inserted.data);

  const id = inserted.data?.[0]?.id;
  if (id) {
    const patched = await api("PATCH", `/urunler?id=eq.${id}`, { fiyat: 499 });
    console.log(`\nPATCH /urunler?id=eq.${id} →`, patched.status, patched.data);
  }

  const deleted = await api("DELETE", "/urunler?id=eq.1");
  console.log("\nDELETE /urunler?id=eq.1 (RLS engeli beklenir) →", deleted.status, deleted.data);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
