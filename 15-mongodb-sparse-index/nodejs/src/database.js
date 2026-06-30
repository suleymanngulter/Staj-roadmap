const { MongoClient } = require("mongodb");
require("dotenv").config();

const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sparse_index";

let client;
let db;

async function connect() {
  if (db) return db;
  client = new MongoClient(URI);
  await client.connect();
  db = client.db();
  return db;
}

async function getUsersCollection() {
  const database = await connect();
  return database.collection("users");
}

async function close() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}

module.exports = { connect, getUsersCollection, close };
