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
npm run db:generate --workspace=@pocketledger/api
```

`npm ci` replaces an existing `node_modules` directory and requires manifests
and `package-lock.json` to agree. Use `npm install` when deliberately changing
dependencies, and review both the manifest and lockfile diff afterward.

The mobile demo needs no credentials or environment file. Real mobile authentication
requires the public configuration described in README and a native development
build for Google. The API requires
validated database and signing configuration; see README's authentication setup.
The local
PostgreSQL service uses an ignored `.env` copied from `.env.example`; replace its
password placeholder before starting the database. Prisma CLI explicitly reads
the root `.env`; set `DATABASE_URL` using the template without overwriting existing
configuration. The API loads it only when explicitly started with `--env-file`.
Backend secrets stay
on the server. Values prefixed with
`EXPO_PUBLIC_` are client-visible.

## Branch, commit, and pull-request workflow

Start with a clean working tree. If `git status` shows changes you want to keep,
commit them on their own branch or intentionally stash them before switching.
Do not discard another task's changes to make these commands succeed.

```powershell
git switch main
git pull --ff-only origin main
git switch -c chore/issue-3-repository-standards
```

Choose a fresh branch name per issue: `feat/issue-11-mobile-auth`,
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
npm run test:integration
npm run build --workspace=@pocketledger/api
npm run build --workspace=@pocketledger/shared
git diff --check
```

Use `npm run format` to apply formatting, then inspect the changes. `docs/` is
currently excluded from Prettier; review Markdown links and layout manually.
The shared unit runner still permits zero tests; API and mobile tests require real
cases. Mobile uses Jest with Expo's preset; API/shared use Vitest. Mobile type checks
generate ignored route declarations first, so clean checkouts and CI validate the
same navigation contracts. Say which tests ran in a PR. The API integration suite
tests migrations from zero, ownership constraints, synthetic seeding and
authentication behavior. Start the
separate test service and set `TEST_DATABASE_URL` as described in
[README](README.md#prisma-and-database-tests) before running it locally. It creates
and deletes only randomly named databases inside that disposable service. The mobile
integration suite also runs its actual session/client/category adapter against
Fastify and a disposable database; native storage/provider boundaries are mocked
separately in Jest. Put future
integration tests in `apps/api/tests/integration/**/*.test.ts`; the API unit-test
command excludes this directory. Use only a disposable test database and
synthetic records. Integration and API unit tests do not permit zero tests; remove
`passWithNoTests` from remaining suites when those gain real tests. Prisma Client
generation must run before type checks or builds; do not commit generated client
files. Type checks include database tests, seed scripts, and Prisma configuration.

## GitHub Actions and required checks

[Quality checks](.github/workflows/quality.yml) runs for pull requests targeting
`main` and pushes to `main`, including documentation-only changes. Its single
job has the stable check name **`quality`**. It installs the lockfile with
`npm ci`, validates the schema and generates Prisma Client, then runs formatting,
lint, type checks, unit tests, the API integration
command, and the API/shared builds. Each command must exit successfully; a failed
step fails the job and skips later normal steps. Native Android/iOS builds and
device testing remain separate from these TypeScript build checks.

CI reads Node from `.nvmrc` and verifies npm 10.9.3. It caches only npm's download
cache using `package-lock.json`, not `node_modules`, `.env`, or database storage.
The temporary PostgreSQL 16 service uses disposable CI-only credentials and is
removed with the job. Your local Compose database and `.env` are never used.
No production credentials, cloud account, Expo account, or repository secrets
are required. The workflow token has only `contents: read`, checkout does not
persist its credentials, and actions are pinned to reviewed full commit SHAs.

The `quality-check-summary` artifact is retained for seven days.
Its allowlisted `checks.json` contains step outcomes and a test-coverage caveat;
it does not contain test stdout, raw logs, financial records, environment values,
database dumps, or the workspace. A separate `pocketledger-openapi` artifact
contains only the generated public route contract. Keep test logs synthetic and free of secrets,
because Actions still displays command output. Database integration coverage does
not imply native/mobile flow coverage. API auth is covered with synthetic identities
and local signing keys; native Google sign-in is tested separately in Issue #11.

After you push the branch and create its PR, inspect the `quality` check. Verify
a deliberate formatter/lint/type/test failure is red, remove that temporary
change, then verify the final revision is green. See the
[Issue #5 walkthrough](docs/issue-5-implementation-walkthrough.md) for the exact
failure exercise and handoff checklist. Commits, pushes, and PR creation remain
the contributor's responsibility.

In repository Settings > Branches (or Rules > Rulesets), inspect existing rules
for `main` before editing them. If your plan and permissions support enforcement,
require a pull request and the **`quality`** status check from GitHub Actions
before merging; select it after its first run makes it available. Preserve any
existing protections. After merge, verify that the push to `main` also runs CI.
If protection is unavailable on the private repository, record that limitation
in the PR and manually enforce a green check. Workflow YAML alone does not
enable branch protection. These repository settings and the live failure
exercise must be verified on GitHub before calling Issue #5 fully validated.

During Issue #5 inspection on 2026-10-17, GitHub reported `main` as unprotected
and rejected ruleset access with an instruction to upgrade the private
repository's plan or make it public. Enforcement is therefore unavailable on
the current plan. Keep the repository private and manually require a green
`quality` check; revisit settings if the plan changes.

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
