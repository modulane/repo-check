// Every action and shared workflow is pinned to a commit SHA with a
// `# vX.Y.Z` comment, and is at the release the reference uses. A repository
// ahead of the reference is only a warning: the reference changes first, so
// it is the reference that needs the update.
import { compareVersions, isSha, isVersion, parseUses } from '../uses.js'
import { WORKFLOWS, workflowFiles } from '../workflows.js'
import { fail, pass, warn } from './findings.js'

const ACTION_FILES = ['action.yml', 'action.yaml']

const usesIn = async source => {
  const paths = [
    ...(await workflowFiles(source)).map(file => `${WORKFLOWS}/${file}`),
    ...ACTION_FILES,
  ]
  const found = []
  for (const path of paths) {
    const text = await source.read(path)
    if (text === null) continue
    for (const uses of parseUses(text)) {
      if (!uses.local) found.push({ ...uses, file: path })
    }
  }
  return found
}

// The pin the reference uses for each action, the highest when it uses
// several.
const referencePins = uses => {
  const pins = new Map()
  for (const entry of uses) {
    if (!isSha(entry.ref) || !isVersion(entry.comment)) continue
    const known = pins.get(entry.name)
    if (!known || compareVersions(entry.comment, known.comment) > 0) {
      pins.set(entry.name, entry)
    }
  }
  return pins
}

const checkUses = (uses, pins) => {
  const where = { file: uses.file, line: uses.line }
  if (!isSha(uses.ref)) {
    return fail(
      `${uses.name} is pinned to \`${uses.ref || 'nothing'}\`, not to a commit SHA.`,
      where,
    )
  }
  if (!isVersion(uses.comment)) {
    return fail(
      `${uses.name} has no \`# vX.Y.Z\` comment after its SHA.`,
      where,
    )
  }
  const expected = pins.get(uses.name)
  if (!expected) return null
  const order = compareVersions(uses.comment, expected.comment)
  if (order < 0) {
    return fail(
      `${uses.name} is at ${uses.comment}, the reference at ${expected.comment}.`,
      where,
    )
  }
  if (order > 0) {
    return warn(
      `${uses.name} is at ${uses.comment}, ahead of the reference at ${expected.comment}: update the reference first.`,
      where,
    )
  }
  if (uses.ref !== expected.ref) {
    return fail(
      `${uses.name} ${uses.comment} is pinned to ${uses.ref.slice(0, 7)}, the reference to ${expected.ref.slice(0, 7)}.`,
      where,
    )
  }
  return null
}

export default {
  id: 'pinned-actions',
  title: 'Pinned actions',
  async run({ reference, target }) {
    const pins = referencePins(await usesIn(reference))
    const uses = await usesIn(target)
    const findings = uses.map(entry => checkUses(entry, pins)).filter(Boolean)
    if (findings.length === 0) {
      findings.push(
        pass(
          `${uses.length} actions and workflow calls are pinned to commit SHAs, at the reference's releases.`,
        ),
      )
    }
    return findings
  },
}
