function generateUsers(count = 10000) {
  return Array.from({ length: count }, (_, i) => {
    const id = i + 1;
    return {
      id,
      username: `user_${String(id).padStart(5, "0")}`,
      name: `Ali${id}`,
      surname: `Yilmaz${id}`,
      age: 18 + (id % 50),
    };
  });
}

module.exports = { generateUsers };
