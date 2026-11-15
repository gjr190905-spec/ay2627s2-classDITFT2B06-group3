const MAX_PG_INT = 2147483647;

module.exports = function parseId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const str = String(value);
  if (!/^[1-9]\d*$/.test(str)) {
    return null;
  }
  const id = Number(str);
  if (id <= MAX_PG_INT) {
    return id;
  }
  return null;
};