# repo-check

Check that a repository still matches its reference setup, and open a pull request that brings back what has drifted.

Every modulane repository starts from the same GitHub setup in [repo-template](https://github.com/modulane/repo-template): rulesets and settings, a single **CI passed** check, pinned actions, the shared workflows from [modulane/workflows](https://github.com/modulane/workflows), Dependabot and the shared labels. The reference changes first and the other repositories follow it. repo-check compares a repository with the reference and lists every difference, and as an action it keeps one pull request open with the fixes, as Dependabot does for dependencies.

A repository made from repo-template outside modulane can use it too, against modulane/repo-template or against its own reference, named with `--reference` or the `reference` input.

- **One pull request, kept up to date.** It brings back what a file change can fix, is updated when the fixes change, and is closed once there is nothing left to fix.
- **Drift a pull request cannot fix fails the run.** Rulesets, repository settings and security settings live on GitHub, not in the files, so a maintainer changes them.
- **Differences kept on purpose.** A repository lists them, each with its reason, and repo-check leaves them alone.
- **Nothing checked out.** It reads the repository and the reference through the GitHub API, and commits through it too, so GitHub signs the commit.

## What it checks

| Check              | What drifts                                                                                                                                                                                                                                                                                                                              | Fixed by the pull request                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `rulesets`         | The rulesets on GitHub against the reference's `rulesets/*.json`: their rules, required checks and bypass list. Settings GitHub adds by default are ignored, and a rule the reference does not have is a warning.                                                                                                                        | No                                                      |
| `settings`         | The repository settings against the reference's `settings.json`, such as squash merges only and branches deleted after merge.                                                                                                                                                                                                            | No                                                      |
| `security`         | The security settings against the reference's `security.json`: Dependabot alerts and security updates, secret scanning and push protection, private vulnerability reporting, and approval for workflows from a first-time contributor's fork. A private repository skips the ones GitHub's Free plan offers to public repositories only. | No                                                      |
| `ci`               | `ci.yml` runs on the reference's triggers and ends in a **CI passed** job that runs with `if: always()` and needs every other job, except the ones that only run on `main`. Release runs CI before releasing.                                                                                                                            | A job missing from `needs`                              |
| `pinned-actions`   | Every action and shared workflow is pinned to a commit SHA with a `# vX.Y.Z` comment, at the release the reference uses. Ahead of the reference is a warning: the reference changes first.                                                                                                                                               | Yes, for the actions the reference uses                 |
| `shared-workflows` | The workflows that only call modulane/workflows match the reference line for line, apart from their pins and inputs. Every other call the reference makes, such as **Release notes**, is there too.                                                                                                                                      | Yes, keeping the repository's own inputs                |
| `release`          | `release.yml` names this repository instead of `REPO-NAME`, and `.releaserc.json` uses the reference's plugins, with `@semantic-release/npm` allowed for a package on npm.                                                                                                                                                               | Yes, except a release limited to another repository     |
| `dependabot`       | The `github-actions` update in `.github/dependabot.yml` matches the reference. Updates for other ecosystems are allowed.                                                                                                                                                                                                                 | Yes, keeping the other updates                          |
| `labels`           | `.github/labels.json` has every reference label, with the same color and description. Labels of its own are allowed.                                                                                                                                                                                                                     | Yes, keeping the repository's own labels                |
| `files`            | `.editorconfig`, `.gitattributes` and `CODEOWNERS` match, the pull request template has every section and box of the reference, and there is a `LICENSE`.                                                                                                                                                                                | Yes: missing sections and boxes are added where they go |

A failure (`✗`) is drift. A warning (`!`) is a difference worth a look that does not fail the run, a skip (`–`) is a part that could not be checked, and `~` is a difference the repository accepts. The fixes edit the files as text, so their comments and formatting stay as they are.

## Pull requests for drift

[modulane/workflows](https://github.com/modulane/workflows#repo-check) runs repo-check every Monday in each repository that calls its `repo-check.yml`, as repo-template does. It uses a GitHub App token, because the pull request changes workflows and its checks must run, which `GITHUB_TOKEN` can do neither of.

Outside modulane, create a GitHub App with read access to administration and write access to contents, pull requests and workflows, install it on your repositories, and call the shared workflow with its client ID and private key, as [repo-template's `repo-check.yml`](https://github.com/modulane/repo-template/blob/main/.github/workflows/repo-check.yml) does. Without an App, run the action from your own workflow with another token, or the command line.

The pull request is titled `ci: catch up with repo-template`, so merging it releases nothing. Its description lists what it fixes and what is still left for a maintainer, and ticks **No AI tool was used**: the fixes come from the reference as they are.

## Accepted differences

A repository lists the differences it keeps on purpose in `.github/repo-check.yml`, each with its reason:

```yaml
accept:
  - finding: 'rulesets:main ruleset:required_status_checks.required_status_checks'
    reason: This repository runs its workflows directly, so its required checks have no caller prefix.
  - finding: 'files:template-box:*'
    reason: The checklist names the package a pull request releases.
```

`finding` is the id printed in brackets next to each failure and warning, such as `labels:bug` or `settings:allow_merge_commit`, and `*` matches any text. An accepted finding neither fails the run nor gets fixed. An entry that no longer matches anything is a warning, so the list never keeps a difference that is gone.

## Action

```yaml
- uses: modulane/repo-check@<sha> # vX.Y.Z
  with:
    token: ${{ steps.app-token.outputs.token }}
    pull-request: true
```

| Input          | Default                             | What it does                                                                                                                                                                                                     |
| -------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`        | `GITHUB_TOKEN`                      | Reads the repository and the reference. With `pull-request`, it needs write access to contents, pull requests and workflows, and read access to administration for the rulesets, settings and security settings. |
| `reference`    | `modulane/repo-template`            | The reference setup, as `owner/repo[@ref]` or a path in the workspace                                                                                                                                            |
| `repository`   | The repository the workflow runs in | The repository to check                                                                                                                                                                                          |
| `pull-request` | `false`                             | `true` to open, update or close the pull request with the fixes                                                                                                                                                  |
| `branch`       | `repo-check`                        | The branch of the pull request                                                                                                                                                                                   |
| `only`         | All checks                          | Run only these checks, separated by commas                                                                                                                                                                       |

| Output         | Value                                                 |
| -------------- | ----------------------------------------------------- |
| `drift`        | `true` when the repository differs from the reference |
| `pull-request` | The URL of the pull request, when one is open         |

Each finding left after the pull request is an annotation on the run, and the run's summary lists them. Without `pull-request`, every failure fails the run; with it, only the ones the pull request cannot fix.

## Command line

Run it in a clone of the repository to check:

```bash
npx @modulane/repo-check
npx @modulane/repo-check --fix
```

```text
Checking modulane/ai-disclosure against modulane/repo-template

Pinned actions
  ✗ modulane/workflows/zizmor.yml is at v1.0.0, the reference at v1.2.0. (.github/workflows/zizmor.yml:16) (fixable) [pinned-actions:.github/workflows/zizmor.yml:modulane/workflows/zizmor.yml]

Shared workflows
  ✗ .github/workflows/release.yml does not call modulane/workflows/release-notes.yml, as the reference's "Release notes" job does. (fixable) [shared-workflows:.github/workflows/release.yml:release-notes.yml]

…

3 of 11 checks found drift.
```

```text
repo-check [target] [options]

  target                 A local clone (default: the current directory), or
                         owner/repo[@ref] to read the files from GitHub

  --reference <source>   The reference setup: owner/repo[@ref] or a local
                         clone (default: modulane/repo-template)
  --repo <owner/repo>    The GitHub repository whose rulesets and settings are
                         checked (default: the target, or its origin remote)
  --only <checks>        Run only these checks, separated by commas
  --fix                  Fix what a file change can fix, in a local clone
  --json                 Print the results as JSON
```

The exit code is 0 without drift, 1 with drift, and 2 when the check could not run. With `--fix`, the report shows the repository as it is after the fixes, so drift no file change can fix still exits 1.

To try a change to the reference before it is merged, pass your clone of it: `--reference ../repo-template`.

## GitHub access

The command line reads GitHub with `GITHUB_TOKEN` or `GH_TOKEN`, or else with the token of the [GitHub CLI](https://cli.github.com) when you are signed in. A reference that cannot be read stops the run: GitHub answers a token that cannot see a repository as if the repository did not exist, and an empty reference would match anything.

GitHub only shows the bypass list of a ruleset to repository admins, the security settings to admins, and the merge settings to tokens that can push, so with less access those parts are skipped.

## Development

```bash
corepack enable
yarn install
yarn check
yarn build
```

`yarn check` runs Prettier and the tests. The tests use in-memory repositories and a fake GitHub API, so they need no network and no token. `yarn build` bundles the action into `dist/action.js`, which is committed: the action runs it as it is, and CI fails when it does not match the source.

## License

[MIT](LICENSE)
