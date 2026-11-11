// One run of repo-check, as the CLI and the action both do it: check the
// repository, and with `fix`, work out the file changes and check the
// repository again as it will be once they are in.
import { collectFixes, compareRuns, overlaySource } from './fix.js'
import { assertReference, runChecks } from './run.js'

export const checkRepository = async ({
  target,
  reference,
  github,
  repo,
  only,
  fix = false,
}) => {
  await assertReference(reference)
  const context = { target, reference, github, repo }
  const results = await runChecks(context, only)
  if (!fix) return { results }
  const changes = await collectFixes(target, results)
  const after =
    changes.size > 0
      ? await runChecks(
          { ...context, target: overlaySource(target, changes) },
          only,
        )
      : results
  return { results, changes, after, ...compareRuns(results, after) }
}
