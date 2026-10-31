# Issue #67: confirmed default category catalog

The user supplied the final version-1 names: **10 parents and 70 subcategories**.
The canonical [portable manifest](../../apps/api/src/categories/catalog.v1.ts)
preserves their exact spelling, capitalization, punctuation and display order.
The supplied SVG pack now supplies a stable `iconKey` for each default category.
Colors are embedded in the supplied SVGs; `colorKey` remains `neutral`.
Repeated child names belong to distinct parents and have distinct stable keys.

## Provisioning

- With category preview enabled, password and Google signup call one provisioning
  service inside the user/session transaction. Login and Google linking do not
  provision again. A failed transaction leaves no partial user/tree/session.
- Stable per-owner catalog keys make reruns additive. Existing keyed rows are
  preserved verbatim, including historical labels and archived states. Default
  rename/archive protections from #66 remain enforced.
- Backfill plans an owner's entire tree before writing. Normalized active-name
  collisions, invalid keyed identities or missing children of archived roots
  produce an actionable owner/category-ID report. That owner's rows stay
  unchanged; no adoption, merging, automatic rename or resurrection is attempted.
- Existing-user backfill is explicit, defaults to a read-only preview, and uses
  UUID paging (default 20, maximum 100 owners). Apply requires
  `FINANCE_CATEGORIES_ENABLED=true`; `--local` restricts the database to loopback.
  Synthetic development seeds and demo code remain unchanged, per the user's
  instruction to focus on authenticated pages.

From the repository root:

```powershell
npm run categories:backfill -- --local --limit 100
npm run categories:backfill -- --local --limit 100 --apply
```

When `nextCursor` is non-null, continue with `--after <nextCursor>`. Resolve
reported conflicts explicitly before retrying that owner/page. The CLI reports
IDs and catalog keys, without emails or personal category names.

## Local database update

The user explicitly requested populating local test users for preview. The dry
run found three users and no conflicts. Application created **80 fixed rows per
user (240 total)**, preserving their existing categories and transactions.
No schema migration, record deletion, or synthetic seed execution was needed.

The subsequent `20261030040000_category_icons` data migration assigns icons to
existing catalog copies for every owner, including archived rows. It updates
only `iconKey`, preserving names, IDs, timestamps, ownership and historical links.
The immutable-default trigger is disabled only inside an exclusive table lock and
transaction, and re-enabled before commit; user mutation routes remain read-only.
Newly provisioned users receive the same icon keys directly from the catalog.
Local readback confirmed 240 catalog rows across three users, all 80 mappings,
zero icon mismatches and the immutable-default trigger enabled.

The app resolves these keys through the generated
`apps/mobile/src/category-icon-assets.ts` registry. Authenticated management and
transaction category choices display the SVGs with their original colors. Each
render scopes gradient IDs to prevent web collisions. Personal/unknown keys use
a neutral fallback. No paths or arbitrary SVG URLs are stored in the database.
Run `npm run icons:generate` after deliberately updating the catalog/icon sources;
the generator checks that all 80 supplied assets have a unique mapping.

The ignored root `.env` now enables `FINANCE_CATEGORIES_ENABLED=true`, and the
ignored `apps/mobile/.env.local` enables
`EXPO_PUBLIC_FINANCE_CATEGORIES_ENABLED=true`. Restart the API and Expo to load
these settings. Committed environment examples still default to false; this is
a local category preview, and the account-aware finance release gate remains.

## Checks and user-run tests

API tools TypeScript and focused ESLint passed. Changed files were formatted and
the diff was inspected. **No automated tests were executed**, as requested.
Mobile TypeScript and focused icon/UI ESLint also passed after wiring the SVGs.
The new integration suite covers signup/login/linking, concurrent reruns, owner
isolation, dry-run paging, conflict preservation, archived history and rollback.

Run the focused tests from the repository root (PowerShell):

```powershell
$env:TEST_USE_LOCAL_DATABASE='true'
node --env-file=.env node_modules/vitest/vitest.mjs run --root apps/api --config vitest.integration.config.ts tests/integration/category-catalog.test.ts tests/integration/database.test.ts tests/integration/auth.test.ts
npm run test --workspace=@pocketledger/mobile -- --runTestsByPath tests/category-icons.test.ts tests/categories.test.tsx tests/transactions.test.tsx
```

These reuse the local PostgreSQL database through isolated temporary schemas.
No additional container is required. Existing #66 changes remain uncommitted on
the current branch. No commit, push, PR, or issue closure was performed.
