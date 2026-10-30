# MVP scope and product boundaries

## Status

Accepted target, amended on 2026-10-30 by
[Issue #64's confirmed decisions](mobile-redesign/README.md),
[UX specification](mobile-redesign/ux.md) and
[finance contracts](mobile-redesign/finance-contracts.md). This describes planned
behavior, not features already implemented. The manual redesign and subsequent
statement-import increments have separate acceptance/release gates.

## Product goal

Enable one person to safely track their own spending and income without handing
their banking credentials to PocketLedger. The MVP should prove that manual
tracking and statement import are useful, understandable, and dependable.

## In scope for the MVP

### Identity and privacy

- Register, sign in, refresh a session, sign out, and view basic account/privacy
  information.
- Support email/password and Google sign-in, with persistent mobile sessions
  across app restarts. Google-only accounts do not require a PocketLedger password.
- Allow explicitly linking Google to an existing account after proving both
  identities. Do not automatically merge accounts with matching email addresses.
- Restore sessions from secure storage, rotate refresh tokens, and revoke the
  current session on logout. Expired/revoked sessions require sign-in again.
- Isolate each user's records. A user can only create, read, update, archive, or
  delete their own data.
- Explain that PocketLedger does not connect to a bank in the MVP.

### Categories

- List fixed default and personal categories/subcategories, with exactly two levels.
- Defaults cannot be renamed, archived or otherwise edited by users. The user
  supplies the actual catalog values before provisioning releases.
- Create, rename and archive personal categories; personal children can attach to
  either a default root or a personal root. Select either parent or child.
- Prevent category deletion or archiving from silently corrupting past records;
  existing transactions retain their historic category association.

### Named financial accounts and currency

- Add/manage user-named accounts such as BMO, CIBC and Cash in Settings. No bank
  connection is implied. Opening balance is optional and defaults to zero.
- Persist CAD as the initial Settings currency and show that one currency on Add.
  Saving the first transaction locks the currency; creating an account/opening
  balance alone does not. Preserve existing account/history denominations.
- Associate every new transaction with an owned compatible account; show tracked
  balances derived from opening balance and posted records, including transfers.
- Support same-currency transfers between two different owned accounts atomically.
  Editing/deleting affects both postings. No foreign exchange or fee allocation.

### Manual transactions

- Add, list, filter, edit, and delete manual income and expense transactions.
- Record direction, integer minor-unit amount, ISO currency, transaction date,
  account, category and one optional description/note. No merchant/payee/payer
  fields in redesigned input; preserve legacy stored values during migration.
- Make Add the post-login home with History, Overview and Settings destinations.
  Use a custom digits/decimal/backspace/confirm keypad with no arithmetic. Confirm
  validates the complete form and saves once; preserve drafts during navigation.
- Validate all required fields and give accessible error feedback.

### Dashboard and history

- Show a deterministic period summary of income, expenses, and net total.
- Show recent logical records and date/category/account filters. A transfer appears
  once; exclude transfer postings and opening balances from income/expense/net.
- Roll child/direct-parent category assignments into parent totals without double
  counting. Retain explicit currencies; never add unlike currencies.
- Calculate all financial totals in the backend from persisted transactions.

### Statement imports: subsequent delivery

- Require a selected owned account before upload; retain it through review,
  confirmation and import history. Account/currency mismatches block posting.
- Deliver shared account-bound batches/review in #78, CSV in #79 and PDF in #80.
  Coordinate CSV work with existing #17-#19 instead of building a second importer.
- Accept a documented CSV format using a deliberate file-selection flow; define
  supported PDF layouts/extraction/OCR, limits and retention before PDF enablement.
- Validate content, show a preview and row-level problems, then require the user
  to explicitly confirm before records are created.
- Protect spreadsheet exports from formula injection by neutralizing dangerous
  leading characters in cells intended for spreadsheet display.
- Extract draft rows only. The user can edit/select/reject before atomic,
  idempotent confirmation; repeated uploads and possible transfer matches need
  explicit resolution. Statement summaries/balances are not transaction rows.
- These increments do not block release acceptance for the manual redesign.
  CSV remains part of the original full MVP/beta target; PDF is a separate later
  release. Inert AI shortcuts are included now; functional AI remains later work.

### Engineering quality

- Publish REST/OpenAPI contracts, run validation, tests, linting, type checks, and
  builds in continuous integration.
- Provide documented local setup with Dockerized PostgreSQL and synthetic-only
  development seed data.
- Use accessible labels, usable focus order, sufficient contrast, and clear error
  states for the core screens.

## Explicitly excluded from the MVP

- Bank connections, open-banking integrations, card linking, bank credentials,
  automatic synchronization, and automatic reconciliation.
- Budgets, goals, bill reminders, recurring transactions, subscriptions,
  debt tracking, investment tracking, tax reporting, and multi-currency
  conversion.
- Shared accounts, household ledgers, delegated access, social features, and
  cross-user reporting.
- Receipt scanning/OCR, receipt image storage, voice entry, speech recognition, and
  background monitoring.
- AI/LLM categorization, spending insights, recommendations, forecasts, financial
  advice, model-provider integrations, MCP tools, and Claude skills.
- Production release, payment processing, advertisements, real-financial-data
  demos, and compliance certification.

## Definition of MVP done

The manual redesign milestone (#65-#77) requires entry-first navigation, fixed/
personal hierarchy, CAD/Settings lock, named accounts, correct same-currency
transfers, reporting, accessible recovery states and the contract/migration gate.
Completing the documentation in #64 alone does not satisfy those runtime criteria.

The MVP is ready for a small beta only when an authenticated user can manually
record income and expenses, organize them with categories, review a correct
dashboard and history, import a supported CSV after previewing it, and retain
exclusive access to their records. Core flows must have automated tests,
documented error behavior, and no known critical privacy or authorization gap.
Email/password and Google onboarding, safe account linking, and session restoration
must be verified on supported development builds; Google cancellation or provider
failure must leave email/password sign-in usable. See the
[authentication plan](authentication-plan.md) for the implementation sequence.

## Deferred-feature rules

Future work can be proposed as a separate issue only when it states its data
access, permissions, failure behavior, and user-confirmation point. In particular:

- AI-derived values are drafts, never silently persisted facts.
- Any action proposed by an AI, voice interpreter, receipt extractor, or MCP tool
  must be reviewable and explicitly confirmed by the user before a write.
- A future bank integration requires a new threat model and security review; it
  cannot reuse the MVP's manual-entry assumptions.
