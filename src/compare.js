// Compares a value from the reference with the value a repository has, and
// returns the paths where they differ. Every key the reference sets must
// match. Keys it leaves out may hold anything, so the defaults GitHub adds
// to its answers never count as drift. Arrays match in any order.
export const differences = (expected, actual, path = '') => {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return [path]
    }
    const unmatched = [...actual]
    for (const item of expected) {
      const index = unmatched.findIndex(
        candidate => differences(item, candidate).length === 0,
      )
      if (index === -1) return [path]
      unmatched.splice(index, 1)
    }
    return []
  }
  if (expected !== null && typeof expected === 'object') {
    if (
      actual === null ||
      typeof actual !== 'object' ||
      Array.isArray(actual)
    ) {
      return [path]
    }
    return Object.keys(expected).flatMap(key =>
      differences(expected[key], actual[key], path ? `${path}.${key}` : key),
    )
  }
  return expected === actual ? [] : [path]
}

// Line endings and trailing blank lines never count as a difference.
export const normalize = text => text.replace(/\r\n/g, '\n').trimEnd()

// A list in prose: "a", "a and b", "a, b and c".
export const inProse = items =>
  items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
