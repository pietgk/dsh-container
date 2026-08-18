export function increment(value) {
  if (!Number.isInteger(value)) {
    throw new TypeError('value must be an integer')
  }
  return value + 1
}
