// The shared workflows: pr-title.yml, pr-labels.yml, ai-disclosure.yml,
// labels.yml, zizmor.yml and repo-check.yml hold only a trigger and a call to
// modulane/workflows, so they match the reference line for line. Other
// workflows, such as release.yml, must still make every call to
// modulane/workflows that the reference makes. Which release they call is
// the pinned actions check's business, so refs are left out here.
import { differences, normalize } from '../compare.js'
import { appendJob, jobBlock, keepInputs } from '../edit.js'
import {
  calledWorkflow,
  jobsOf,
  readWorkflow,
  SHARED,
  triggersOf,
  workflowFiles,
} from '../workflows.js'
import { shortName } from '../uses.js'
import { copyOf, fail, pass, warn } from './findings.js'

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

// The reference's text, with the repository's own inputs kept.
const callerFix = (expected, actual) => {
  const withInputs = jobsOf(actual)
    .filter(([, job]) => job?.with !== undefined)
    .map(([id]) => id)
  return {
    path: actual.path,
    edit: () =>
      withInputs.length === 0
        ? expected.text
        : keepInputs(expected.text, actual.text, withInputs),
  }
}

const checkCaller = (expected, actual) => {
  if (maskRefs(expected.text) === maskRefs(actual.text)) {
    return pass(`${actual.path} matches the reference.`)
  }
  const paths = strictDifferences(
    withoutRefs(expected.data),
    withoutRefs(actual.data),
  )
  const id = `shared-workflows:${actual.path}`
  const fix = callerFix(expected, actual)
  const inputs = jobsOf(actual).some(
    ([job, data]) =>
      JSON.stringify(data?.with) !==
      JSON.stringify(expected.data.jobs?.[job]?.with),
  )
  if (paths.length === 0 && inputs) {
    return pass(`${actual.path} matches the reference, with inputs of its own.`)
  }
  if (paths.length === 0) {
    return warn(
      id,
      `${actual.path} differs from the reference in its comments.`,
      {
        file: actual.path,
        fix,
      },
    )
  }
  return fail(
    id,
    `${actual.path} differs from the reference in ${paths.map(path => `\`${path}\``).join(', ')}.`,
    { file: actual.path, fix },
  )
}

const checkCalls = (expected, actual) => {
  const calls = jobsOf(actual).map(([, job]) => calledWorkflow(job))
  const ids = new Set(jobsOf(actual).map(([id]) => id))
  return jobsOf(expected)
    .map(([id, job]) => [id, job, calledWorkflow(job)])
    .filter(([, , called]) => called?.startsWith(SHARED))
    .map(([id, job, called]) => {
      if (
        calls.some(call => call === called || isLocalCall(call, fileOf(called)))
      ) {
        return pass(`${actual.path} calls ${shortName(called)}.`)
      }
      // The reference's job, added at the end, unless a job of that name
      // already exists.
      const block = jobBlock(expected.text, id)
      return fail(
        `shared-workflows:${actual.path}:${fileOf(called)}`,
        `${actual.path} does not call ${shortName(called)}, as the reference's "${job.name ?? id}" job does.`,
        {
          file: actual.path,
          fix:
            block && !ids.has(id)
              ? {
                  path: actual.path,
                  edit: text => text && appendJob(text, block.text),
                }
              : undefined,
        },
      )
    })
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
          fail(
            `shared-workflows:${expected.path}`,
            `${expected.path} is missing.`,
            {
              file: expected.path,
              fix: isCaller(expected)
                ? copyOf(expected.path, expected.text)
                : undefined,
            },
          ),
        )
      } else if (actual.error) {
        findings.push(
          fail(
            `shared-workflows:${actual.path}`,
            `${actual.path} does not parse: ${actual.error}`,
            { file: actual.path },
          ),
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
