
function isPrime(n) {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

// [start, end) aralığındaki asal sayıların adedini döndürür.
function countPrimes(start, end) {
  let count = 0;
  for (let n = start; n < end; n++) {
    if (isPrime(n)) count++;
  }
  return count;
}

module.exports = { isPrime, countPrimes };
