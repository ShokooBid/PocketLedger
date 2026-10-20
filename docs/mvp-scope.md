# MVP scope and product boundaries

## Product goal

Enable one person to safely track their own spending and income without handing
their banking credentials to PocketLedger. The MVP should prove that manual
tracking and statement import are useful, understandable, and dependable.

## In scope for the MVP

### Accounts and privacy

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

- List default and user-created categories.
- Create, rename, archive, and select categories for transactions.
- Prevent category deletion or archiving from silently corrupting past records;
  existing transactions retain their historic category association.

### Manual transactions

- Add, list, filter, edit, and delete manual income and expense transactions.
- Record direction, integer minor-unit amount, ISO currency, transaction date,
  category, merchant/payee, and an optional note.
- Validate all required fields and give accessible error feedback.

### Dashboard and history

- Show a deterministic period summary of income, expenses, and net total.
- Show recent transactions and date/category filters.
- Calculate all financial totals in the backend from persisted transactions.

### CSV statement import

- Accept a documented CSV format using a deliberate file-selection flow.
- Validate content, show a preview and row-level problems, then require the user
  to explicitly confirm before records are created.
- Protect spreadsheet exports from formula injection by neutralizing dangerous
  leading characters in cells intended for spreadsheet display.

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
  transfers, debt tracking, investment tracking, tax reporting, and multi-currency
  conversion.
- Shared accounts, household ledgers, delegated access, social features, and
  cross-user reporting.
- Receipt scanning, OCR, image storage, voice entry, speech recognition, and
  background monitoring.
- AI/LLM categorization, spending insights, recommendations, forecasts, financial
  advice, model-provider integrations, MCP tools, and Claude skills.
- Production release, payment processing, advertisements, real-financial-data
  demos, and compliance certification.

## Definition of MVP done

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
