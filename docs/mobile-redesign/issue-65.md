# Issue #65: persisted currency preferences

Issue: [#65](https://github.com/ShokooBid/PocketLedger/issues/65).
Date: 2026-10-30. Implementation branch: `feat/issue-65-currency-preferences`.

## Product decisions for this increment

The user confirmed that the #64 rollout gate stays in place. Existing records are
disposable test data; no legacy-currency inference or mixed-history choice screen
is required. This implementation targets fresh test ledgers and does not delete
development records automatically.

`FINANCE_CURRENCY_ENABLED=false` and
`EXPO_PUBLIC_FINANCE_CURRENCY_ENABLED=false` keep the persisted flow dormant.
Enable both only for isolated preview/testing until #68–#69 provide the accounts
and account-aware finance compatibility gate. The mobile flag is bundled by Expo;
restart/rebuild after changing it. Already activated owners retain their enforced
currency even if the API flag is subsequently disabled.

## Implemented behavior

- Owner-scoped `FinancePreferences` stores `entryCurrency` (default CAD) and an
  irreversible `currencyLockedAt`. Settings changes persist across sessions and
  client recreation. Supported currencies are CAD, USD, EUR, GBP, INR, JPY and KWD;
  CAD uses two decimal places with exact integer minor-unit parsing.
- Authenticated `GET /v2/preferences` returns
  `{ entryCurrency, currencyLocked, defaultAccountId: null }`.
  `PATCH /v2/preferences` accepts only `{ entryCurrency }`. It rejects unsupported
  codes and injected owner/lock/account fields. A locked change returns
  `409 CURRENCY_LOCKED`; setting the already selected currency is a safe no-op.
- Preferences load before finance screens can construct a draft. Settings writes
  wait for server confirmation. An uncertain write retains the last confirmed
  currency, disables further changes/saves and requires an explicit reload.
  A refresh failure after initialization retains mounted drafts.
- Entry shows one currency. If Settings changes while an unsaved draft exists,
  its amount and currency remain untouched and Save is blocked. The user can
  retain it and return to Settings, or explicitly discard it and start a fresh
  draft in the new currency. Saved transactions retain their recorded currency.
- The API serializes preference changes and postings with a per-owner database
  lock. A transaction insert trigger validates the selected currency and sets
  the lock in the same database transaction. Failed validation/rolled-back writes
  do not lock it. Deleting transactions never clears the lock. Activated owners
  cannot bypass enforcement using the current v1 transaction endpoint.
- Demo uses temporary CAD preferences with the same first-save lock, does not
  call the preferences API, and resets with the demo session. Session-keyed
  providers and generation-scoped clients isolate users and ignore late replies.

The migration is additive and does not activate existing users. With the preview
enabled, fresh owners initialize to CAD. Existing CAD-only transactions initialize
the preference as locked. A non-CAD history returns `CURRENCY_SETUP_REQUIRED`
without changing amounts, currencies or ownership. Use a fresh test ledger for
preview instead of silently relabeling old money.

## Account and version boundaries

There is no financial Account model yet, so `defaultAccountId` is explicitly null
and cannot be patched in this increment. #68 adds accounts and opening balances;
#69 must clear incompatible default accounts when changing currency while keeping
their recorded currency/balance. #70 adds account management. This policy is
specified in [finance contracts](finance-contracts.md), not simulated with a
temporary account implementation.

Only `/v2/preferences` is added to the mobile transport allowlist. Authentication,
transaction CRUD and dashboard remain v1. Merchant input stays required until
#69 implements its removal and migration gate. The redesigned entry home and
custom keypad remain #72. No FX, imports or functional AI are added here.

## Verification

Behavior tests cover API authentication/ownership, strict validation, persistence,
first-save races, rollback, permanent locks, rollout-off compatibility, mobile
initial loading, uncertain-write recovery, stale replies, explicit draft
replacement, demo parity and exact CAD parsing. A mobile integration test runs
the real mobile adapters against the API and disposable PostgreSQL.

Checks completed locally:

| Check                                                                          | Result                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| API unit tests (`vitest run`, API workspace)                                   | 38 passed                                                                |
| API integration (`vitest.integration.config.ts`)                               | 65 passed across six suites, including migrations from zero and upgrades |
| Mobile unit/navigation tests (`npm run test --workspace=@pocketledger/mobile`) | 143 passed across 12 suites                                              |
| Mobile integration (`vitest.integration.config.ts`)                            | 7 passed using the real API and disposable PostgreSQL                    |
| Repository ESLint; API tools/mobile TypeScript checks                          | Passed                                                                   |
| Repository Prettier check; `git diff --check`                                  | Passed                                                                   |
| Prisma format, validation and client generation                                | Passed                                                                   |
| API build and generated OpenAPI                                                | Passed                                                                   |
| Offline Expo export with preview enabled                                       | Android, iOS and web passed                                              |

Run navigation tests from the mobile workspace, as the npm workspace command
does: the harness discovers routes relative to its current directory. The normal
mobile test command passed with the repository's default timeout. No
physical-device/emulator verification was performed; bundle exports and
renderer/navigation tests are not device acceptance.

No migrations have been applied to the developer database, and no test records
have been removed from it. No commit, push, PR or GitHub issue closure is automatic.
