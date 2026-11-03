# Issue #68 — Named financial accounts

Accounts are owned, user-created names such as BMO Chequing or Cash. The descriptive
type is `cash`, `bank`, `credit` or `other`; there are no institution enums, seeded
banks, bank connections or credential requests.

## API and persistence

- `GET /v2/accounts`: active accounts by default; `status=active|archived|all`,
  `limit` 1–100 (default 50), UUID `after` cursor. Returns `items` and `nextCursor`.
- `GET /v2/accounts/:id`: includes opening information, `asOf` (UTC today by
  default) and `balanceMinor`. An explicit date before opening returns 422.
- `POST /v2/accounts`: `name`, `type`, `currency`, `openingDate` and optional
  `openingBalanceMinor` (default zero); returns 201. Currency is copied from
  Settings and asserted atomically, not selected independently. Stale assertions
  return `409 PREFERENCE_CHANGED`.
- `PATCH /v2/accounts/:id`: nonempty name/type patch. Opening balance/date,
  owner and currency are immutable, including before first use. A correction
  workflow requires a separate design. Archived edits return `409 ACCOUNT_ARCHIVED`.
- `POST /v2/accounts/:id/archive` with `{}`: idempotent archival; preserves the
  account and atomically clears it as default. No delete or restore route.
- `PATCH /v2/preferences`: nonempty partial `entryCurrency` and/or nullable
  `defaultAccountId`. Defaults must be owned, active and match the resulting
  currency. Currency changes alone clear incompatible defaults and preserve
  recorded account currencies and amounts. Explicit incompatible defaults return
  `422 INVALID_ACCOUNT`; foreign/missing IDs return the same safe 404.

Signed opening balances range from -2147483647 through 2147483647 minor units;
there is no float/string coercion. Calendar dates span 0001-01-01 through
9999-12-31. Names share category normalization: bounded input, trimmed/collapsed
ASCII whitespace, visible text, 1–100 UTF-16 units. Active normalized names are
unique per owner under ASCII case folding (`409 ACCOUNT_NAME_CONFLICT`). An
archived name can be reused without changing the old account.

Account writes and preference changes serialize on the existing finance owner
lock. The additive migration also enforces owner references, active-name
uniqueness, immutable baselines, eligible defaults and archive/default cleanup
in PostgreSQL. Creating accounts, including nonzero opening balances, creates
no transaction, reports no income and does not lock Settings currency.

## Rollout and issue boundaries

`FINANCE_ACCOUNTS_ENABLED=true` **and** `FINANCE_CURRENCY_ENABLED=true` enable
the backend preview. Both remain false in the committed environment template.
The migration does not activate preferences, provision accounts, assign legacy
history or alter existing financial rows. The development database is not
migrated automatically by this implementation.

#69 owns transaction/account linkage, legacy assignment and the compatibility
gate. Until that linkage exists, no posting can reference an account and account
balance reads return only its opening baseline. #69 must add exact posting
aggregation, matching currency and opening-date guards. #70 owns account
management screens; #71 owns pickers. The mobile preferences parser now accepts
a nullable UUID default so existing Settings remains compatible with selection.

## Verification commands

Run from the repository root in PowerShell. Tests are supplied for the user to
run; they were not executed during implementation.

```powershell
npm run db:generate
npm run db:validate
npm run typecheck --workspace=@pocketledger/api
npm run lint --workspace=@pocketledger/api
npm run test --workspace=@pocketledger/api -- tests/accounts.test.ts
```

The local command loads `.env` and runs both API and mobile integration suites
using disposable schemas in the loopback database. It does not modify public
application rows. Keep local PostgreSQL running.

```powershell
npm run test:integration:local
```

After verification, apply the additive migration to the intended configured
database with `npm run db:deploy` before starting the updated API. Generate the
OpenAPI contract with `npm run openapi --workspace=@pocketledger/api`.
