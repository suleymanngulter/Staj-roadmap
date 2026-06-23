function generateEntries(count) {
  const entries = [];
  for (let i = 1; i <= count; i++) {
    const id = String(i).padStart(5, "0");
    entries.push({
      key: `user:${id}`,
      value: JSON.stringify({
        id: i,
        username: `user_${id}`,
        name: "Ada",
        surname: "Yılmaz",
        age: 20 + (i % 50),
      }),
    });
  }
  return entries;
}

module.exports = { generateEntries };
