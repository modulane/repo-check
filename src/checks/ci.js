// CI ends in the single "CI passed" job that the main ruleset requires: it
// runs even when a job fails, and it needs every other job, so no job can
// fail without failing it. The Release workflow runs CI before releasing.
import { addNeeds } from '../edit.js'
import { jobsOf, readWorkflow, triggersOf } from '../workflows.js'
import { fail, pass } from './findings.js'

export const CI_PASSED = 'CI passed'

const CI = '.github/workflows/ci.yml'

const asList = value => (Array.isArray(value) ? value : value ? [value] : [])

// A job that never runs on a pull request, such as a deployment from main,
// is not a check, so "CI passed" need not wait for it.
const onlyOnMain = job =>
  /github\.event_name\s*==\s*'push'|github\.ref\s*==\s*'refs\/heads\/main'/.test(
    String(job?.if ?? ''),
  )

const callsCi = job =>
  /^(\$|\.)\/\.github\/workflows\/ci\.ya?ml$/.test(job?.uses ?? '')

export default {
  id: 'ci',
  title: 'CI passed',
  async run({ reference, target }) {
    const ci = await readWorkflow(target, 'ci.yml')
    if (!ci) return [fail('ci:missing', `${CI} is missing.`, { file: CI })]
    if (ci.error) {
      return [
        fail('ci:parse', `${CI} does not parse: ${ci.error}`, { file: CI }),
      ]
    }
    const where = { file: CI }
    const findings = []

    const expected = await readWorkflow(reference, 'ci.yml')
    const triggers = triggersOf(ci)
    for (const trigger of triggersOf(expected)) {
      if (!triggers.includes(trigger)) {
        findings.push(
          fail(`ci:on:${trigger}`, `${CI} does not run on ${trigger}.`, where),
        )
      }
    }

    const jobs = jobsOf(ci)
    const final = jobs.find(([, job]) => job?.name === CI_PASSED)
    if (!final) {
      findings.push(
        fail('ci:ci-passed', `${CI} has no "${CI_PASSED}" job.`, where),
      )
    } else {
      const [id, job] = final
      if (!String(job.if ?? '').includes('always()')) {
        findings.push(
          fail(
            'ci:always',
            `"${CI_PASSED}" does not run with \`if: always()\`, so a failed job skips it and GitHub counts the skipped check as passing.`,
            where,
          ),
        )
      }
      const needs = asList(job.needs)
      const unchecked = jobs
        .filter(([other, data]) => other !== id && !onlyOnMain(data))
        .map(([other]) => other)
        .filter(other => !needs.includes(other))
      for (const other of unchecked) {
        findings.push(
          fail(
            `ci:needs:${other}`,
            `"${CI_PASSED}" does not need \`${other}\`, so it can fail without failing CI.`,
            {
              ...where,
              fix: {
                path: CI,
                edit: text => text && addNeeds(text, id, [other]),
              },
            },
          ),
        )
      }
    }

    const release = await readWorkflow(target, 'release.yml')
    if (
      release &&
      !release.error &&
      !jobsOf(release).some(([, job]) => callsCi(job))
    ) {
      findings.push(
        fail(
          'ci:release',
          `${release.path} does not run CI before releasing.`,
          {
            file: release.path,
          },
        ),
      )
    }

    if (findings.length === 0) {
      findings.push(
        pass(`"${CI_PASSED}" needs every CI job and runs even when one fails.`),
      )
    }
    return findings
  },
}
