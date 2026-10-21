# PocketLedger

PocketLedger is a privacy-conscious personal-finance mobile application. Its first
release lets an authenticated user organize categories, manually record income and
expenses, review a dashboard, and import a CSV statement after previewing it.
The planned MVP supports email/password and Google sign-in with persistent mobile
sessions. The backend implements both methods and session rotation; mobile login
and secure restoration remain Issue #11. See the [authentication plan](docs/authentication-plan.md)
and [implementation walkthrough](docs/issue-7-implementation-walkthrough.md).

The project is implemented incrementally from an accepted design. The current
decisions and product boundaries are documented here:

- [Architecture and API conventions](docs/architecture.md)
- [MVP scope and product boundaries](docs/mvp-scope.md)
- [Lightweight threat model](docs/threat-model.md)

The initial stack is React Native with Expo and TypeScript for mobile; Node.js,
Fastify, PostgreSQL, Prisma, Zod, and REST/OpenAPI for the API; and Docker,
automated tests, and GitHub Actions for delivery.

## Local development

### Prerequisites

- Node.js 22.13 or later
- npm 10 or later (the repository uses npm workspaces)
- Expo Go on an Android/iOS device or an Android emulator/iOS simulator to run the
  mobile app
- Docker Desktop or Rancher Desktop for the local PostgreSQL service

Docker is required only for the local database. No cloud account or production
credentials are required.

### Install

From the repository root:

```sh
npm install
npm run db:generate --workspace=@pocketledger/api
```

### Workspace layout

```text
apps/mobile       Expo + React Native app
apps/api          Fastify API, authentication service, Prisma schema and tests
packages/shared   Portable shared types, schemas, and utilities
```

Do not import server-only modules, database clients, or secrets from
`packages/shared`; it is used by both the API and mobile app.

### Commands

| Command                    | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `npm run dev:mobile`       | Start the Expo development server.                 |
| `npm run dev:api`          | Run the API in watch mode (needs process env).     |
| `npm run dev`              | Run every available workspace development command. |
| `npm run format`           | Format supported files with Prettier.              |
| `npm run format:check`     | Verify formatting without changing files.          |
| `npm run lint`             | Lint the repository.                               |
| `npm run typecheck`        | Type-check each workspace.                         |
| `npm run test`             | Run each workspace's test command.                 |
| `npm run test:integration` | Test migrations and ownership on a disposable DB.  |

The mobile app intentionally contains only a minimal launch screen. Navigation,
screens, and API integration are subsequent issues.

## Local PostgreSQL

Issue #4 provides a development-only PostgreSQL container. Issue #6 adds the
Prisma schema, migrations, synthetic seeds, and a database client factory.
The API now exposes health and authentication routes. Finance routes come later.

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
# Edit .env and replace POSTGRES_PASSWORD with a unique local password.
docker compose up -d db
docker compose ps
```

`Copy-Item` creates your local configuration file; it is manually created, not
generated, and Git ignores it. `up -d` downloads the PostgreSQL image if needed
and starts the `db` service in the background. `ps` should eventually show the
service as `healthy`; the health check waits for PostgreSQL to accept
connections. The database is reachable only from this computer at
`localhost:<POSTGRES_PORT>` (default `5432`).

Use `docker compose restart db` to restart PostgreSQL without deleting its data.
Use `docker compose stop db` to stop it and `docker compose up -d db` to resume
it. The named volume retains data across those commands.

> **Warning:** `docker compose down --volumes` deletes the local PostgreSQL
> volume and permanently erases its database data. Do this only when you intend
> to reset local development data; it cannot be undone unless you made a backup.

See the [Issue #4 walkthrough](docs/issue-4-implementation-walkthrough.md) for
installation choices, each command's purpose, connection details, and a safe
reset procedure.

## Prisma and database tests

The hand-written schema is `apps/api/prisma/schema.prisma`. The generated
Prisma Client stays ignored in `apps/api/src/generated/prisma/`; regenerate it
after installing dependencies or changing the schema. Migration SQL is tracked.

Add `DATABASE_URL` to your existing ignored `.env` using `.env.example` as a
reference; do not overwrite an existing `.env`. Match your local PostgreSQL
credentials and URL-encode reserved characters in the password. To apply the
reviewed migration to your development database when ready:

```powershell
npm run db:validate --workspace=@pocketledger/api
npm run db:generate --workspace=@pocketledger/api
npm run db:deploy --workspace=@pocketledger/api
npm run db:status --workspace=@pocketledger/api
```

`db:deploy` changes the database named by `DATABASE_URL`; inspect that target
first. It applies existing migrations without resetting data. Optional seeds
require `$env:ALLOW_SYNTHETIC_SEED = 'true'` followed by
`npm run db:seed --workspace=@pocketledger/api`; then remove the flag with
`Remove-Item Env:ALLOW_SYNTHETIC_SEED`. Seeds contain fictional records and a
disabled account, not a working login.

There are three migrations: the original finance schema, the additive
authentication upgrade with `AuthIdentity`, `Session`, and `RefreshToken`, then
Google nonce challenges, recent-reauthentication state and normalized email uniqueness.
Google-only users may have no password. The upgrade preserves existing finance
records. Demo seeds
also set `disabledAt`, and never seed provider credentials or usable tokens.

Run integration tests against a separate disposable PostgreSQL service:

```powershell
docker compose -f compose.test.yaml up -d --wait
$env:TEST_DATABASE_URL = 'postgresql://pocketledger_test:disposable_test_password@127.0.0.1:55432/pocketledger_test'
npm run test:integration
```

**Warning:** each test run creates and then deletes its own randomly named
synthetic database. `docker compose -f compose.test.yaml down` removes the
test container and all of its temporary data. The development Compose service
and its named volume are separate and are not touched. Tests require the explicit
`TEST_DATABASE_URL`; they never fall back to `DATABASE_URL`.

See the [Issue #6 walkthrough](docs/issue-6-implementation-walkthrough.md) for
the ownership constraints, schema choices, generated files, and commands.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the supported development baseline,
branch/PR workflow, local checks, dependency review, and GitHub settings to inspect.
The repository includes [.env.example](.env.example) for PostgreSQL and API setup.
The mobile bootstrap requires no credentials. The API requires validated configuration.

GitHub Actions runs the **`quality`** check on pull requests to `main` and pushes
to `main`: locked install, formatting, lint, type checks, unit/integration test
commands, Prisma validation/generation, and API/shared builds. Database integration
tests apply migrations from zero and test ownership and authentication. API unit
tests verify contracts, safe errors/logs, rate limiting and local Google signatures;
mobile/shared suites still permit zero tests. Generated OpenAPI is a separate CI
artifact. See the
[Issue #5 walkthrough](docs/issue-5-implementation-walkthrough.md) for how CI
works and the [required-check setup](CONTRIBUTING.md#github-actions-and-required-checks).

Report vulnerabilities privately using [SECURITY.md](SECURITY.md).
The step-by-step [Issue #3 walkthrough](docs/issue-3-implementation-walkthrough.md)
explains the repository safeguards and their verification.

## Run the authentication API

Preserve your existing `.env`; manually add the API settings from `.env.example`.
Generate a local signing secret with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`
and paste the result into `ACCESS_TOKEN_SECRET` in that ignored file. Never commit
or share it. Google IDs may stay empty while testing email/password.

The third migration is additive. Review its normalized-email index before applying
it; legacy email collisions stop deployment rather than merge accounts. This task
does **not** apply it to your development database. When you choose to apply it,
inspect your target and run `npm run db:deploy`. Do not reset the database.

From the repository root, explicitly load the ignored configuration:

```powershell
node --env-file=.env --import tsx apps/api/src/index.ts
# Or, after npm run build --workspace=@pocketledger/api:
node --env-file=.env apps/api/dist/index.js
```

`GET /health` is public. Register/login at `/v1/auth/register` and `/v1/auth/login`
with JSON `{ "email": "learner@example.invalid", "password": "synthetic long passphrase" }`.
Use the returned access token as `Authorization: Bearer <accessToken>` for
`GET /v1/me`. Use `/v1/auth/refresh` with `{ "refreshToken": "<refreshToken>" }`
once per token; persist its replacement securely. `/v1/auth/logout` accepts
`{}` for the current session or `{ "allSessions": true }` for all devices.
Use synthetic identities only; the optional disabled seed is not a login account.

`npm run openapi --workspace=@pocketledger/api` writes the generated contract to
`apps/api/dist/openapi.json` without database or Google credentials.
See the [walkthrough](docs/issue-7-implementation-walkthrough.md) for Google
proof/linking requests, lifetimes, maintenance, limitations and command explanations.
