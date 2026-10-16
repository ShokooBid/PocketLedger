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

No database, cloud account, or credentials are required for this workspace setup.
Docker and PostgreSQL will be introduced in Issue #4.

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

| Command                | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| `npm run dev:mobile`   | Start the Expo development server.                 |
| `npm run dev:api`      | Run the API workspace bootstrap in watch mode.     |
| `npm run dev`          | Run every available workspace development command. |
| `npm run format`       | Format supported files with Prettier.              |
| `npm run format:check` | Verify formatting without changing files.          |
| `npm run lint`         | Lint the repository.                               |
| `npm run typecheck`    | Type-check each workspace.                         |
| `npm run test`         | Run each workspace's test command.                 |

The mobile app intentionally contains only a minimal launch screen. Navigation,
screens, and API integration are subsequent issues.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the supported development baseline,
branch/PR workflow, local checks, dependency review, and GitHub settings to inspect.
The repository includes placeholder-only [.env.example](.env.example); the
current starter does not require an environment file.

Report vulnerabilities privately using [SECURITY.md](SECURITY.md).
The step-by-step [Issue #3 walkthrough](docs/issue-3-implementation-walkthrough.md)
explains the repository safeguards and their verification.
