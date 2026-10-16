# Contributing to PocketLedger

PocketLedger is a learning project. Keep each change small enough to understand,
run locally, and review against its issue's acceptance criteria.

## Development baseline

The verified baseline is Node.js 22.19.0 and npm 10.9.3. Use Node.js 22.x with at
least version 22.13 and npm 10.x for this stage. `.nvmrc` records the exact Node
baseline for contributors who use a version manager; it does not install Node.

On Windows with nvm-windows already installed, use `nvm install 22.19.0` and
`nvm use 22.19.0`. On systems with nvm-sh, `nvm install` and `nvm use` can read
`.nvmrc`. A normal Node installation also works; a version manager is optional.

Install the lockfile's dependencies from the repository root:

```powershell
npm ci
```

`npm ci` replaces an existing `node_modules` directory and requires manifests
and `package-lock.json` to agree. Use `npm install` when deliberately changing
dependencies, and review both the manifest and lockfile diff afterward.

The current bootstrap needs no credentials or environment file. `.env.example`
contains commented placeholders for later tickets; copying it does not configure
the API or automatically load environment variables. Future backend secrets must
stay on the server. Values prefixed with `EXPO_PUBLIC_` are client-visible.

## Branch, commit, and pull-request workflow

Start with a clean working tree. If `git status` shows changes you want to keep,
commit them on their own branch or intentionally stash them before switching.
Do not discard another task's changes to make these commands succeed.

```powershell
git switch main
git pull --ff-only origin main
git switch -c chore/issue-3-repository-standards
```

Choose a fresh branch name per issue: `feat/issue-11-categories`,
`fix/issue-12-amount-validation`, `docs/issue-1-architecture`, or
`chore/issue-3-repository-standards`.

Review changes and stage explicit paths rather than automatically staging every
local file:

```powershell
git diff
git status --short
git add CONTRIBUTING.md SECURITY.md .gitignore .env.example .gitattributes .nvmrc .github README.md docs/issue-3-implementation-walkthrough.md
git diff --cached --check
git diff --cached
git commit -m "chore: add repository safeguards and contribution standards (#3)"
git push -u origin chore/issue-3-repository-standards
```

Commit messages use `type: description (#issue)`. Common types are `feat`, `fix`,
`docs`, `test`, `refactor`, and `chore`. The issue reference supplies context;
it does not by itself close the issue.

Open a PR with base `main` and your feature branch as compare. Complete the PR
template, record validation results, and add `Closes #3` to the description only
when the PR completes the issue. Review the final diff before merging.

Another collaborator can review and approve a PR. When working alone, inspect
the diff and checks yourself before merging; marking a draft ready for review
does not constitute an approving review, and authors cannot approve their own PR.
Use squash merge for a concise issue-level history, then update local `main`.

GitHub plan restrictions may prevent enforcement on this private repository.
Follow the branch-and-PR workflow even when GitHub permits direct pushes.
`CODEOWNERS` records responsibility; it does not grant access or enforce a review.

## Local checks before review

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build --workspace=@pocketledger/api
npm run build --workspace=@pocketledger/shared
git diff --check
```

Use `npm run format` to apply formatting, then inspect the changes. `docs/` is
currently excluded from Prettier; review Markdown links and layout manually.
The test runner currently permits zero tests. Say that explicitly in a PR rather
than presenting it as tested product behavior. GitHub Actions CI belongs to
Issue #5; no CI workflow or deployment is configured by this ticket.

Run `npm run dev:api` and `npm run dev:mobile` in separate terminals. The root
`dev` command runs workspace scripts sequentially; it does not launch both
long-running development processes together.

## Secrets and sample data

- Keep `.env` files, keys, tokens, signing files, credential files, and raw logs
  out of commits, issues, screenshots, and PR comments.
- Store local financial imports or database backups in ignored `local-data/` or
  `backups/` directories. Use synthetic-only fixtures in tracked test folders.
- `.gitignore` prevents ordinary addition of untracked matching files; it does
  not remove already-tracked files or prevent `git add -f`.
- If a credential is committed, revoke or rotate it immediately, even in a
  private repository. Coordinate removal and history cleanup privately; deleting
  it in a later commit does not remove it from earlier commits.
- Report vulnerabilities using [SECURITY.md](SECURITY.md).

## Dependency review

`.github/dependabot.yml` schedules weekly npm update PRs after it reaches the
default branch. The root configuration covers the npm workspace lockfile.
Grouped updates reduce PR noise; they still require review and local checks.
Do not auto-merge dependency changes during this learning stage.

Expo, React, and React Native versions must remain compatible. The mobile group
keeps their updates together when available; grouping does not guarantee a valid
SDK combination. For mobile updates, run `npx expo install --check` from
`apps/mobile`, review the SDK's upgrade guidance, and launch the app on a device.
Major upgrades should receive a dedicated issue and compatibility review.

## GitHub settings to inspect separately

These settings are not changed by committing documentation:

1. In repository Settings, find the security/supply-chain settings and inspect
   dependency graph, Dependabot alerts, and Dependabot security updates. Enable
   supported features if you want them; version-update scheduling is provided by
   the YAML file, while alerts/security updates are separate features.
2. Inspect secret scanning and push protection availability. Their availability
   depends on repository visibility, ownership, and plan; do not assume they are
   enabled for this private repository. No plan upgrade or visibility change is
   required to use the local safeguards in this ticket.
3. If code-owner review support is unavailable on the current private-repository
   plan, retain `CODEOWNERS` as an ownership record and request reviews manually.
4. If the repository later becomes public, review its full history for sensitive
   data and configure private vulnerability reporting before publishing it.

See GitHub's [Dependabot configuration reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference),
[code owners documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners),
and [secret scanning availability](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enable-secret-scanning).
