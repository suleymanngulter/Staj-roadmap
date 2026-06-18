function generateUserIds(count) {
  const ids = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`user_${String(i).padStart(5, "0")}`);
  }
  return ids;
}

function pickValidUserId(validIds, index) {
  return validIds[index % validIds.length];
}

function pickInvalidUserId(validIds, index) {
  return `unknown_${String(index).padStart(5, "0")}`;
}

module.exports = {
  generateUserIds,
  pickValidUserId,
  pickInvalidUserId,
};
