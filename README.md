# PocketLedger

PocketLedger is a privacy-conscious personal-finance mobile application. Its first
release lets an authenticated user organize categories, manually record income and
expenses, review a dashboard, and import a CSV statement after previewing it.
The mobile app supports email/password and native Google sign-in with persistent
PocketLedger sessions in platform secure storage. Categories use the authenticated
API after session verification. Native Google/device acceptance still needs OAuth
setup and a development build. See the [authentication plan](docs/authentication-plan.md)
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
- An Expo development build on an Android/iOS device or emulator/simulator for
  authentication; Expo Go and web remain available for the isolated demo
- Docker Desktop or Rancher Desktop for the local PostgreSQL service

Docker is required only for the local database. Demo and email/password development
need no cloud account or production credentials. Google needs the OAuth setup below.

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

The mobile app verifies saved credentials before rendering protected navigation.
Native sign-in connects category list/add/edit/archive to the owner-scoped API.
Category lists traverse every page, including archived history. Logout clears
device credentials and revokes the server session when reachable. Transient
failures preserve credentials; an uncertain refresh requires explicit sign-in
recovery rather than replaying a possibly consumed token.

The separately labeled demo uses temporary in-memory categories and makes no API
requests. Transactions support add/edit/delete and filtered history in both modes.
Dashboard and import remain screen previews.
Web is demo-only. Archive requires confirmation and preserves history.

Run `npm run dev:mobile` for the development client. Use
`npm run dev --workspace=@pocketledger/mobile -- --go` for an SDK-compatible Expo Go
demo (native Google is unavailable there).
From `apps/mobile`, `npm run android` opens an available Android target,
`npm run ios` needs a macOS iOS simulator, and `npm run web` opens the web preview.
Each demo screen offers loading/empty/error previews; Settings also offers a
rendering-error recovery exercise and a demo exit button.

`npm run typecheck --workspace=@pocketledger/mobile` generates ignored Expo route
types before checking strict TypeScript, including negative navigation assertions.
`npm run test --workspace=@pocketledger/mobile` runs Expo/Jest screen and navigation
tests and requires tests to exist. See the [Issue #9 walkthrough](docs/issue-9-implementation-walkthrough.md)
for file responsibilities, commands, learning notes, and device-verification limits.

## Local PostgreSQL

Issue #4 provides a development-only PostgreSQL container. Issue #6 adds the
Prisma schema, migrations, synthetic seeds, and a database client factory.
The API exposes health, authentication, owner-protected categories, transaction CRUD,
and date-range dashboard summaries. The import API comes later.

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

There are four migrations: the original finance schema, the additive
authentication upgrade with `AuthIdentity`, `Session`, and `RefreshToken`, then
Google nonce challenges, recent-reauthentication state and normalized email uniqueness,
then active category-name uniqueness and archived-category assignment protection.
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
The demo requires no credentials. Native authentication needs public API/OAuth
configuration; the API requires validated server configuration.

GitHub Actions runs the **`quality`** check on pull requests to `main` and pushes
to `main`: locked install, formatting, lint, type checks, unit/integration test
commands, Prisma validation/generation, and API/shared builds. Database integration
tests apply migrations from zero and test ownership and authentication. API unit
tests verify contracts, safe errors/logs, rate limiting and local Google signatures;
mobile tests cover sessions, client boundaries, category UI and navigation; the shared suite still permits zero
tests. Generated OpenAPI is a separate CI
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

## Category management (Issue #10)

All category routes require a real PocketLedger bearer token. The server derives
the owner from that session; request bodies never accept `userId`.

| Method and path                   | Behavior                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/categories`              | Active owned categories. `status=archived` or `all` includes history; `limit` is 1–100 (default 50); pass `nextCursor` as `after` for the next page. |
| `GET /v1/categories/:id`          | Owned category, including archived; foreign and missing IDs both return 404.                                                                         |
| `POST /v1/categories`             | Create with `{ "name": "Groceries" }`; returns 201.                                                                                                  |
| `PATCH /v1/categories/:id`        | Rename an active category with `{ "name": "Food" }`.                                                                                                 |
| `POST /v1/categories/:id/archive` | Send `{}` after confirmation; repeated archive preserves its timestamp.                                                                              |

Names collapse ASCII whitespace and trim it, preserving display case. Active
duplicates compare ASCII letters without case, within one owner. Non-ASCII
letters, accents and Unicode normalization forms remain distinct. Names must
contain visible text, have 1–100 UTF-16 units after normalization, and contain no
control/format/surrogate characters; raw input is bounded at 1000 units.
Duplicates return 409 `CATEGORY_NAME_CONFLICT`; archived renames return 409
`CATEGORY_ARCHIVED`; invalid inputs return 422. No delete or restore route exists.

Archiving retains the ID and historical transaction association, hides it from
the active selection list, and frees its name for a new category with a different
ID. A database trigger rejects new transaction assignments to archived categories.
History reads must include archived associations; historical renames are not
snapshotted (renaming an active category changes its displayed name on history).

The fourth migration is hand-written and stops atomically on legacy active-name
collisions. Review them explicitly; do not merge IDs or reset data to deploy.
Neither the third nor fourth migration was applied to the development database
as part of this implementation. See the detailed [Issue #10 walkthrough](docs/issue-10-implementation-walkthrough.md)
for the dependency sequence, files, commands, tests and migration review.

## Native sign-in and live categories

Use `apps/mobile/.env.example` as a reference for a new ignored
`apps/mobile/.env.local`; preserve existing files. Set `EXPO_PUBLIC_API_URL` to an
API origin with no path, query or credentials. Production requires HTTPS. For an
Android development build using synthetic data on a private LAN, you may explicitly
set `EXPO_PUBLIC_ALLOW_LOCAL_HTTP=true` and use `http://<computer-LAN-IP>:3000`.
Rebuild after changing native configuration. A phone's `localhost` is the phone.
Use HTTPS for iOS device testing.

Email/password works without Google configuration once the API and its reviewed
migrations are ready. Account creation requires a 12–128 character password.
Use synthetic test identities and records.

Google additionally requires a Google Cloud project, an OAuth consent screen with
your test account, a Web OAuth client ID, and an Android OAuth client registered for
`com.shokoobid.pocketledger` and the development build's SHA-1 signing fingerprint.
Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; configure that Web ID in the backend's
`GOOGLE_CLIENT_IDS` and the applicable native/Web authorized presenter IDs in
`GOOGLE_PRESENTER_IDS`. For iOS register the same bundle identifier and set
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Client IDs are public; client secrets and signing
keys must stay out of the app. No Google project is created by this implementation.

The selected `react-native-nitro-google-signin` package uses Android Credential
Manager. The app passes the server's fresh challenge nonce into explicit native
sign-in and exchanges the proof for PocketLedger credentials.

With Android Studio/SDK, Java and USB debugging configured, run from `apps/mobile`:

```powershell
npx expo run:android --device
# After the development binary is installed:
npm run dev -- --dev-client
```

Alternatively, after configuring an Expo/EAS account and public build environment,
`npx eas-cli build --platform android --profile development` builds an installable
APK using `eas.json`. Cloud builds and account/project creation are manual steps.
iOS native builds require macOS/Xcode or EAS and Apple provisioning.
Native Google login cannot run in Expo Go. See the [Issue #11 walkthrough](docs/issue-11-implementation-walkthrough.md)
for signing fingerprints, restart/logout tests, file responsibilities and limits.

`npm run test:integration` now runs API database tests followed by the real portable
mobile client against Fastify and disposable PostgreSQL. It uses only
`TEST_DATABASE_URL`, never the development database. These tests verify the live
contracts; OS storage and provider/device behavior still need native verification.

## Transactions (Issue #12)

Verified sessions can list, add, edit and delete income/expenses. Demo transactions
stay in memory for the current demo session. Dashboard and CSV import remain previews.
No new migration is required; the existing category/history migration must be deployed
before running this feature against a development database.

| Method and path               | Contract                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/transactions`        | Owned rows, newest calendar date first, then UUID descending. `limit` 1-100, default 50. Pass `nextCursor` as `after`. |
| `GET /v1/transactions/:id`    | Owned row; foreign/missing IDs both return 404.                                                                        |
| `POST /v1/transactions`       | Create; returns 201 with the saved row.                                                                                |
| `PATCH /v1/transactions/:id`  | Partial update with at least one field; omitted fields stay unchanged.                                                 |
| `DELETE /v1/transactions/:id` | Delete owned row; returns `{ "ok": true }`. Mobile asks for confirmation.                                              |

Create fields: `direction` (`income`/`expense`), positive `amountMinor` integer
(1-2147483647), `currency`, `date` (`YYYY-MM-DD`, real calendar day, years 0001-9999),
`categoryId`, `merchant`, and optional nullable `note`. Merchant requires visible
text and at most 200 UTF-16 units; note allows 2000. Text is preserved, with control,
format and unpaired surrogate characters rejected. No owner/import fields are accepted.
Supported currencies are USD, EUR, GBP, INR (two decimal places), JPY (zero), and
KWD (three). Other codes are rejected. Decimal input is converted by concatenating
digits and checking the resulting integer; no floating-point monetary construction.

List filters combine with AND: `direction`, `categoryId`, and inclusive `from`/`to`.
Supply both dates or neither; a range may span at most 366 days. Pagination uses
`YYYY-MM-DD_UUID` sort boundaries and is live, not a snapshot: editing dates during
paging can move rows. Refresh to reconcile concurrent changes. Archived categories
remain readable; retaining an existing historical association during an edit is
allowed, while a new/different assignment requires an active owned category.

Failed submissions retain form values. Pending submissions are locked. An ambiguous
write requires reloading and reviewing saved rows before explicitly enabling another
write; there are no automatic network write retries or idempotency keys. A confirmed
save appears immediately, even if the subsequent list reload fails. Logout/account
changes unmount transaction data alongside category data. Routine API logs contain
no transaction bodies, IDs, date/category queries or credentials.

## Dashboard summary API (Issue #14)

`GET /v1/dashboard/summary?from=2026-10-01&to=2026-10-31&currency=USD`
requires a real PocketLedger bearer session. The mobile dashboard remains a preview;
this issue implements its backend API.

Required `from` and `to` are inclusive `YYYY-MM-DD` calendar dates (years 0001-9999),
ordered and at most 366 days apart, matching the history endpoint's bound.
Both endpoints are included, so the maximum is 367 included calendar dates.
For a monthly summary, send the month's first and last dates. These are dates in
the user's intended accounting calendar: the API does not shift them using the
server timezone, UTC offsets or daylight-saving rules. Audit timestamps do not
determine inclusion. No `timezone` parameter or implicit current month is accepted.

Required `currency` selects one supported currency (USD/EUR/GBP/INR/JPY/KWD).
All totals, categories and recent rows use that currency and period. There is no
conversion or mixed-currency grand total. Optional `recentLimit` is 1-20 (default 5).
Unknown query fields, including `userId`, are rejected with 422.

The response contains `from`, `to`, `currency`, `incomeMinor`, `expensesMinor`,
`netMinor`, `categoryBreakdown`, and `recentTransactions`. Income and expenses are
nonnegative integer minor units; net is income minus expenses and can be negative.
Each category entry has `categoryId`, `categoryName`, and those three totals.
Only categories with matching transactions appear, including archived categories;
names are current, not historical snapshots. Categories sort by UUID ascending.
Recent rows use the existing transaction response shape, sorted by date descending
then UUID descending. Totals cover every match regardless of `recentLimit`.

Empty periods return zero totals and empty arrays. Reads share one database snapshot.
Aggregates use exact integers and return 422 `SUMMARY_AMOUNT_OUT_OF_RANGE` if any
total exceeds JavaScript's safe integer range; amounts are never silently rounded.
The existing owner/date/ID index supports these queries; no migration is added.
Responses remain `Cache-Control: no-store`, and logs exclude financial payloads.

See the [detailed Issue #14 walkthrough](docs/issue-14-implementation-walkthrough.md)
for the workflow, file responsibilities, SQL, interview concepts and checks.
