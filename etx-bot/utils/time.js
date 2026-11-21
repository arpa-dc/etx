// "1d2h30m" -> millisecondes
const UNITS = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };
function parseDuration(str) {
  let total = 0, found = false;
  for (const [, n, u] of String(str).toLowerCase().matchAll(/(\d+)\s*([smhdw])/g)) {
    total += Number(n) * UNITS[u];
    found = true;
  }
  return found ? total : null;
}
module.exports = { parseDuration };
