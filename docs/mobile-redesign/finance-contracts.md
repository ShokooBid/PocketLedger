# Finance contracts and compatibility

Issue [#64](https://github.com/ShokooBid/PocketFinance/issues/64). This is the
engineering specification for follow-up implementation, not an assertion that
these endpoints or migrations exist. Read the [decisions](README.md) and
[UX specification](ux.md) first. #93 requires explicit permanent currency choice
and an active account before finance access; keypad confirm validates and saves
the complete transaction. #94 implements account-derived currency and removes
obsolete finance backfills. #95 implements inline lifetime-only creation identity;
#96 implements the shared immutable catalog described below.

## Version boundary (updated by the authorized #69 cleanup)

Authentication/session and finance endpoints all use `/v1`. The #69 portfolio
cleanup deliberately replaces the older pre-release finance contract with the
account-aware contract and removes `/v2` and rollout flags. Deploy matching API
and mobile clients together. Earlier issue handoffs describe the historical
staging plan; they do not define current routes. Breaking changes after a public
release must use a new API version.

Transfers (#73/#74) and live logical History (#75) are implemented. Statement
batches below remain future work. Current OpenAPI documents implemented routes.

New normal-transaction requests and responses omit `merchant`, `payee` and `payer`.
The single optional description is `note`. Old stored merchant values remain
untouched; new records need storage that permits merchant absence. Do not supply
an empty/synthetic merchant to make old validation pass, move old merchant values
into notes automatically, or drop old columns/data in the expansion migration.

Implemented routes must use Zod validation/serialization and generate OpenAPI
from those schemas. These contract tables and valid JSON examples guide that
implementation; they do not replace generated OpenAPI or justify bypassing it.

## Common rules

- Derive `userId` from the verified session. Never accept client ownership,
  immutable catalog identity, `isDefault`, import provenance or transfer-leg flags
  as ordinary transaction/category mutation fields.
- IDs are UUIDs. Reject unknown request keys. Foreign and missing resource IDs
  both return 404. Owned but unusable resources produce safe validation/conflict
  errors; no database exceptions or foreign record details leave the API.
- Normal amounts are integers from 1 through 2147483647 minor units, with separate
  income/expense direction. Opening balances are signed integer minor units within
  the corresponding bounded range, defaulting to zero. No floating-point money,
  rounding, implicit conversion, negative normal amount or arithmetic expression
  is accepted.
- Preserve the existing allowlist and add CAD: CAD/USD/EUR/GBP/INR have exponent 2,
  JPY 0 and KWD 3. Choose once after sign-in; accounts inherit the permanent
  preference. Transaction currency is derived from the immutable account. Parse
  decimal entry using that account exponent; API money stays integer minor units.
  No FX endpoints exist.
- Dates are actual calendar dates `0001-01-01` through `9999-12-31`; audit fields
  are UTC ISO instants. Store a date as PostgreSQL `date`, not a local midnight
  instant. Account postings must not predate the opening date.
- Preserve category normalization: collapse/trim ASCII whitespace, then 1-100
  UTF-16 units; raw input bound 1000. Compare normalized active sibling names with
  the established ASCII case-folding rule, independent of DB locale. Account names
  use the same visible-name limits/rule within one owner.
- Notes are null or at most 2000 UTF-16 units; empty UI input becomes null. Reject
  control/format/surrogate text as current transaction validation does. Category/
  account names must contain visible text. Never log notes or statement contents.
- Audit fields and balances are server-owned. Account balances and summary totals
  use exact DB aggregation; serialize only safe integers. Out-of-range totals
  return 422 rather than rounding. Never combine unlike currencies.

## Planned resources

| Resource           | Required response fields, in addition to ID/audit timestamps                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preferences        | `entryCurrency` (nullable until chosen), derived `hasActiveAccounts`, nullable `defaultAccountId`. Currency is permanent once chosen.                                                    |
| Category           | `name`, nullable `parentId`, `isDefault`, nullable `defaultKey`, `iconKey`, `colorKey`, `sortOrder`, nullable `archivedAt`. Default identity and metadata are not user-writable.         |
| Account            | `name`, `type` (`cash`, `bank`, `credit`, `other`), `currency`, `openingBalanceMinor`, `openingDate`, nullable `archivedAt`. Balance reads add `asOf` and `balanceMinor`.                |
| Normal transaction | `accountId`, `categoryId`, `direction` (`income` or `expense`), `amountMinor`, `currency`, `date`, nullable `note`, nullable `importId`. No merchant field or public transfer-leg shape. |
| Transfer           | `fromAccountId`, `toAccountId`, `amountMinor`, `currency`, `date`, nullable `note`. Its two internal postings are not independent editable normal transactions.                          |
| Later import batch | `accountId`, `sourceKind` (`csv` or `pdf`), lifecycle state, nullable confirmation metadata and bounded draft-item pages. No posting occurs during extraction.                           |

`isDefault` means fixed catalog origin, not the currently selected category.
Keep every finance record owned by one user. Prefer composite foreign keys for
account/import ownership and single-ID category references with shared-or-owned guards, plus
transactional guards for cross-row invariants. A row CHECK alone cannot enforce
active ancestors or exactly two balanced transfer legs.

### Permanent currency and derived readiness (#93)

`GET /v1/preferences` returns nullable `entryCurrency`, `hasActiveAccounts` and
nullable `defaultAccountId`. An absent preference may create an empty row, but
reading never chooses CAD. `hasActiveAccounts` is calculated with an indexed
existence query, not stored as an onboarding flag. The snapshot is read under the
same owner lock as account/default mutations.

`PATCH /v1/preferences` accepts a nonempty strict body with `entryCurrency` and/or
nullable `defaultAccountId`. The first valid currency is permanent immediately.
Repeating it is an idempotent success; another currency returns 409
`CURRENCY_LOCKED`. Null is not a valid currency input. Defaults must be owned,
active and match the permanent choice; choosing a default remains optional.

There is no `currencyLockedAt`, automatic saved CAD, first-posting event or unlock.
SQL enforces immutability even through direct updates/clearing/deletion of chosen
preferences. All related mutations acquire the owner row lock in a transaction.
Account creation without currency returns 409 `CURRENCY_REQUIRED`; currency
inheritance/ownership/active-account checks remain server-side guarantees.

Main finance/transaction routes, including deep links/details, require the choice
and at least one active account. Archiving all accounts is allowed and requires
repair before finance access. Setup, Settings, privacy and sign-out remain
accessible. Refresh failure is an error state, not a missing-account result.

#94 removes persisted Transaction.currency and Account.legacyCurrency, their
obsolete indexes and dependent live guard logic. The owner-safe posting foreign
key references Account(id, userId). Responses include account-derived currency;
create/patch bodies reject it. Reassignment to a different-currency account fails
in service and SQL without changing amounts. Archival preserves denomination.
The account create currency assertion still checks the permanent preference; no
selector is introduced. #95 stores currency-free creation fingerprints on
Transaction itself; #96 replaces per-user defaults with shared rows.

### Category endpoints and immutable defaults

| Operation                         | Contract                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/categories`              | Bounded `status=active                                                                                                                                             | archived | all`, optional root `parentId`, optional search `q`; returns flat rows with parent IDs and a cursor. Fetch roots/children deliberately; do not imply a partial page is the whole tree. |
| `GET /v1/categories/:id`          | Shared-or-owned lookup including archived personal history.                                                                                                        |
| `GET /v1/categories/recent`       | Visible selections from the current user's transactions, ordered by most recent update, bounded `limit` 1-20 (default 8), with valid parent paths.                 |
| `POST /v1/categories`             | `name`, optional `parentId` (omitted/null means root), optional valid presentation keys/order. Always creates a personal category; 201 returns the created row/ID. |
| `PATCH /v1/categories/:id`        | Nonempty personal-category name/presentation patch; no parent/default-identity changes.                                                                            |
| `POST /v1/categories/:id/archive` | Empty JSON object; archives an owned personal root and its active personal children atomically, or one personal child. Returns the resulting resource.             |

Exactly two levels: a personal child uses an active shared root or its owner's
personal root. Shared children require shared roots. Select either root or child for a normal transaction.
Normalized active uniqueness spans visible shared/current-user siblings in each
root or parent namespace.
ID references plus shared-or-owned guards prevent a cross-user tree; guards prevent cycles,
deeper nesting and assignment under an archived ancestor.

User-facing rename/archive/reparent/presentation mutation of an owned default
returns `409 DEFAULT_CATEGORY_READ_ONLY`. Creating a personal child underneath it
is explicitly permitted. Enforce this in services/database access paths, not only
by hiding buttons. Personal archival preserves past transactions. An unchanged
historical category may remain on an edited record; a changed assignment requires
an active category and active ancestor. Do not reparent used categories or silently
merge a personal category with a catalog name collision.

#96 uses one table: Category.userId is nullable. Shared defaults have null owner,
isDefault=true, non-null globally unique stable defaultKey and no archive time.
Personal categories have a non-null owner, isDefault=false and null defaultKey.
SQL enforces that consistency. DTOs keep the existing shape, derive isDefault
from shared ownership and do not expose owner IDs. Shared update/delete is rejected
by SQL, including metadata/identity changes; personal identity/parent is immutable.

List/detail/search/pickers show shared plus same-owner personal rows. Recents join
only current-user transactions, and dashboard joins allow shared categories while
retaining the transaction owner filter. Direct-root and child postings each count
once in root rollups. Sharing category IDs never shares history.

Active sibling-name conflicts use existing ASCII whitespace normalization and
case folding. A personal root/child conflicts with shared or same-owner siblings
in the identical parent namespace. Different users may reuse private names.
Archived personal rows free their names; labels under different roots remain
independent. Explicit shared root/child indexes and globally unique default keys
cover null owners. Name-namespace locks and final-row guards handle cross-scope
conflicts and forward multi-row hierarchy references.

Run `npm run categories:init` after migrations and before serving traffic. The
approved 80-row manifest has permanent IDs/keys; the initializer serializes reruns,
inserts missing approved rows in one transaction and fails on drift or visible
personal-name conflicts. It never adopts or renames personal data or silently
rewrites shared metadata/timestamps. Catalog modifications require a deliberate
reviewed maintenance deployment, with finance writes stopped. Synthetic seeds
remain separate. Signup/password/Google/login/link never copy or initialize the
catalog. Per-user provisioning, backfill and reconciliation commands are removed.
Historical development-data preservation is not required; no reset is performed.
Demo imports the same framework-free catalog and keeps personal data/recents in
isolated session memory.

### Account endpoints

`GET /v1/accounts` is paginated and filters active/archived/all accounts.
`GET /v1/accounts/:id` includes opening information and current tracked balance;
an explicit `asOf` date is supported for balance reads.

`POST /v1/accounts` accepts `name`, `type`, `currency`, `openingDate` and optional
`openingBalanceMinor` (default 0). The form copies currency from Settings; the
server checks it against the permanent chosen preference in the same transaction.
This field is an assertion against stale UI, not a second currency-selection
feature. An account without a chosen currency returns `409 CURRENCY_REQUIRED`; an incompatible assertion returns `409 PREFERENCE_CHANGED`.

`PATCH /v1/accounts/:id` permits a nonempty name/type patch. Currency/opening
information are immutable from creation; any future
opening-balance correction flow must be explicitly designed rather than silently
changing a historical baseline. `POST /v1/accounts/:id/archive` takes `{}` and is
idempotent. Do not hard-delete referenced accounts. Clear an archived default.

Balance as of D = opening balance at the start of the opening date + income
postings through D - expense postings through D, including transfer legs. Return
an error for a date before account opening. Opening balance is not a normal income
posting. Do not store a mutable cached balance initially or reject an ordinary
transaction simply because its tracked balance would become negative.

### Normal transactions and creation identity

`GET /v1/transactions` returns only normal transactions, with bounded pagination
and date/account/category/direction filters. `GET /v1/transactions/:id` returns one
normal record. Use the logical history endpoint for a combined transfer feed.

`POST /v1/transactions` accepts the normal input fields plus a required UUID
`clientRequestId`. A synthetic create request is:

```json
{
  "clientRequestId": "10000000-0000-4000-8000-000000000001",
  "accountId": "20000000-0000-4000-8000-000000000001",
  "categoryId": "30000000-0000-4000-8000-000000000002",
  "direction": "expense",
  "amountMinor": 1250,
  "date": "2026-10-30",
  "note": "Weekly groceries"
}
```

`note` may be omitted/null; the response always includes null or its text.
For the create example above, the 201 response has this merchant-free shape:

```json
{
  "id": "40000000-0000-4000-8000-000000000001",
  "accountId": "20000000-0000-4000-8000-000000000001",
  "categoryId": "30000000-0000-4000-8000-000000000002",
  "direction": "expense",
  "amountMinor": 1250,
  "currency": "CAD",
  "date": "2026-10-30",
  "note": "Weekly groceries",
  "importId": null,
  "createdAt": "2026-10-30T12:00:00.000Z",
  "updatedAt": "2026-10-30T12:00:00.000Z"
}
```

`accountId`, `categoryId`, direction, amount and date are required. Request bodies
must omit currency. New assignments require active owned account/category/ancestor;
new postings use accounts in the permanent currency. Responses derive currency
from the related account. `PATCH /v1/transactions/:id` accepts a
nonempty partial normal input,
including nullable note; immutable IDs/provenance/client creation identity cannot
be patched. A normal record's currency cannot be changed to reinterpret its
amount; use the recorded currency when editing history. `DELETE` returns
`{ "ok": true }` on confirmed deletion. Preserve
the established unchanged-archived-association edit exception; changed accounts
or categories must be eligible, and all date/currency invariants still apply.

Create idempotency is owner-scoped by operation and `clientRequestId`, with a
server-computed SHA-256 `creationFingerprint` stored on Transaction alongside an
immutable `clientRequestId`. Hash the fixed-order array: accountId, categoryId,
direction, amountMinor, date, normalized note. Canonicalize UUID case; omitted,
null and empty note become null. Preserve meaningful note whitespace. Currency
is excluded because the immutable account determines it.

Manual creation requires the UUID and computes its fingerprint server-side.
Public input cannot set the fingerprint; public patch cannot change either
identity field, and responses do not expose them. PostgreSQL requires both fields
present or both absent, validates fingerprint syntax and prevents identity changes
(including attaching identity later to a null pair). Both-null is reserved for
internal/generated postings and synthetic fixtures; there is no generated-posting
API yet. No fake manual UUID is required for a future import/transfer posting.
The current schema has no posting-kind discriminator; manual presence is enforced
at the strict API/service boundary, while SQL enforces pair consistency.

A unique (userId, clientRequestId) index permits many null keys. Creation takes
the existing owner row lock before lookup/insert, so concurrent equal requests
return one row. First create returns 201. While the row exists, equivalent retries
return its current resource with 200; edits never rewrite the creation fingerprint
and a retry never undoes them. Changed intent returns `409 IDEMPOTENCY_KEY_REUSED`.

Hard deletion removes the identity. A late retry may create a new row with 201,
subject to current account/category/date eligibility. Even different content can
use that released key. There is no tombstone table or soft deletion. This accepted
lifetime-only guarantee supersedes #69's deletion-completion behavior. Account
saves get no request-identity infrastructure; future transfer aggregates and
import batches retain their own separately designed lifecycle contracts.
Keys are not authentication and never authorize another owner.

The UI retains its original key/payload during uncertainty and explicitly checks/
reconciles before starting another create. Updates/deletes refresh the identified
resource after a lost response; they do not switch to a new create. Normal transaction creation now implements these rules; future posting paths
must adopt the same guarantees. Body identity avoids adding an unplanned custom
header to the current transport/CORS allowlist.

### Transfers

`POST /v1/transfers` accepts `clientRequestId`, `fromAccountId`, `toAccountId`,
positive `amountMinor`, `currency`, `date` and nullable/omittable `note`.
`GET /v1/transfers/:id`, a nonempty partial `PATCH` and whole-transfer `DELETE`
operate on the aggregate. Reuse the create-identity rules above.

```json
{
  "clientRequestId": "10000000-0000-4000-8000-000000000002",
  "fromAccountId": "20000000-0000-4000-8000-000000000001",
  "toAccountId": "20000000-0000-4000-8000-000000000002",
  "amountMinor": 2500,
  "currency": "CAD",
  "date": "2026-10-30",
  "note": null
}
```

Require different owned active accounts in the same configured currency. Persist the
aggregate and exactly two linked equal/date/currency/owner-matched postings:
expense from source and income to destination. Category is null only for internal
transfer legs. Normal transaction endpoints reject transfer-leg IDs; they never
create/edit/delete a leg independently. Lock affected rows consistently, validate
constraints at commit and roll back both sides on failure. Historical unchanged
account associations can be retained on edit under the same rule as normal
records; newly assigned accounts must be active. No transfer fee/FX machinery is
included.

### Logical history and reporting

Implemented #75: `GET /v1/history` returns `{ items, days, nextCursor,
previousCursor, applied, adjustments, focusedKey }`. Items have `kind` equal to
`transaction` or `transfer`, a type of income/expense/transfer, account-derived
currency, optional note and current account/category/parent/icon metadata.
Transfer postings never appear as extra normal records. Filters are `accountId`,
`currency`, `type`, exact `categoryId` or `includeSubcategories=true`, and paired
inclusive `from`/`to` dates at most 366 days apart. Filters combine with AND.
Account filtering matches either transfer side; a category filter excludes transfers.

Order is date DESC, UUID DESC, kind DESC. The validated URL-safe cursor is
`YYYY-MM-DD_<uuid>_<kind>`; `after` loads older records and `before` loads the
nearest newer records. Limit defaults to 50 and is bounded to 1-100. Changing
filters starts a new cursor chain. Paging is live across requests. A date/currency
aggregate covers the entire filtered day for dates represented on the page, not
just its loaded rows. Transfers count once and contribute zero to net. Results
and aggregates share one repeatable-read snapshot per response; unsafe integer
totals fail rather than round. Return at most 100 rows and seven currency groups
per returned date.

A `focusId`/`focusKind` pair replaces a cursor for bounded saved-record reveal.
It validates ownership, adjusts only excluding filters, explains the changes,
returns the saved record first and provides both cursor directions. #106 owns
automatic navigation and editor lifecycle; #75 exposes the History handoff.
Statements retain one logical transfer and label its incoming/outgoing account
side. Archived references remain readable and all ledger queries remain owned.

`GET /v1/dashboard/summary` requires from/to, one currency and `recentLimit` 1-20
(default 5). It returns normal-transaction income/expense/net totals and recent
normal transactions. #75 exposes `rootCategoryBreakdown` and `rootId` on each
exact category group. Root totals include direct-root and child postings once;
do not add the two breakdown representations together. Archived categories remain
readable. The related totals/recent reads share one DB snapshot. Live History is
implemented here; demo implementations are deliberately unchanged at the owner's request.

Invariant example: account A opens at 10000 CAD minor units, B at zero. A normal
expense of 1250 and transfer A -> B of 2500 produce A = 6250, B = 2500, period
income = 0, expenses = 1250 and net = -1250. Transfers/opening balances never add
income or expenses. Existing historical currencies get separate reports.

### Later statement contracts

#78 defines `/v1/imports` batches with an owned `accountId` selected before upload,
source kind CSV/PDF, draft items and a review lifecycle. Account changes invalidate
validation; confirmed batches cannot be silently reassigned. Ordinary transaction
requests cannot forge `importId`. Batch confirmation owns that association.

Upload/extraction returns drafts, never posted rows. Draft fields may be missing
and carry bounded row/page errors/provenance; normal transaction schemas do not
accept missing required fields merely because they came from a parser/model.
Confirmation revalidates the selected account, category, currency, date, duplicates
and selected rows, then commits atomically/idempotently using `clientRequestId`.
Failed validation writes nothing. Separate confirmed import history from ongoing
processing. Account/currency mismatch blocks posting; no inferred FX/account switch.

Statement source descriptions can be reviewed as the single optional note; no
new merchant/payee fields are introduced. Summary/opening/closing balance lines
are not transactions. Potential transfer matches require user resolution and
must not duplicate known legs from another statement. CSV format/mapping/limits
are #79 with existing #17-#19; PDF layouts/OCR/storage/retention are #80. No upload
provider or retention duration is chosen by this specification. Define those
before enabling uploads; text AI/receipt/voice execution is separate later work.

## Errors and client recovery

Keep the existing envelope `{ error: { code, message, requestId } }`; a later contract may add
bounded field `details` with safe paths/codes/messages for validation, without raw
input. Preserve the implemented envelope. Planned domain errors include:

| Status/code                                                      | Meaning and recovery                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 401 `INVALID_CREDENTIALS`                                        | Preserve established verified-session renewal/sign-in behavior; never blindly replay a new financial create. |
| 404 `NOT_FOUND`                                                  | Missing or foreign ID; no ownership disclosure.                                                              |
| 409 `DEFAULT_CATEGORY_READ_ONLY`                                 | Personal additions are allowed; the fixed default itself cannot be changed.                                  |
| 409 `CATEGORY_NAME_CONFLICT` / `ACCOUNT_NAME_CONFLICT`           | Correct a duplicate active name; preserve input.                                                             |
| 409 `CURRENCY_LOCKED`                                            | Settings cannot change a ledger's recorded denomination after the confirmed event.                           |
| 409 `PREFERENCE_CHANGED`                                         | Reload Settings/account creation context; do not reinterpret an entered balance.                             |
| 409 `IDEMPOTENCY_KEY_REUSED`                                     | Reconcile the existing operation; do not generate another key to force a retry.                              |
| 422 `INVALID_ACCOUNT` / `INVALID_CATEGORY` / `CURRENCY_MISMATCH` | Correct current owned selection/values; an archived ancestor is not a new-assignment target.                 |
| 422 `SUMMARY_AMOUNT_OUT_OF_RANGE`                                | Narrow the report period; never round a total.                                                               |
| 429 / 5xx / network uncertainty                                  | Preserve input and pending operation identity; distinguish retryable reads from uncertain writes.            |

## Migration and deployment

Apply the committed migrations to a clean database and deploy matching API/mobile
clients. Earlier SQL is immutable migration history; the #94 migration replaces
live guards and drops duplicated transaction currency and legacy account identity.
It performs no data reset, currency conversion or finance backfill. The retired
`finance:migrate` command and its legacy upgrade rehearsals are removed; catalog
initialization now uses `categories:init`; #96 removes `categories:backfill`.

Old development data preservation is not required by #94. The owner controls any
development reset; implementation does not delete data or apply migrations. Keep
clean-database migration deploy/redeploy/status and repeatable synthetic seed
verification in random disposable PostgreSQL schemas. Generating Prisma Client
only updates ignored source output; it does not apply SQL.

The #95 forward migration adds the nullable immutable pair and unique index,
then drops TransactionCreation. Existing development request identities are not
backfilled; the owner controls any development reset. #96 adds shared category
ownership/guards; initialize its approved catalog separately after deployment. Transfers/import/AI execution require their own acceptance checks.
