# Mobile redesign: decisions and implementation contract

Issue: [#64](https://github.com/ShokooBid/PocketLedger/issues/64).
Decision date: 2026-10-30. Status: product questions answered; specification ready
for implementation review. These documents specify future behavior, not features
already shipped.

Read the [UX specification](ux.md) and [finance contracts](finance-contracts.md)
together. Follow-up issues implement the screens, services and migrations; #64
does not change runtime behavior, schema or generated OpenAPI.

The implementation increments are tracked in
[#65](https://github.com/ShokooBid/PocketLedger/issues/65),
[#66](https://github.com/ShokooBid/PocketLedger/issues/66),
[#67](https://github.com/ShokooBid/PocketLedger/issues/67), and
[#69](https://github.com/ShokooBid/PocketLedger/issues/69).
The #69 cleanup supersedes the earlier rollout/version instructions: current
finance uses one `/v1` contract without feature flags. The linked GitHub issues
preserve the implementation history. Settings accounts and account-linked entry are wired
to the live API; custom presentation, transfers and statement processing remain
future work.

## Live History implementation (2026-11-10)

Issue [#75](https://github.com/ShokooBid/PocketLedger/issues/75) adds live filtered,
date-grouped History, category icons, logical transfer pagination, full-day totals
and parent/exact Overview breakdowns. The current
[#106](https://github.com/ShokooBid/PocketLedger/issues/106) branch connects
confirmed saves and row selection to the shared Add/Edit editor. Finish
[#77](https://github.com/ShokooBid/PocketLedger/issues/77) after #106 and #76.
The #75 increment leaves demo implementations unchanged and has no schema/migration
changes. Tests are supplied for the owner to run; static checks are recorded in
[verification](verification.md#issue-75-live-history-implementation).

## Finance foundation revision (2026-11-06)

Issue [#93](https://github.com/ShokooBid/PocketLedger/issues/93) implements explicit,
permanent currency selection followed by required active-account setup. CAD is
preselected in the form but is not saved until confirmed. Settings is read-only
for currency, and all transaction routes are blocked when no active account
remains. Settings/privacy/sign-out and account repair remain accessible.

Delivery order is #93 -> #94 -> #95 -> #96, one PR each, before resuming #72.
#94 implements account-derived currency after #93. Immutable `Account.currency` is the
source of every transaction response, filter and report; transaction write bodies
contain no currency. `Transaction.currency`, `Account.legacyCurrency` and the
obsolete finance backfill CLI are removed. An owner-safe account foreign key and
SQL guards preserve ownership, dates, archival and same-currency reassignment.
Amounts remain exact integer minor units; no conversion or account currency
selector is introduced. Each migration still applies from an empty database.
#95 now stores immutable `clientRequestId` and server-computed SHA-256
`creationFingerprint` on Transaction with owner-scoped uniqueness, replacing
TransactionCreation. Manual creates require an identity; internal/generated
postings may omit both fields together. Equivalent retries return the current
resource without undoing edits. A conflicting payload returns 409
`IDEMPOTENCY_KEY_REUSED`. Protection lasts only while the row exists: hard deletion
releases the key and a late retry can create a new row. No tombstone or soft
deletion is introduced.

#96 shares the approved 80-row catalog in one Category table. Null ownership plus
stable IDs/keys identifies immutable defaults; non-null ownership identifies
private personal rows. API and SQL guards permit shared or same-owner category
references and two-level parents, while every transaction query stays user-scoped.
Shared roots may have personal children. Active visible sibling names conflict
with shared defaults or the current user's personal rows; different users can
reuse personal names. `categories:init` initializes once per database, separately
from synthetic seeds and signup, and rejects drift rather than rewriting it.
Per-user provisioning/backfill commands are removed. Demo uses the same default
IDs with isolated personal data. All four foundation increments are implemented;
#72 navigation/keypad is now implemented locally; see
[#72](https://github.com/ShokooBid/PocketLedger/issues/72) for its scope.
Later reporting/transfers remain separate work.
The linked GitHub issues and verification record preserve historical behavior.

## Confirmed product decisions

These decisions come from the user's explicit instructions and answers, rather
than assumptions taken from the supplied design images.

| Topic                | Confirmed behavior                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                 | Add transaction is the main page after login.                                                                                                                       |
| Accounts             | Users define named accounts such as BMO, CIBC and Cash; add/manage them in Settings. Bank names do not imply bank connections.                                      |
| Currency             | Explicitly choose once after sign-in; CAD is a local suggestion. The saved choice is permanent immediately and read-only in Settings.                               |
| Foreign exchange     | Excluded. No conversion, exchange rates or cross-currency transfers.                                                                                                |
| Default categories   | One approved shared 80-row catalog; users cannot rename, archive or reparent defaults. Personal rows remain private.                                                |
| Personal categories  | Users can create root categories and subcategories under either a default root or a personal root.                                                                  |
| Category selection   | Select either a parent category or a subcategory.                                                                                                                   |
| Merchant/payee/payer | Leave these fields out of the redesigned transaction form. Preserve existing stored merchant values during migration.                                               |
| Description          | One optional description/note field. No separate merchant or payer input.                                                                                           |
| Amount entry         | Custom keypad with digits, decimal, backspace and confirm. Confirm validates all fields and saves the transaction. No addition/subtraction or arithmetic operators. |
| Opening balance      | Optional, defaulting to zero, so accounts can show tracked balances.                                                                                                |
| Statements           | Select a specific account for CSV/PDF uploads; keep that account visible through review and confirmation. Processing arrives in later issues.                       |
| AI                   | Reserve text/voice/receipt entry points now; functionality arrives later and requires editable drafts plus explicit confirmation.                                   |

## Final answers and their consequences

1. **Choose currency before accounts or finance screens.** Null means not
   chosen. Confirm once; repeated identical confirmation succeeds, while changing
   or clearing the choice is rejected by the API and database. There is no
   first-posting lock timestamp. Losing the final active account requires account
   repair without deleting history or discarding a draft.
2. **Keypad confirm saves after validating all fields.** It is the entry page's
   primary Save transaction action, not a separate amount-only confirmation step.
   Any other presentation of Save invokes the same guarded operation.

The first account and later accounts inherit the permanent currency. Currency
selection does not depend on saving or deleting transactions. A default account
is optional; at least one active account is required. No conversion or unlock
flow exists. Demo uses the same setup rules in isolated session memory.

## Implementation boundaries

| Responsibility                                                       | Follow-up issue                                                                                                                                                                    |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permanent currency choice and active-account setup                   | [#93](https://github.com/ShokooBid/PocketLedger/issues/93), superseding the currency behavior in [#65](https://github.com/ShokooBid/PocketLedger/issues/65)                        |
| Account-derived transaction currency and retired finance backfills   | [#94](https://github.com/ShokooBid/PocketLedger/issues/94)                                                                                                                         |
| Inline transaction request storage and lifetime-only retries         | [#95](https://github.com/ShokooBid/PocketLedger/issues/95)                                                                                                                         |
| Shared immutable default catalog                                     | [#96](https://github.com/ShokooBid/PocketLedger/issues/96)                                                                                                                         |
| Hierarchy, immutable defaults and personal-category operations       | [#66](https://github.com/ShokooBid/PocketLedger/issues/66)                                                                                                                         |
| Approved catalog (per-user provisioning superseded by #96)           | [#67](https://github.com/ShokooBid/PocketLedger/issues/67)                                                                                                                         |
| Accounts and optional opening balance                                | [#68](https://github.com/ShokooBid/PocketLedger/issues/68)                                                                                                                         |
| Transaction account links, merchant-free contract and migration gate | [#69](https://github.com/ShokooBid/PocketLedger/issues/69)                                                                                                                         |
| Account management in Settings                                       | [#70](https://github.com/ShokooBid/PocketLedger/issues/70)                                                                                                                         |
| Category/account pickers                                             | [#71](https://github.com/ShokooBid/PocketLedger/issues/71)                                                                                                                         |
| Entry home, custom keypad and navigation                             | [#72](https://github.com/ShokooBid/PocketLedger/issues/72)                                                                                                                         |
| Atomic transfers and transfer UI                                     | [#73](https://github.com/ShokooBid/PocketLedger/issues/73), [#74](https://github.com/ShokooBid/PocketLedger/issues/74)                                                             |
| Logical history, account filters and category rollups                | [#75](https://github.com/ShokooBid/PocketLedger/issues/75)                                                                                                                         |
| Inert AI entry points                                                | [#76](https://github.com/ShokooBid/PocketLedger/issues/76)                                                                                                                         |
| End-to-end/device acceptance                                         | [#77](https://github.com/ShokooBid/PocketLedger/issues/77)                                                                                                                         |
| Later account-bound review, CSV and PDF processing                   | [#78](https://github.com/ShokooBid/PocketLedger/issues/78), [#79](https://github.com/ShokooBid/PocketLedger/issues/79), [#80](https://github.com/ShokooBid/PocketLedger/issues/80) |

Earlier issue bodies and the local planning document may still mention optional
merchant fields, editable default copies or a native keyboard. Those are
superseded by the confirmed decisions above; they must not drive implementation.
The backend version/DTO names in these documents are engineering specifications;
implemented Zod schemas and generated OpenAPI remain the executable contract.

## Verification and completion evidence

| #64 acceptance criterion                                                                                 | Specification evidence                                                    |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Screen states cover loading, empty, invalid, saving, uncertain write, success, cancel and session expiry | [UX state matrix](ux.md#states-and-recovery)                              |
| Add shows one Settings currency without a selector                                                       | [Entry fields](ux.md#transaction-entry)                                   |
| Existing amounts, currencies, ownership and historical links survive                                     | [Migration and deployment](finance-contracts.md#migration-and-deployment) |
| Merchant removal and legacy-client gate are explicit                                                     | [Version boundary](finance-contracts.md#version-boundary)                 |
| CSV/PDF and functional AI are later increments requiring confirmation                                    | [Statement and AI flows](ux.md#statements-and-ai-later-increments)        |

Review the specification against current Prisma models, transaction/category/
dashboard Zod contracts, mobile data adapters, session navigation and transport.
Check Markdown formatting, local links, example JSON and consistency with the
confirmed answers. Runtime tests cannot verify unimplemented future screens;
follow-up issues require behavior/integration tests and native-device acceptance.

See [verification and handoff](verification.md) for reviewed source boundaries,
checks actually run and the local completion/review boundary.
