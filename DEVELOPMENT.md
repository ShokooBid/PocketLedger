# Local development

For a credential-free preview, start with the [README demo](README.md#try-the-demo).
This guide covers the API, local PostgreSQL, and native mobile authentication.
Run commands from the repository root unless stated otherwise. Use synthetic
identities and financial records.

## Prerequisites

- Node.js 22.x, at least 22.13 (the pinned baseline is in [.nvmrc](.nvmrc)).
- npm 10.x; the repository uses npm workspaces.
- Docker Desktop or Rancher Desktop for local PostgreSQL.
- For native testing, Android SDK/Java and a device/emulator, or macOS/Xcode and
  an iOS device/simulator. Google sign-in needs OAuth setup and a development
  build; it cannot run in Expo Go.

## Install

```sh
npm ci
npm run db:generate
```

Prisma Client is generated into the ignored `apps/api/src/generated/prisma/`
directory. Regenerate it after schema changes; commit schema and migration SQL,
not generated files.

## Configure the API and database

If a root `.env` does not exist, create it from the template. In PowerShell:

```powershell
Copy-Item .env.example .env
```

Preserve existing configuration. Edit the ignored `.env`:

1. Replace `POSTGRES_PASSWORD` with a unique local password.
2. Set `DATABASE_URL` to matching local credentials, URL-encoding reserved
   characters in the password.
3. Replace `ACCESS_TOKEN_SECRET` with a locally generated signing secret:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

4. Leave `GOOGLE_CLIENT_IDS` and `GOOGLE_PRESENTER_IDS` empty for password-only
   development. Google setup is described below.

Never commit `.env`, signing secrets, credentials, or real financial data.
Values prefixed with `EXPO_PUBLIC_` are visible to app users and must contain
only public configuration.

Start PostgreSQL and wait for `docker compose ps` to report it as healthy:

```sh
docker compose up -d db
docker compose ps
```

The database binds to this computer's loopback interface, at port 5432 by default.
Inspect `DATABASE_URL` before applying migrations; these commands modify that
database without resetting it:

```sh
npm run db:validate
npm run db:deploy
npm run categories:init
npm run db:status
```

Initialize the shared category catalog after migrations and before serving app
traffic. `categories:init` is repeatable: it inserts missing approved catalog rows
and rejects drift or visible-name conflicts. Registration does not copy categories.

Optional fictional seeds require an explicit opt-in in PowerShell:

```powershell
$env:ALLOW_SYNTHETIC_SEED = 'true'
npm run db:seed
Remove-Item Env:ALLOW_SYNTHETIC_SEED
```

The seeded account is disabled and cannot sign in; register a synthetic identity
through the app or API.

`docker compose stop db` stops the service; `docker compose up -d db` resumes it
with its data intact. **`docker compose down --volumes` permanently deletes the
local database volume.** Use it only for an intentional reset.

## Run the API

```sh
npm run dev:api
```

The root command explicitly loads `.env`. Use `npm run start:api` to run without
watch mode, or build and start the compiled API:

```sh
npm run build --workspace=@pocketledger/api
node --env-file=.env apps/api/dist/index.js
```

The default address is `http://127.0.0.1:3000`. `GET /health` is public.
`POST /v1/auth/register` and `POST /v1/auth/login` accept an email and password;
registration requires a 12-128 character password. Send the returned access token
as `Authorization: Bearer <accessToken>` to authenticated routes such as
`GET /v1/me`. Refresh tokens rotate after use; persist their replacements securely.

Generate the implemented API contract without database or Google credentials:

```sh
npm run openapi --workspace=@pocketledger/api
```

The output is `apps/api/dist/openapi.json`. All finance routes use `/v1` for
preferences, accounts, categories, transactions, and dashboard summaries. Deploy
matching API and mobile revisions together.

## Connect the native app

Create an ignored `apps/mobile/.env.local` using
[apps/mobile/.env.example](apps/mobile/.env.example) as a reference. Preserve any
existing file. The canonical finance API does not need rollout flags.

- Set `EXPO_PUBLIC_API_URL` to an API origin without a path, query, or credentials.
- For Android development with synthetic data on a private LAN, set
  `EXPO_PUBLIC_ALLOW_LOCAL_HTTP=true`, use `http://<computer-LAN-IP>:3000`, and set
  the API's `HOST` to an interface reachable by the device. The default loopback
  binding is reachable only from the API computer. A phone's `localhost` refers
  to the phone itself.
- Use HTTPS for iOS device testing and production. Rebuild after changing native
  configuration.

With Android tooling and USB debugging configured, run from `apps/mobile`:

```sh
npx expo run:android --device
```

After installing the development binary, start its server from the repository root:

```sh
npm run dev:mobile
```

Run the API and mobile servers in separate terminals. The root `npm run dev`
executes workspace scripts sequentially and does not start both long-running
processes together.

Register a synthetic user, explicitly confirm the permanent ledger currency,
and create an active financial account before recording transactions. Opening
balances affect account balances without becoming income.

### Google sign-in

Password authentication works without a Google project. For Google, configure an
OAuth consent screen with a test account and the relevant clients:

- Web OAuth client: set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in mobile configuration
  and include that ID in the API's `GOOGLE_CLIENT_IDS`.
- Android OAuth client: register `com.shokoobid.pocketledger` and the development
  build's SHA-1 signing fingerprint.
- iOS OAuth client: register the same bundle identifier and set
  `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
- API presenters: include the applicable authorized native/Web client IDs in
  `GOOGLE_PRESENTER_IDS`.

Client IDs are public; client secrets and signing keys stay out of the app. Rebuild
after configuring native clients. Verify sign-in, cancellation, session restore,
and logout on a device; mocked provider tests do not establish device acceptance.

## Verification

After installing dependencies and generating Prisma Client:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build --workspace=@pocketledger/api
```

API unit tests use Vitest; mobile tests use Jest with Expo and React Native Testing
Library. Both workspaces require real tests. For focused checks, append
`--workspace=@pocketledger/api` or `--workspace=@pocketledger/mobile` to the
workspace-level `test` or `typecheck` command.

### PostgreSQL integration tests

With local PostgreSQL running and the root `.env` configured:

```sh
npm run test:integration:local
```

This runs both API and mobile integration suites. The runner passes `DATABASE_URL`
to the child process as `TEST_DATABASE_URL`. Each suite creates a random
`pocketledger_test_*` schema, deploys migrations from zero, and drops only its own
schema afterward. Application rows and schemas are preserved. The PostgreSQL role
must be able to create schemas; there is no need to migrate the application schema
first.

For a different local test instance, set `TEST_DATABASE_URL` to a loopback
PostgreSQL URL without query parameters and run `npm run test:integration`.
CI uses its own disposable PostgreSQL service. Native secure storage, Google
provider flows, screen readers, and maximum system font sizes still need device
verification.

## Repository layout

```text
apps/mobile/          Expo app, portable client logic, and UI tests
apps/api/             Fastify services, route contracts, and API tests
apps/api/prisma/      Database schema, migrations, and synthetic seeds
docs/                 Tracked product/security documents and local planning notes
.github/workflows/    Automated quality checks
```

Some local walkthroughs and planning notes under `docs/` are intentionally ignored
by Git. Keep public documentation links pointed at tracked files. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the branch/PR workflow and
[SECURITY.md](SECURITY.md) for vulnerability reporting.
