// Turns the fixes that findings carry into file changes. The edits run one
// after another on the same text, so two fixes to one file both apply.

const fixable = finding =>
  ['fail', 'warn'].includes(finding.level) && finding.fix?.path

export const collectFixes = async (target, results) => {
  const texts = new Map()
  const original = new Map()
  const read = async path => {
    if (!original.has(path)) original.set(path, await target.read(path))
    return texts.has(path) ? texts.get(path) : original.get(path)
  }
  for (const result of results) {
    for (const finding of result.findings.filter(fixable)) {
      const next = finding.fix.edit(await read(finding.fix.path))
      if (typeof next === 'string') texts.set(finding.fix.path, next)
    }
  }
  const changes = new Map()
  for (const [path, text] of texts) {
    if (text !== original.get(path)) changes.set(path, text)
  }
  return changes
}

// A source that reads the changes on top of another source, to check a
// repository as it will be once the fixes are in.
export const overlaySource = (source, changes) => ({
  name: source.name,
  async read(path) {
    return changes.has(path) ? changes.get(path) : source.read(path)
  },
  async list(dir) {
    const added = [...changes.keys()]
      .filter(path => path.startsWith(`${dir}/`))
      .map(path => path.slice(dir.length + 1))
      .filter(rest => !rest.includes('/'))
    return [...new Set([...(await source.list(dir)), ...added])].sort()
  },
})

const problems = results =>
  results.flatMap(result =>
    result.findings.filter(finding => ['fail', 'warn'].includes(finding.level)),
  )

// What the changes fix, and what is still left once they are in.
export const compareRuns = (before, after) => {
  const left = problems(after)
  const ids = new Set(left.map(finding => `${finding.id}\n${finding.message}`))
  return {
    fixed: problems(before).filter(
      finding => !ids.has(`${finding.id}\n${finding.message}`),
    ),
    left,
  }
}
