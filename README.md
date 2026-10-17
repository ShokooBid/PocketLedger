# PocketLedger

PocketLedger is a privacy-conscious personal-finance mobile application. Its first
release lets an authenticated user organize categories, manually record income and
expenses, review a dashboard, and import a CSV statement after previewing it.

The project is intentionally being designed before implementation. The current
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
```

### Workspace layout

```text
apps/mobile       Expo + React Native app
apps/api          Node.js API workspace (Fastify is introduced in Issue #8)
packages/shared   Portable shared types, schemas, and utilities
```

Do not import server-only modules, database clients, or secrets from
`packages/shared`; it is used by both the API and mobile app.

### Commands

| Command                    | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `npm run dev:mobile`       | Start the Expo development server.                 |
| `npm run dev:api`          | Run the API workspace bootstrap in watch mode.     |
| `npm run dev`              | Run every available workspace development command. |
| `npm run format`           | Format supported files with Prettier.              |
| `npm run format:check`     | Verify formatting without changing files.          |
| `npm run lint`             | Lint the repository.                               |
| `npm run typecheck`        | Type-check each workspace.                         |
| `npm run test`             | Run each workspace's test command.                 |
| `npm run test:integration` | Run the API integration command (suite pending).   |

The mobile app intentionally contains only a minimal launch screen. Navigation,
screens, and API integration are subsequent issues.

## Local PostgreSQL

Issue #4 provides a development-only PostgreSQL container. It is not a
production deployment, does not add Prisma or application database access, and
does not load the configuration into the API yet.

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

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the supported development baseline,
branch/PR workflow, local checks, dependency review, and GitHub settings to inspect.
The repository includes [.env.example](.env.example) for local PostgreSQL;
the API/mobile bootstrap does not require an environment file.

GitHub Actions runs the **`quality`** check on pull requests to `main` and pushes
to `main`: locked install, formatting, lint, type checks, unit/integration test
commands, and API/shared builds. Tests currently permit zero tests; the API
integration suite will arrive with API implementation. See the
[Issue #5 walkthrough](docs/issue-5-implementation-walkthrough.md) for how CI
works and the [required-check setup](CONTRIBUTING.md#github-actions-and-required-checks).

Report vulnerabilities privately using [SECURITY.md](SECURITY.md).
The step-by-step [Issue #3 walkthrough](docs/issue-3-implementation-walkthrough.md)
explains the repository safeguards and their verification.
