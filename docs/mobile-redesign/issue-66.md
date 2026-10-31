# Issue #66: category hierarchy

Issue: [#66](https://github.com/ShokooBid/PocketLedger/issues/66).
Implementation branch: `feat/issue-66-category-hierarchy`, based on the local #65
commit. No final catalog values are introduced; #67 supplies those values and
provisioning. The user approved neutral presentation defaults now, with final
visual choices deferred to #67/#71.

## Implemented behavior

- Additive category fields: owner-safe nullable `parentId`, nullable stable
  `defaultKey`, semantic `iconKey`/`colorKey` and bounded `sortOrder`. Existing
  categories remain roots with their IDs, audit fields and transaction links.
  Personal categories initially use `category` / `neutral` / order zero.
- Active names are unique within an owner's roots or within one parent's
  children, using existing whitespace normalization and ASCII case folding.
  Equal child names under different roots are allowed. Names retain the existing
  raw/normalized length and visible-text rules.
- Personal roots and children can be created under active owned roots, including
  fixed defaults. Composite ownership references and database guards reject
  foreign parents, self links, cycles, deeper nesting and archived ancestors.
  Both row-level and statement-level guards cover direct multi-row SQL writes.
- Fixed defaults cannot be renamed, archived or visually edited. Catalog identity
  cannot be submitted through ordinary mutations. All reparenting is unavailable
  in this release. No restore, merge or hard-delete API is added.
- Archiving a personal root atomically archives its active children; previously
  archived children's timestamps remain intact. History stays associated with
  its original category ID. Unchanged historical-category edits are permitted;
  new assignments require an active category and ancestor.
- Owner locks serialize category creation/archive and transaction assignments
  with the existing currency/preference locking. Database triggers enforce the
  same rules for direct SQL writes. Category row locks reject stale repeatable-read
  writes after archival, including snapshots taken before the archive committed.

## API and staged integration

Authenticated `/v2/categories` supports paginated list/create, owned lookup,
personal name/presentation patch and archive. `/v2/categories/recent` returns
1–20 distinct active selections (default 8), ordered by their most recent
transaction save time, with owned parent paths. Reads use a consistent snapshot.

List parameters are `status=active|archived|all`, `limit` 1–100 (default 50), UUID
`after`, optional `q` (normalized name substring, at most 100 units), and optional
`parentId`. Use `parentId=root` for roots, a root UUID for children, or omit it
for a flat list across levels. Pages use UUID ordering and are not complete
trees. The management adapter fetches every page before presenting the tree.
Presentation keys are lowercase semantic identifiers of at most 40 characters;
order is an integer from 0 through 1000000. Final vocabulary/rendering is later
work; raw CSS, images and URLs are not presentation keys.

`FINANCE_CATEGORIES_ENABLED=false` and
`EXPO_PUBLIC_FINANCE_CATEGORIES_ENABLED=false` keep the increment dormant. Both
must match for authenticated category-management preview; restart/rebuild Expo
after changing public configuration. Defaults are not seeded or provisioned.
The #64 rollout gate remains in place until the account-aware API is ready.

Legacy category DTOs stay flat. Owners with hierarchy/catalog-key records receive
`FINANCE_UPGRADE_REQUIRED` on legacy category operations instead of exposing
those records through writable flat routes. Other flat owners retain legacy
behavior, with fixed-default protection. Disabling a preview flag does not make
already-created hierarchy rows writable through the old category API.

Transaction services accept both root and child IDs, preserve exact `categoryId`
filters and provide explicit `includeSubcategories` behavior for a root subtree.
The prepared v2 query schema validates that option; v1 query validation still
rejects it. Summary services compute separate root rollups, counting direct-root
and child postings once each. These service primitives are tested here; public
account-aware v2 history/reporting and picker presentation remain #69/#71/#75.
The current v1 dashboard response omits root rollups, and merchant remains required.

Authenticated management shows paths, permits personal children under either
root kind, hides fixed-default mutation controls and confirms affected active
children before archival. Duplicate/error input, uncertain-write reconciliation
and session-scoped adapters are retained. Existing authenticated transaction
selection, exact filters and history labels show full parent/child paths so equal
child names stay distinguishable; both root and child selections can be saved.
The new searchable picker remains #71. Demo code is not extended.

## Local verification workflow

`npm run db:deploy` applies pending additive migrations to the configured local
database; `npm run db:generate` generates the client. No existing records are
deleted. Integration tests support explicit `TEST_USE_LOCAL_DATABASE=true`, with
the root `.env` loaded by the parent Node process. They create randomly named
isolated schemas in that same loopback database, migrate/test there and drop
only their own generated schemas. No additional container or database is needed.
Existing disposable-database mode remains available for CI.

API integration command from the repository root (PowerShell):

```powershell
$env:TEST_USE_LOCAL_DATABASE='true'
node --env-file=.env node_modules/vitest/vitest.mjs run --root apps/api --config vitest.integration.config.ts
```

For mobile integration, use the same command with `--root apps/mobile`.
Run mobile unit/navigation tests with
`npm run test --workspace=@pocketledger/mobile` so route discovery uses the
mobile workspace.

## Verification results

- API unit tests: 38 passed. Final API integration: 78 passed across two final
  runs (29 migration/hierarchy tests and 49 remaining compatibility tests),
  including clean/upgrade migrations, ownership, immutable defaults, history,
  subtree totals and archival races under read committed and repeatable read.
- Mobile integration: all 8 tests passed against the final migration, including
  real v2 adapters, supported-client recovery, safe domain errors, currency and
  session isolation. Final mobile unit/navigation run: all 147 tests passed using
  the normal workspace command, including authenticated root/child selection,
  path labels, management controls and transport boundaries.
- Repository ESLint, API tools and mobile TypeScript, Prisma validation/client
  generation, API build and OpenAPI generation passed. Mobile TypeScript was
  invoked directly after the npm wrapper stalled in Expo customization; that
  stalled command was stopped. No timeout limits were increased.
- Initial API/mobile unit runs each encountered one existing five-second
  startup/navigation timeout; the normal commands passed on rerun. Integration
  testing found and fixed the category adapter's generic-validation precedence
  over the specific invalid-parent error.

Repository Prettier and `git diff --check` passed. No Expo exports or physical-device
tests were run for #66.

No physical-device acceptance, commit, push, PR or issue closure is performed
automatically. The remaining redesign milestones and #67 catalog remain separate.
