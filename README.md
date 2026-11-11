# repo-check

Check that a modulane repository still matches the reference setup in [repo-template](https://github.com/modulane/repo-template), and report what has drifted.

Every modulane repository starts from the same GitHub setup: rulesets, a single **CI passed** check, pinned actions, the shared workflows from [modulane/workflows](https://github.com/modulane/workflows), Dependabot and the shared labels. The reference changes first and the other repositories follow it, by hand. repo-check reads a repository and the reference, compares them and lists every difference, so a repository that was left behind shows up.

## What it checks

| Check              | What drifts                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rulesets`         | The rulesets on GitHub against the reference's `rulesets/*.json`: the main ruleset and the maintainer review ruleset, their rules, required checks and bypass list. Settings GitHub adds by default are ignored. |
| `ci`               | `ci.yml` runs on the reference's triggers and ends in a **CI passed** job that runs with `if: always()` and needs every other job. Release runs CI before releasing.                                             |
| `pinned-actions`   | Every action and shared workflow is pinned to a commit SHA with a `# vX.Y.Z` comment, at the release the reference uses. Ahead of the reference is a warning: the reference changes first.                       |
| `shared-workflows` | The workflows that only call modulane/workflows match the reference line for line, apart from their pins and inputs. Every other call the reference makes, such as **Release notes**, is there too.              |
| `release`          | `release.yml` names this repository instead of `REPO-NAME`, and `.releaserc.json` uses the reference's plugins, with `@semantic-release/npm` allowed for a package on npm.                                       |
| `dependabot`       | The `github-actions` update in `.github/dependabot.yml` matches the reference. Updates for other ecosystems are allowed.                                                                                         |
| `labels`           | `.github/labels.json` has every reference label, with the same color and description. Labels of its own are allowed.                                                                                             |
| `files`            | `.editorconfig`, `.gitattributes` and `CODEOWNERS` match, the pull request template has every section and box of the reference, and there is a `LICENSE`.                                                        |

A failure means drift. A warning (`!`) is a difference worth a look that does not fail the run, and a skip (`–`) is a part that could not be checked, such as rulesets on a private repository on the GitHub Free plan.

## Usage

repo-check is not on npm yet. Until then, install it from a clone of this repository, then run it from the clone of the repository to check:

```bash
cd repo-check && corepack enable && yarn install
cd ../ai-disclosure && node ../repo-check/bin/repo-check.js
```

```text
Checking modulane/ai-disclosure against modulane/repo-template

Pinned actions
  ✗ modulane/workflows/.github/workflows/zizmor.yml is at v1.0.0, the reference at v1.2.0. (.github/workflows/zizmor.yml:16)

Shared workflows
  ✗ .github/workflows/release.yml does not call modulane/workflows/.github/workflows/release-notes.yml, as the reference's "Release notes" job does.

…

3 of 8 checks found drift.
```

```text
repo-check [target] [options]

  target                 A local clone (default: the current directory), or
                         owner/repo[@ref] to read the files from GitHub

  --reference <source>   The reference setup: owner/repo[@ref] or a local
                         clone (default: modulane/repo-template)
  --repo <owner/repo>    The GitHub repository whose rulesets are checked
                         (default: the target, or its origin remote)
  --only <checks>        Run only these checks, separated by commas
  --json                 Print the results as JSON
```

The exit code is 0 without drift, 1 with drift, and 2 when the check could not run.

To compare with your own clone of the reference, before its changes are merged, pass its folder: `--reference ../repo-template`.

## GitHub access

repo-check reads GitHub with `GITHUB_TOKEN` or `GH_TOKEN`, or else with the token of the [GitHub CLI](https://cli.github.com) when you are signed in. The token needs read access to the reference and to the repository checked. GitHub only shows who can bypass a ruleset to repository admins, so with less access that part is skipped.

repo-template is private, so reading it from GitHub needs a token with access to it. Without one, pass a local clone with `--reference`.

## Development

```bash
corepack enable
yarn install
yarn check
```

`yarn check` runs Prettier and the tests. The tests use in-memory repositories and a fake GitHub API, so they need no network and no token.

## License

[MIT](LICENSE)
