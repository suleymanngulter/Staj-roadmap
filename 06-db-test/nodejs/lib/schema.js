const CREATE_USERS = `
CREATE TABLE users (
  id       INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  surname  TEXT NOT NULL,
  age      INTEGER NOT NULL
);
CREATE INDEX idx_users_age ON users(age);
`;

module.exports = { CREATE_USERS };
