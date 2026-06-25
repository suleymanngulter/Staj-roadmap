-- PostgREST: authenticator rolü istekleri web_anon'a devreder.
CREATE ROLE web_anon NOLOGIN;
CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'postgrest';
GRANT web_anon TO authenticator;

CREATE SCHEMA api;
GRANT USAGE ON SCHEMA api TO web_anon;

CREATE TABLE api.urunler (
  id        SERIAL PRIMARY KEY,
  ad        TEXT NOT NULL,
  fiyat     NUMERIC(10, 2) NOT NULL CHECK (fiyat > 0),
  kategori  TEXT NOT NULL
);

INSERT INTO api.urunler (ad, fiyat, kategori) VALUES
  ('ThinkPad', 42000, 'laptop'),
  ('Tişört', 350, 'giyim'),
  ('Kulaklık', 1200, 'elektronik'),
  ('MacBook', 55000, 'laptop');

ALTER TABLE api.urunler ENABLE ROW LEVEL SECURITY;

-- SELECT: herkese açık
CREATE POLICY urunler_okuma ON api.urunler
  FOR SELECT TO web_anon USING (true);

-- INSERT / UPDATE: izinli (demo)
CREATE POLICY urunler_ekle ON api.urunler
  FOR INSERT TO web_anon WITH CHECK (true);

CREATE POLICY urunler_guncelle ON api.urunler
  FOR UPDATE TO web_anon USING (true) WITH CHECK (fiyat > 0);

-- DELETE: politika yok → RLS engeller

GRANT SELECT, INSERT, UPDATE ON api.urunler TO web_anon;
GRANT USAGE, SELECT ON SEQUENCE api.urunler_id_seq TO web_anon;
