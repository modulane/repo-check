// Text edits for the fixes. The files are edited as text, never parsed and
// written back, so their comments and formatting stay as they are.

const lines = text => text.replace(/\r\n/g, '\n').split('\n')

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The lines of job `id` in a workflow, with the comment lines just above it:
// from its key at two spaces to the next key at two spaces or less.
export const jobBlock = (text, id) => {
  const all = lines(text)
  const start = all.findIndex(line => line === `  ${id}:`)
  if (start === -1) return null
  let first = start
  while (first > 0 && /^\s{2}#/.test(all[first - 1])) first--
  let end = start + 1
  while (end < all.length && !/^\s{0,2}[^\s#]/.test(all[end])) end++
  while (end > start + 1 && all[end - 1].trim() === '') end--
  return { first, start, end, text: all.slice(first, end).join('\n') }
}

// Adds a job from another workflow at the end of this one's jobs.
export const appendJob = (text, block) =>
  `${text.replace(/\s*$/, '')}\n\n${block}\n`

// The reference's text for a workflow that calls a shared workflow, with the
// `with:` inputs that the repository passes to it.
export const keepInputs = (reference, actual, jobIds) => {
  let result = lines(reference)
  for (const id of jobIds) {
    const own = jobBlock(actual, id)
    const ref = jobBlock(result.join('\n'), id)
    if (!own || !ref) return null
    const ownLines = own.text.split('\n')
    const at = ownLines.findIndex(line => line === '    with:')
    if (at === -1) continue
    let end = at + 1
    while (end < ownLines.length && /^(\s{5,}|\s*$)/.test(ownLines[end])) end++
    const inputs = ownLines.slice(at, end)
    if (ref.text.split('\n').includes('    with:')) return null
    result = [...result.slice(0, ref.end), ...inputs, ...result.slice(ref.end)]
  }
  return `${result.join('\n').replace(/\s*$/, '')}\n`
}

// Moves `uses: name@ref # comment` to another pin.
export const replacePin = (text, { name, ref }, pin) => {
  const value = ref ? `${name}@${ref}` : name
  const pattern = new RegExp(
    `(uses:\\s*['"]?)${escape(value)}(['"]?)(?:[ \\t]*#[^\\n]*)?$`,
    'gm',
  )
  return text.replace(pattern, `$1${name}@${pin.ref}$2 # ${pin.comment}`)
}

// Adds jobs to the `needs: [a, b]` list of job `id`. Other forms of `needs`
// are left alone.
export const addNeeds = (text, id, missing) => {
  const block = jobBlock(text, id)
  if (!block) return null
  const all = lines(text)
  for (let i = block.start + 1; i < block.end; i++) {
    const flow = /^(\s{4}needs:\s*)\[(.*)\]\s*$/.exec(all[i])
    const single = /^(\s{4}needs:\s*)([\w-]+)\s*$/.exec(all[i])
    const match = flow ?? single
    if (!match) continue
    const current = match[2]
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)
    all[i] = `${match[1]}[${[...current, ...missing].join(', ')}]`
    return all.join('\n')
  }
  return null
}

// The pull request template as sections: the text before the first level-two
// heading, then each heading with the lines under it.
const sections = text => {
  const result = [{ heading: null, lines: [] }]
  for (const line of lines(text)) {
    if (/^## /.test(line))
      result.push({ heading: line.slice(3).trim(), lines: [] })
    result.at(-1).lines.push(line)
  }
  return result
}

const isBox = line => /^\s*- \[[ xX]\] /.test(line)
export const boxText = line => line.replace(/^\s*- \[[ xX]\] /, '').trim()

// Adds the sections and boxes of the reference template that the
// repository's template is missing, each where the reference has it. With
// `only`, as { heading } or { box }, it adds that one alone, so a box the
// repository accepts is never added through the fix of another.
export const completeTemplate = (reference, actual, only) => {
  const wanted = line =>
    !only || (only.box !== undefined && only.box === boxText(line))
  const expected = sections(reference)
  const result = sections(actual)
  expected.forEach((section, index) => {
    if (section.heading === null) return
    const own = result.find(other => other.heading === section.heading)
    if (!own) {
      if (only && only.heading !== section.heading) return
      // After the section that comes before it in the reference.
      const previous = expected
        .slice(0, index)
        .reverse()
        .map(other => result.findIndex(mine => mine.heading === other.heading))
        .find(at => at > 0)
      const at = previous === undefined ? 1 : previous + 1
      const body = [...section.lines]
      if (body.at(-1)?.trim() !== '') body.push('')
      result.splice(at, 0, { heading: section.heading, lines: body })
      return
    }
    const have = new Set(own.lines.filter(isBox).map(boxText))
    const missing = section.lines.filter(
      line => isBox(line) && !have.has(boxText(line)) && wanted(line),
    )
    if (missing.length === 0) return
    let last = own.lines.findLastIndex(isBox)
    if (last === -1) {
      last = own.lines.findLastIndex(line => line.trim() !== '')
    }
    own.lines.splice(
      last + 1,
      0,
      ...missing.map(line => line.replace(/\[[xX]\]/, '[ ]')),
    )
  })
  const text = result.flatMap(section => section.lines).join('\n')
  return `${text.replace(/\s*$/, '')}\n`
}
