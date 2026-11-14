# PocketFinance

A personal-finance mobile app for tracking income, expenses, and monthly spending
across financial accounts. Built with React Native, Expo, TypeScript, and a
Fastify/PostgreSQL API.

PocketFinance focuses on accurate money handling, explicit data ownership, and
secure mobile sessions. An isolated demo lets you explore the app without an
account or a running backend.

**Status:** Pre-release portfolio project. Core manual tracking is implemented;
CSV import is a UI placeholder. Use synthetic data when evaluating the app.

## What you can do

- Sign in with email/password or Google on a configured native build; restore
  sessions from secure device storage and sign out on one or all devices.
- Choose a permanent ledger currency and create financial accounts with opening
  balances and an optional default account.
- Organize transactions with shared default categories and personal categories,
  including subcategories and archival that preserves history.
- Add, edit, delete, and filter income and expenses by account, category, date,
  direction, and currency.
- Review monthly income, expenses, net totals, category spending, and recent
  transactions.
- Explore categories, transactions, and summaries in a temporary in-memory demo.

## Try the demo

Use Node.js 22.x (at least 22.13; see [.nvmrc](.nvmrc)) and npm 10.x.
From the repository root:

```sh
npm ci
npm run dev --workspace=@pocketfinance/mobile -- --web
```

Choose **Explore demo screens without signing in** on the sign-in screen. No database, environment file, or
credentials are required. Demo changes are temporary and make no API requests;
web supports demo mode only.

For an SDK-compatible Expo Go demo, run
`npm run dev --workspace=@pocketfinance/mobile -- --go`.
For the API, PostgreSQL, and native authentication setup, see
[DEVELOPMENT.md](DEVELOPMENT.md).

## Architecture and engineering decisions

```text
React Native / Expo -> Fastify REST API -> PostgreSQL
  secure sessions       Zod contracts      Prisma + SQL migrations
```

The mobile client validates API responses without importing server or database
modules. The API publishes an OpenAPI contract from its route schemas and enforces
server-side authorization.

- **Exact money:** amounts use integer minor units with currency-specific decimal
  parsing. Account currency determines transaction currency; reports never combine
  currencies into a converted total.
- **Data ownership:** authenticated sessions determine the ledger owner. Service
  checks and database constraints protect account and transaction relationships;
  shared default categories remain visible across users.
- **Explicit retry handling:** transaction creation uses a request UUID and an
  immutable creation fingerprint to recognize equivalent retries. Protection lasts
  while the transaction exists; hard deletion releases the key.
- **Session recovery:** refresh-token rotation, server revocation, and secure
  credential storage are handled outside UI rendering. Ambiguous refresh outcomes
  require explicit sign-in recovery.
- **Accounting dates:** transactions use calendar dates rather than converting
  accounting days through server timezones.

## Explore the code

| Area                  | Start here                                                                                                | What to look for                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| API composition       | [app.ts](apps/api/src/app.ts)                                                                             | Route registration, dependencies, and error handling.             |
| Transaction rules     | [service.ts](apps/api/src/transactions/service.ts)                                                        | Ownership, validation, and retry identity.                        |
| Database design       | [schema.prisma](apps/api/prisma/schema.prisma) and [migrations](apps/api/prisma/migrations)               | Relationships, indexes, and SQL-enforced invariants.              |
| Mobile authentication | [session-controller.ts](apps/mobile/src/auth/session-controller.ts)                                       | Session lifecycle and injected storage/provider boundaries.       |
| Mobile dashboard      | [dashboard.tsx](apps/mobile/src/dashboard.tsx) and [dashboard-data.ts](apps/mobile/src/dashboard-data.ts) | Rendering separated from date, money, and data-source logic.      |
| Integration tests     | [API tests](apps/api/tests/integration)                                                                   | Real PostgreSQL migrations, authorization, and finance contracts. |
| Delivery checks       | [quality.yml](.github/workflows/quality.yml)                                                              | Automated validation and generated OpenAPI artifact.              |

## Stack and verification

| Layer       | Tools                                                            |
| ----------- | ---------------------------------------------------------------- |
| Mobile      | React Native, Expo Router, TypeScript, Expo SecureStore          |
| API         | Node.js, Fastify, Zod, REST/OpenAPI                              |
| Persistence | PostgreSQL, Prisma, SQL migrations                               |
| Tests       | Vitest, Jest, React Native Testing Library                       |
| Tooling     | npm workspaces, Docker Compose, ESLint, Prettier, GitHub Actions |

The [quality workflow](.github/workflows/quality.yml) runs formatting, lint, type
checks, unit tests, API/mobile integration tests against PostgreSQL, Prisma
validation/generation, and the API build on pull requests and pushes to `main`.
Native Google sign-in and device accessibility still require manual verification.
See [development checks](DEVELOPMENT.md#verification) for local commands.

## Current boundaries

CSV file selection and import, transfers, bank connections, and offline sync are
not implemented. Google sign-in requires OAuth configuration and a native
development build. Account deletion uses manual contact instructions; automated
deletion and a support response-time commitment are not established.

## Documentation

- [Development guide](DEVELOPMENT.md): database, API, native configuration, and tests.
- [Architecture](docs/architecture.md): system shape and API conventions.
- [Product scope](docs/mvp-scope.md): MVP boundaries and planned capabilities.
- [Authentication plan](docs/authentication-plan.md): account and session design.
- [Mobile redesign](docs/mobile-redesign/README.md): decisions, UX, finance contracts, and verification.
- [Threat model](docs/threat-model.md): trust boundaries and security limitations.
- [Contributing](CONTRIBUTING.md): development baseline and contribution workflow.
- [Security policy](SECURITY.md): private vulnerability reporting.
