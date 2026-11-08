# repo-check

Check that a modulane repository still matches the reference setup in [repo-template](https://github.com/modulane/repo-template), and report what has drifted.

> **Status:** planned. Nothing is published yet.

## What it will check

- The rulesets on the default branch: the main ruleset and the maintainer review ruleset.
- CI ends in the single **CI passed** job that the main ruleset requires.
- Every action is pinned to a commit SHA with a `# vX.Y.Z` comment.
- The shared workflows are present and up to date: pull request title, labels, AI disclosure, zizmor and release.
- Dependabot for actions and the shared labels.

It will run as a CLI on a local clone, and as a GitHub Action so drift shows up on its own.

## Package

Published on npm as `@modulane/repo-check`.

## License

MIT
