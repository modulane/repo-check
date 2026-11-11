// Reads the `uses:` lines of a workflow or action file. YAML parsers drop
// comments, and the `# vX.Y.Z` comment after a pin is part of what is
// checked, so the lines are read as text.
const usesLine =
  /^\s*(?:-\s+)?uses:\s*(['"]?)([^\s'"#]+)\1\s*(?:#\s*(.*?))?\s*$/

// `owner/repo@ref`, `owner/repo/path@ref`, or a local one: `./path`, `$/path`
// (this repository at the commit under test) or `docker://image`.
export const parseUses = text =>
  text.split(/\r?\n/).flatMap((line, index) => {
    const match = usesLine.exec(line)
    if (!match) return []
    const [, , value, comment = ''] = match
    const local = /^(\.\/|\$\/|docker:\/\/)/.test(value)
    const at = value.lastIndexOf('@')
    const pinned = !local && at !== -1
    return [
      {
        line: index + 1,
        value,
        local,
        name: pinned ? value.slice(0, at) : value,
        ref: pinned ? value.slice(at + 1) : '',
        comment,
      },
    ]
  })

export const isSha = ref => /^[0-9a-f]{40}$/.test(ref)

export const isVersion = comment => /^v\d+\.\d+\.\d+$/.test(comment)

// -1, 0 or 1, for two `vX.Y.Z` versions.
export const compareVersions = (a, b) => {
  const pa = a.slice(1).split('.').map(Number)
  const pb = b.slice(1).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}
