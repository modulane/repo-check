// The shared workflows: pr-title.yml, pr-labels.yml, ai-disclosure.yml,
// labels.yml and zizmor.yml hold only a trigger and a call to
// modulane/workflows, so they match the reference line for line. Other
// workflows, such as release.yml, must still make every call to
// modulane/workflows that the reference makes. Which release they call is
// the pinned actions check's business, so refs are left out here.
import { differences, normalize } from '../compare.js'
import {
  calledWorkflow,
  jobsOf,
  readWorkflow,
  SHARED,
  triggersOf,
  workflowFiles,
} from '../workflows.js'
import { fail, pass, warn } from './findings.js'

const maskRefs = text =>
  normalize(text).replace(
    /^(\s*(?:-\s+)?uses:\s*['"]?[^@\s'"#]+)@[^\s'"#]+['"]?(?:\s*#.*)?$/gm,
    '$1',
  )

// A caller may pass its own inputs, such as `package-scope: true` in a
// monorepo, so `with:` is left out of the comparison too.
const withoutRefs = data => {
  const copy = structuredClone(data)
  for (const job of Object.values(copy?.jobs ?? {})) {
    if (typeof job?.uses === 'string') job.uses = calledWorkflow(job)
    delete job?.with
  }
  return copy
}

// modulane/workflows calls its own workflows as `$/.github/workflows/...`.
const fileOf = called => called.split('/').at(-1)
const isLocalCall = (called, file) =>
  /^(\$|\.)\/\.github\/workflows\//.test(called ?? '') &&
  fileOf(called) === file

const definesItself = workflow => triggersOf(workflow).includes('workflow_call')

const isCaller = workflow => {
  const jobs = jobsOf(workflow)
  return (
    jobs.length > 0 &&
    jobs.every(([, job]) => calledWorkflow(job)?.startsWith(SHARED))
  )
}

const strictDifferences = (a, b) => [
  ...new Set([...differences(a, b), ...differences(b, a)]),
]

const checkCaller = (expected, actual) => {
  if (maskRefs(expected.text) === maskRefs(actual.text)) {
    return pass(`${actual.path} matches the reference.`)
  }
  const paths = strictDifferences(
    withoutRefs(expected.data),
    withoutRefs(actual.data),
  )
  const inputs = jobsOf(actual).some(
    ([id, job]) =>
      JSON.stringify(job?.with) !==
      JSON.stringify(expected.data.jobs?.[id]?.with),
  )
  if (paths.length === 0 && inputs) {
    return pass(`${actual.path} matches the reference, with inputs of its own.`)
  }
  if (paths.length === 0) {
    return warn(`${actual.path} differs from the reference in its comments.`, {
      file: actual.path,
    })
  }
  return fail(
    `${actual.path} differs from the reference in ${paths.map(path => `\`${path}\``).join(', ')}.`,
    { file: actual.path },
  )
}

const checkCalls = (expected, actual) => {
  const calls = jobsOf(actual).map(([, job]) => calledWorkflow(job))
  return jobsOf(expected)
    .map(([id, job]) => [id, job, calledWorkflow(job)])
    .filter(([, , called]) => called?.startsWith(SHARED))
    .map(([id, job, called]) =>
      calls.some(call => call === called || isLocalCall(call, fileOf(called)))
        ? pass(`${actual.path} calls ${called}.`)
        : fail(
            `${actual.path} does not call ${called}, as the reference's "${job.name ?? id}" job does.`,
            { file: actual.path },
          ),
    )
}

export default {
  id: 'shared-workflows',
  title: 'Shared workflows',
  async run({ reference, target }) {
    const findings = []
    for (const file of await workflowFiles(reference)) {
      const expected = await readWorkflow(reference, file)
      if (!isCaller(expected) && checkCalls(expected, expected).length === 0) {
        continue
      }
      const actual = await readWorkflow(target, file)
      if (!actual) {
        findings.push(
          fail(`${expected.path} is missing.`, { file: expected.path }),
        )
      } else if (actual.error) {
        findings.push(
          fail(`${actual.path} does not parse: ${actual.error}`, {
            file: actual.path,
          }),
        )
      } else if (isCaller(expected) && definesItself(actual)) {
        findings.push(pass(`${actual.path} is the shared workflow itself.`))
      } else if (isCaller(expected)) {
        findings.push(checkCaller(expected, actual))
      } else {
        findings.push(...checkCalls(expected, actual))
      }
    }
    return findings
  },
}
