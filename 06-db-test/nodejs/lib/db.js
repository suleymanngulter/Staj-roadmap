const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { CREATE_USERS } = require("./schema");

const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, "..", "..", "bench.db");

const INSERT_SQL =
  "INSERT INTO users (id, username, name, surname, age) VALUES (?, ?, ?, ?, ?)";

function resetDbFile() {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
}

function openDb() {
  resetDbFile();
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = DELETE");
  db.pragma("synchronous = NORMAL");
  return db;
}

function setupSchema(db) {
  db.exec(CREATE_USERS);
}

function insertBatchTransaction(db, users) {
  const stmt = db.prepare(INSERT_SQL);
  const insertMany = db.transaction((rows) => {
    for (const u of rows) {
      stmt.run(u.id, u.username, u.name, u.surname, u.age);
    }
  });
  insertMany(users);
}

function insertIndividual(db, users) {
  const stmt = db.prepare(INSERT_SQL);
  for (const u of users) {
    stmt.run(u.id, u.username, u.name, u.surname, u.age);
  }
}

function selectAll(db) {
  return db.prepare("SELECT * FROM users").all();
}

function selectByAge(db, minAge) {
  return db.prepare("SELECT * FROM users WHERE age > ?").all(minAge);
}

function updateAllAges(db) {
  return db.prepare("UPDATE users SET age = age + 1").run();
}

function deleteByIdGreaterThan(db, id) {
  return db.prepare("DELETE FROM users WHERE id > ?").run(id);
}

function closeDb(db) {
  db.close();
}

module.exports = {
  DB_PATH,
  openDb,
  setupSchema,
  insertBatchTransaction,
  insertIndividual,
  selectAll,
  selectByAge,
  updateAllAges,
  deleteByIdGreaterThan,
  closeDb,
};
