# Issue #2: implementation walkthrough

This document explains the local work performed for PocketLedger Issue #2,
including the files created, the commands run, the reasons for each step, and the
limits of the verification. It also recaps Issue #1 so the setup has context.

The commands below are a historical record, not a script to copy and execute from
top to bottom. Several commands were diagnostics or retries after a failure.
In particular, the dependency-removal commands are not normal setup steps.

## 1. Starting point and purpose

The repository originally contained only `README.md`. Issue #1 added the product
and architecture decisions. You then committed and pushed those documents in
commit `bba30ea` (`documentations`).

Issue #2 establishes a development workspace with three packages:

```text
PocketLedger/
├── apps/
│   ├── api/                 Node.js backend workspace
│   └── mobile/              Expo / React Native workspace
├── packages/
│   └── shared/              Portable shared code
├── docs/                   Product and architecture documentation
├── package.json            Workspace definitions, tools, root commands
├── package-lock.json       Resolved dependency versions and integrity data
├── tsconfig.base.json      Shared TypeScript compiler rules
├── eslint.config.mjs       Lint configuration
├── prettier.config.mjs     Formatting configuration
├── .editorconfig           Basic editor conventions
├── .gitignore              Generated files excluded from Git
└── .prettierignore         Files excluded from formatting
```

A monorepo is one Git repository containing multiple related packages. The API,
mobile app, and shared code can evolve together and use common tooling, while
retaining separate package names, dependencies, and commands.

## 2. Brief recap of Issue #1

These files were created before Issue #2:

| File | Purpose |
| --- | --- |
| `docs/architecture.md` | Records the stack, package boundaries, `/v1` API convention, errors, integer money representation, ownership, and session principles. |
| `docs/mvp-scope.md` | Defines what the first release includes and which features are deferred. |
| `docs/threat-model.md` | Lists threats such as account takeover, cross-user access, credential leakage, and unsafe CSV content, with intended mitigations and verification. |
| `README.md` | Introduces the project and links to these documents. |

These are design requirements, not evidence that their controls are implemented.
Authentication, database ownership constraints, CSV handling, and AI confirmation
flows do not exist yet.

I used a patch tool to create and edit these files. I checked the repository with
`git status`, inspected the README and recent commits, and ran `git diff --check`
for whitespace problems. You performed the commit and push yourself.

## 3. Creating the Issue #2 branch

I first checked the working tree and current branch. The working tree was clean,
and `main` matched the locally recorded `origin/main` reference.

I then created and switched to:

```text
chore/issue-2-monorepo-tooling
```

The first attempt failed because the execution sandbox could not write the Git
reference directory. Inspecting existing branch refs showed no conflicting
`chore` branch. I requested elevated execution for the same local branch command,
and it succeeded.

The initial commentary suggested the slash in the name might be the cause. That
was not established: the exact same slash-style name worked after permission was
granted. The branch name itself did not need to change.

Creating a branch changes local Git metadata and the current branch. It does not
commit files, upload code, or create a GitHub pull request. I did not fetch or pull
from GitHub during this implementation; `origin/main` was a local remote-tracking
reference when inspected.

## 4. Choosing the package manager

I initially attempted to use pnpm, as proposed in the conversation. The machine
had Node.js `22.19.0`, npm `10.9.3`, and Corepack `0.34.0` available.

Corepack can obtain and run package managers such as pnpm. The sandboxed attempt
failed when trying to contact the npm registry. The elevated retry failed because
the expected downloaded pnpm executable was missing.

I chose npm workspaces as a practical fallback. npm was already installed and
supports the required package layout. This was a tooling choice, not a change to
the agreed React Native / Node.js application stack. It does not mean pnpm cannot
work on Windows or with Expo.

The root `package.json` declares:

```json
{
  "private": true,
  "packageManager": "npm@10.9.3",
  "workspaces": ["apps/*", "packages/*"]
}
```

- `private: true` prevents accidental publication of the root package to npm. It
  does not control GitHub repository visibility.
- `packageManager` records the intended npm version. It does not itself install
  npm or enforce that version in every environment.
- `workspaces` tells npm to discover packages under `apps` and `packages` and link
  them during installation.
- `engines` declares Node.js `>=22.13.0` and npm `>=10.0.0`. Without strict engine
  enforcement, these declarations may produce warnings rather than block installs.
- `license: UNLICENSED` avoids implying an open-source license that you have not
  selected.

## 5. File-by-file explanation

### 5.1 Root package.json

The root package owns shared development tools and commands. Putting them here
avoids separately installing and maintaining the same tools in every workspace.

| Tool | Reason for adding it |
| --- | --- |
| `typescript` | Checks types and compiles the API and shared package. |
| `eslint` and `@eslint/js` | Detect common code mistakes using ESLint's recommended JavaScript rules. |
| `typescript-eslint` | Adds TypeScript-aware parsing and recommended lint rules. |
| `eslint-config-prettier` | Disables lint rules that would conflict with Prettier's formatting. |
| `prettier` | Applies consistent formatting to supported project files. |
| `vitest` | Provides a test command for each workspace as tests are introduced. |

Dependencies use version ranges in the manifests. `package-lock.json` records
the concrete versions resolved by npm. For example, `^5.9.3` permits compatible
TypeScript 5.x updates; the lockfile records the exact resolved version.

### 5.2 tsconfig.base.json

This is the shared TypeScript configuration. Each workspace extends it and adds
settings appropriate to its runtime.

| Setting | What it does and why |
| --- | --- |
| `strict` | Enables TypeScript's main strict checks, including null checks and implicit-any checks. |
| `exactOptionalPropertyTypes` | Distinguishes an absent optional property from one explicitly assigned `undefined`. |
| `noUncheckedIndexedAccess` | Makes indexed access account for a potentially missing value. |
| `noImplicitOverride` | Requires explicit `override` on applicable subclass methods. |
| `noUnusedLocals` / `noUnusedParameters` | Reports unused local variables and parameters. |
| `noFallthroughCasesInSwitch` | Detects accidental fallthrough between switch cases. |
| `allowUnusedLabels: false` | Reports unused statement labels. |
| `allowUnreachableCode: false` | Reports code that cannot execute. |
| `forceConsistentCasingInFileNames` | Helps catch filename casing errors that can behave differently across operating systems. |
| `esModuleInterop` | Improves compatibility when importing CommonJS modules. |
| `skipLibCheck` | Skips checking dependency declaration files to reduce noise and checking time; application code is still checked. |
| `target: ES2022` | Sets the JavaScript language target for emitted code. |

Type checking detects certain mistakes before execution. It does not replace
runtime input validation, security checks, or tests of business behavior.

### 5.3 apps/api

`apps/api/package.json` names the workspace `@pocketledger/api` and declares
`type: module`, so emitted JavaScript uses Node's ECMAScript module behavior.

The workspace adds:

- `@types/node`: type declarations for Node's APIs.
- `tsx`: executes TypeScript during development without a separate manual build.

`src/index.ts` currently prints one message:

```text
PocketLedger API workspace is ready for Fastify setup.
```

This proves the entry point can compile and execute. It does not start an HTTP
server. Fastify, health routes, authentication, Zod integration, and OpenAPI are
not implemented in this issue.

The API's `tsconfig.json` uses `NodeNext` for modules and resolution, compiles from
`src` to `dist`, and includes Node types.

### 5.4 apps/mobile

`apps/mobile/package.json` names the workspace `@pocketledger/mobile` and uses
`expo/AppEntry` as the application entry point. Expo loads `App.tsx` from there.

| Dependency | Purpose |
| --- | --- |
| `expo` | Development tooling and runtime integration for the React Native app. |
| `react` | Defines components and their rendering behavior. |
| `react-native` | Provides native interface components such as `View` and `Text`. |
| `expo-status-bar` | Controls the device status bar appearance. |
| `@types/react` | Supplies TypeScript declarations for React. |

`App.tsx` contains a centered project title and a message that navigation and
screens come in Issue #9. The heading has an accessibility role. This is a minimal
launch component, not the completed application navigation shell.

`app.json` supplies the app name, slug, version, portrait orientation, and
automatic interface style. `tsconfig.json` uses JSX and bundler-style module
resolution, with `noEmit` because Expo's bundler handles the executable output.

I consulted Expo's SDK compatibility documentation when choosing the Expo 57,
React Native 0.86, and React 19.2.3 baseline. However, I did not run Expo Doctor,
check every Expo package's expected version, export a mobile bundle, or launch
the app on a device. Passing TypeScript checks and `npm ls` does not establish
full mobile runtime compatibility.

The `web` script exists, but web-specific dependencies such as `react-dom` and
`react-native-web` were not added. Web execution has not been verified. Native
iOS simulator execution also requires macOS; it is not available directly on this
Windows machine.

### 5.5 packages/shared

`packages/shared/package.json` names the workspace `@pocketledger/shared` and
describes its compiled JavaScript and type declaration exports under `dist`.

The source currently exports only:

```typescript
export const applicationName = "PocketLedger";
```

This small placeholder makes the package type-checkable and buildable. Neither
app imports it yet. There are no shared transaction schemas or finance utilities.
When apps start consuming its compiled exports, their dependency declarations and
build order will need to account for the shared package.

Its TypeScript configuration enables `declaration`, producing `.d.ts` files
alongside JavaScript. Those files describe exported types to consumers.

The shared package must remain portable: it must not contain server credentials,
database clients, or Node-only modules that would enter the mobile bundle.

### 5.6 eslint.config.mjs

This is an ESLint flat configuration written as an ECMAScript module. It combines
recommended JavaScript and TypeScript rules, then disables formatting conflicts
with Prettier.

Generated directories are ignored. The final configuration recognizes `console`
as a read-only global, which allows the API bootstrap message. It also requires
consistent type imports to make type-only dependencies explicit.

The current lint configuration does not enable every React-specific or
type-checked ESLint rule. Strict TypeScript checks run separately.

### 5.7 prettier.config.mjs and .prettierignore

Prettier uses semicolons, double quotes, and no trailing commas. These are
consistency choices; they do not change product behavior.

`.prettierignore` excludes installed dependencies, build output, test coverage,
Expo-generated directories, and npm's generated lockfile. It also excludes
`docs/`: the first formatting pass expanded the existing threat-model table into
a large whitespace-only diff, so I restored its original layout and excluded the
documentation directory to keep the setup focused.

That exclusion is a tradeoff: future files under `docs/`, including this file,
are not checked by the root formatting command.

### 5.8 .editorconfig

This defines UTF-8, LF line endings, a final newline, two-space indentation, and
trailing-whitespace removal for editors that support EditorConfig. Markdown is
exempt from trailing-whitespace removal because trailing spaces can intentionally
represent line breaks.

EditorConfig does not configure Git's newline conversion. Git still printed
LF-to-CRLF warnings based on the machine's existing Git settings. Those warnings
did not make `git diff --check` fail.

### 5.9 .gitignore

This excludes generated dependency, cache, build, coverage, Expo, and TypeScript
incremental-build output. Such files can be regenerated and should not be included
in source commits.

The `.npm-cache/` entry was added while troubleshooting installation. It protects
against accidentally committing a repository-local npm cache if that diagnostic
approach is used again.

Environment-file and credential patterns were left for Issue #3. No environment
files or application credentials were introduced in Issue #2.

### 5.10 package-lock.json

npm generated this file. It records the resolved dependency graph, package
locations, versions, integrity hashes, and workspace links. It should be
committed so contributors and CI can reproduce dependency resolution.

For an existing lockfile, `npm ci` installs the recorded dependencies and rejects
manifest/lockfile mismatches. It also replaces an existing `node_modules` tree.
I did not perform a separate clean-clone `npm ci` verification in this issue.

### 5.11 README.md

The README now lists prerequisites, installation, package locations, root
commands, and the current placeholder behavior. It explains that no database or
cloud credentials are needed to install and type-check the base workspace.

## 6. What the package commands mean

### Root commands

| Command | Actual behavior |
| --- | --- |
| `npm run dev:mobile` | Runs the mobile workspace's `dev` script, starting Expo. |
| `npm run dev:api` | Runs the API workspace's `dev` script, watching its TypeScript entry point. |
| `npm run dev` | Runs available workspace `dev` scripts in npm workspace order. This is sequential, not a parallel server launcher; a long-running watcher prevents subsequent scripts from starting. Use two terminals for API and mobile. |
| `npm run format` | Writes formatting changes to non-ignored supported files. |
| `npm run format:check` | Checks formatting and returns a failing exit code when changes are needed. |
| `npm run lint` | Runs ESLint from the repository root. |
| `npm run typecheck` | Runs available workspace type-check commands. |
| `npm run test` | Runs available workspace test commands. |

`--workspace=@pocketledger/api` selects one package by name. `--workspaces`
selects all configured workspace packages. `--if-present` skips packages that do
not define the requested script; it does not suppress a failure from a script
that exists.

### Workspace commands

| Script | Explanation |
| --- | --- |
| API `dev`: `tsx watch src/index.ts` | Executes the bootstrap and reruns it after relevant file changes. |
| API/shared `build`: `tsc -p tsconfig.json` | Emits JavaScript using the package's compiler configuration; shared also emits declarations. |
| API `start`: `node dist/index.js` | Executes previously compiled JavaScript; a build must exist first. |
| `typecheck`: `tsc -p tsconfig.json --noEmit` | Checks types without writing compiled output. |
| `test`: `vitest run --passWithNoTests` | Executes tests once; currently succeeds with zero tests. |
| Workspace `lint` | Runs ESLint for that workspace and fails on warnings using `--max-warnings=0`. The root lint command does not currently use that flag. |

## 7. Commands run during Issue #2, in order

All commands ran in `C:\Shokoo\dev\PocketLedger`. Commands submitted together
are shown on separate lines for readability. A batch sometimes returned partial
output, so the log distinguishes commands requested from results actually seen.

### Step 1: inspect Git, runtime tools, and existing files

```powershell
git status --short --branch
git branch --show-current
node --version
npm --version
pnpm --version
Get-ChildItem -Force | Select-Object Name,Mode,Length
rg --files -g AGENTS.md -g package.json -g pnpm-workspace.yaml -g .npmrc -g '!node_modules' .
```

In order: check pending changes and branch; identify the branch; inspect Node,
npm, and pnpm availability; list files including hidden entries; search for
repository instructions and existing package-manager configuration. The first
batch showed a clean `main` and Node `v22.19.0`, but did not provide all the later
requested output. I followed up rather than assuming those commands succeeded.

### Step 2: locate tools and try the feature branch

```powershell
Get-Command npm,pnpm,corepack -ErrorAction SilentlyContinue | Select-Object Name,Source,Version
git switch -c chore/issue-2-monorepo-tooling
git status --short --branch
Get-ChildItem -Force | Select-Object Name,Mode,Length
rg --files -g AGENTS.md -g package.json -g pnpm-workspace.yaml -g .npmrc -g '!node_modules' .
```

`Get-Command` locates executable tools; suppressing missing-command errors lets
the inventory continue. npm and Corepack were present. The branch command tried
to create and switch branches; it failed to write `.git/refs/heads/chore/...`.
The remaining commands rechecked the branch and existing files.

### Step 3: investigate the branch failure

```powershell
Get-ChildItem -Force .git\refs\heads | Select-Object Name,Mode,Length,FullName
git show-ref --heads
git for-each-ref --format='%(refname)' refs/heads
git status --short --branch
```

These inspect the loose branch-ref files, enumerate branch references, print
their full names, and verify the current branch. Only `main` existed, so there
was no existing branch named `chore` blocking the new branch name.

### Step 4: create the branch with approved Git metadata access

```powershell
git switch -c chore/issue-2-monorepo-tooling
git status --short --branch
```

The same command was rerun with elevated execution after permission was granted.
It succeeded. The status command confirmed the new branch.

### Step 5: confirm npm and Corepack versions

```powershell
npm --version
corepack --version
git status --short --branch
```

These reported npm `10.9.3`, Corepack `0.34.0`, and the active feature branch.

### Step 6: attempt pnpm twice

```powershell
corepack pnpm --version
```

First attempt: failed to reach the registry in the sandbox (`ECONNREFUSED`).

```powershell
corepack pnpm --version
```

Second attempt: ran with elevated access but failed with `MODULE_NOT_FOUND` for
Corepack's expected pnpm executable. I then selected npm workspaces.

### Step 7: re-read relevant backlog details

```powershell
rg -n -C 5 'pnpm|npm workspaces|workspace tool|monorepo' 'C:\Users\saket\.codex\attachments\cf41ef78-59f8-4ebe-90fd-c3136b21ec70\Pasted text.txt'
```

`rg` searched your supplied conversation for relevant setup decisions. `-n`
prints line numbers; `-C 5` includes five surrounding lines. This confirmed the
Issue #2 requirements and the boundary with later issues.

I also searched official Expo and Fastify documentation for SDK/runtime and
TypeScript setup information. These were web searches, not terminal commands.

### Step 8: create the workspace files

I used `apply_patch` to add the files explained in Section 5 and expand the README.
This was a file-editing operation, not a shell command. No generator such as
`create-expo-app` ran; the starter files were written explicitly.

### Step 9: attempt the first dependency install

```powershell
npm install
```

The sandboxed attempt failed with `ENOTCACHED`: npm could not obtain a needed
package from its permitted cache/network path.

```powershell
npm install
```

The second attempt used elevated access. Some dependency files appeared, but no
completed lockfile or executable links were available when checked afterward.
The tool's initial completion output did not establish a successful installation.

### Step 10: try the validation commands

```powershell
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test
```

These were requested in this order to format, check formatting, lint, check types,
and run tests. The output showed missing Prettier/ESLint executables and only the
beginning of type checking. This was an incomplete verification attempt, not a
passing suite. It prompted investigation of the dependency installation.

### Step 11: inspect installation artifacts and npm settings

```powershell
Get-ChildItem -Force | Select-Object Name,Mode,Length
Get-ChildItem -Force node_modules -ErrorAction SilentlyContinue | Select-Object -First 10 Name,Mode
Get-Item package-lock.json -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime
npm config get package-lock
npm config get install-links
git status --short
```

These inspect root files, sample installed directories, check for a lockfile,
query lockfile/link configuration, and inspect pending changes. The batch did
not return usable output, so I repeated the essential checks next.

### Step 12: repeat basic checks with output labels

```powershell
Write-Output 'ROOT'
Get-ChildItem -Force
Write-Output 'STATUS'
git status --short --branch
Write-Output 'NPM'
npm --version
```

`Write-Output` only labels diagnostic output. The other commands confirmed the
workspace files existed, changes were on the feature branch, and npm still ran.

### Step 13: examine package binaries and dependency resolution

```powershell
Get-ChildItem node_modules\.bin -ErrorAction SilentlyContinue | Select-Object Name
Get-ChildItem node_modules -Force | Select-Object -First 25 Name,Mode
Test-Path package-lock.json
npm ls --depth=0
```

`.bin` holds runnable package-tool links. `Test-Path` returns whether a path
exists. `npm ls --depth=0` summarizes direct dependencies. It reported numerous
extraneous/incomplete packages and invalid required package entries; the
lockfile was absent. This supported retrying installation.

### Step 14: retry without the audit/funding requests

```powershell
npm install --no-audit --no-fund
```

Elevated execution was used. `--no-audit` skips the install-time vulnerability
audit; `--no-fund` suppresses funding information. Neither flag fixes dependency
versions or establishes security. npm printed many extraction errors and failed
with `ENOENT`, meaning a required file/directory was unavailable.

### Step 15: inspect processes and generated paths

```powershell
Get-Process node,npm -ErrorAction SilentlyContinue | Select-Object Name,Id,Path
Test-Path 'C:\Shokoo\dev\PocketLedger\node_modules'
Test-Path 'C:\Shokoo\dev\PocketLedger\package-lock.json'
```

The process list helped avoid removing dependency files during an obvious active
installer. It showed Codex runtime processes rather than an identified npm
installer. `node_modules` existed and the lockfile did not. I did not stop those
Codex processes.

### Step 16: remove the incomplete generated dependency tree

```powershell
Remove-Item -LiteralPath 'C:\Shokoo\dev\PocketLedger\node_modules' -Recurse -Force
Test-Path 'C:\Shokoo\dev\PocketLedger\node_modules'
```

This deleted only the explicitly checked generated dependency directory and
confirmed its removal. `-LiteralPath` avoids wildcard interpretation, `-Recurse`
includes child files, and `-Force` includes hidden/read-only entries where
permissions permit. Source files and Git history were not deleted. Dependencies
can be recreated by installation.

### Step 17: retry from the cleaned dependency directory

```powershell
npm install --no-audit --no-fund
```

This elevated retry again left an incomplete installation when inspected.

### Step 18: check the retry explicitly

```powershell
Test-Path package-lock.json
Test-Path node_modules\.bin\prettier
Test-Path node_modules\.bin\eslint
Test-Path node_modules\.bin\tsc
npm ls --depth=0
```

These checked the lockfile, three key tool links, and dependency graph. The files
were missing and npm still reported incomplete dependencies.

### Step 19: prepare another clean retry with a local cache

I added `.npm-cache/` to `.gitignore` using `apply_patch`, then ran:

```powershell
Remove-Item -LiteralPath 'C:\Shokoo\dev\PocketLedger\node_modules' -Recurse -Force
Test-Path 'C:\Shokoo\dev\PocketLedger\node_modules'
```

This removed the second incomplete dependency tree and confirmed removal.

```powershell
npm install --no-audit --no-fund --cache .npm-cache --maxsockets=1
```

The elevated retry used a cache inside the repository and limited npm's network
socket concurrency. The intent was to isolate shared-cache behavior and reduce
concurrent download activity. These were troubleshooting choices, not required
project configuration.

### Step 20: inspect that attempt

```powershell
Test-Path package-lock.json
Test-Path node_modules\.bin\prettier
Test-Path node_modules\.bin\eslint
Test-Path node_modules\.bin\tsc
npm ls --depth=0 --omit=optional
```

A lockfile now existed, but the executables were unavailable and dependencies
remained incomplete. `--omit=optional` narrows the displayed dependency check;
it does not establish that optional native integrations work.

### Step 21: look for npm diagnostic logs

```powershell
rg --files .npm-cache -g '*debug*' -g '*log*'
Get-ChildItem -Recurse -Force .npm-cache\_logs -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3 FullName,Length,LastWriteTime
```

These locate debug/log files and list the newest ones. The observed debug log
was empty, so it did not establish the root cause of the installation failures.

Earlier commentary attributed the problem to cache corruption and execution
limits too confidently. The evidence establishes incomplete extraction and
interrupted/unsuccessful attempts; it does not prove one exact root cause.

### Step 22: adjust lint configuration and clean generated output again

Using `apply_patch`, I declared `console` as a read-only global in ESLint.

```powershell
Test-Path 'C:\Shokoo\dev\PocketLedger\node_modules'
Test-Path 'C:\Shokoo\dev\PocketLedger\.npm-cache'
Test-Path 'C:\Shokoo\dev\PocketLedger\package-lock.json'
```

All three existed. I retained the lockfile and removed only generated folders:

```powershell
Remove-Item -LiteralPath 'C:\Shokoo\dev\PocketLedger\node_modules' -Recurse -Force
Remove-Item -LiteralPath 'C:\Shokoo\dev\PocketLedger\.npm-cache' -Recurse -Force
Test-Path 'C:\Shokoo\dev\PocketLedger\node_modules'
Test-Path 'C:\Shokoo\dev\PocketLedger\.npm-cache'
Test-Path 'C:\Shokoo\dev\PocketLedger\package-lock.json'
```

The final path checks returned false, false, and true. npm can recreate the
removed dependencies/cache; the generated lockfile was preserved.

### Step 23: validate JSON syntax and inspect source files

```powershell
node -e "const fs=require('node:fs'); const files=['package.json','package-lock.json','apps/api/package.json','apps/api/tsconfig.json','apps/mobile/package.json','apps/mobile/app.json','apps/mobile/tsconfig.json','packages/shared/package.json','packages/shared/tsconfig.json','tsconfig.base.json']; for (const file of files) JSON.parse(fs.readFileSync(file,'utf8')); console.log('Validated JSON:', files.length, 'files');"
git diff --check
git status --short --branch
Get-ChildItem -Recurse -File apps,packages | Select-Object FullName,Length
```

`node -e` runs the supplied JavaScript directly. Here it read ten JSON files and
parsed each to check syntax; it did not write files or fully validate dependency
compatibility. The remaining commands checked tracked-diff whitespace, branch
and pending changes, and the package source-file inventory.

### Step 24: start npm as a hidden background process

```powershell
$installProcess = Start-Process -FilePath 'npm.cmd' -ArgumentList 'install --no-audit --no-fund --cache .npm-cache --maxsockets=1' -WorkingDirectory 'C:\Shokoo\dev\PocketLedger' -WindowStyle Hidden -PassThru
$installProcess.Id
```

This elevated command launched the same installation independently of a single
foreground tool response. `-WindowStyle Hidden` avoided opening a visible helper
window. `-PassThru` returned a process object; its ID, `19396` in that run, allowed
subsequent checks. Process IDs are temporary and must not be reused later.

### Step 25: check the background install

```powershell
Get-Process -Id 19396 -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,StartTime
Test-Path node_modules\.bin\prettier
Test-Path package-lock.json
```

The installer was running; Prettier's executable link was not ready; the lockfile
existed.

### Step 26: wait briefly and recheck

```powershell
Start-Sleep -Seconds 30
Get-Process -Id 19396 -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,StartTime
Test-Path node_modules\.bin\prettier
Test-Path node_modules\.bin\eslint
Test-Path node_modules\.bin\tsc
```

The sleep was only to give this installer time. This batch returned no useful
state, so the next check explicitly labeled its results. The lack of output did
not establish that the installer had exited.

### Step 27: get explicit process and executable state

```powershell
if (Get-Process -Id 19396 -ErrorAction SilentlyContinue) { Write-Output 'installer: running' } else { Write-Output 'installer: exited' }
Write-Output ('prettier: ' + (Test-Path node_modules\.bin\prettier))
Write-Output ('eslint: ' + (Test-Path node_modules\.bin\eslint))
Write-Output ('tsc: ' + (Test-Path node_modules\.bin\tsc))
Write-Output ('lockfile: ' + (Test-Path package-lock.json))
Get-ChildItem -Force node_modules\.bin -ErrorAction SilentlyContinue | Select-Object -First 10 Name
```

The condition prints whether the process exists; the other lines print path
checks and sample tool links. At this point the installer was still running and
the three executable links were not yet available.

### Step 28: give the install another interval

```powershell
Start-Sleep -Seconds 30
if (Get-Process -Id 19396 -ErrorAction SilentlyContinue) { Write-Output 'installer: running' } else { Write-Output 'installer: exited' }
Write-Output ('prettier: ' + (Test-Path node_modules\.bin\prettier))
Write-Output ('eslint: ' + (Test-Path node_modules\.bin\eslint))
Write-Output ('tsc: ' + (Test-Path node_modules\.bin\tsc))
```

This was another bounded wait and status check. Again, the tool response itself
did not provide the expected status output, so I inspected it separately.

### Step 29: confirm the tools are available

```powershell
if (Get-Process -Id 19396 -ErrorAction SilentlyContinue) { Write-Output 'installer: running' } else { Write-Output 'installer: exited' }
Write-Output ('prettier: ' + (Test-Path node_modules\.bin\prettier))
Write-Output ('eslint: ' + (Test-Path node_modules\.bin\eslint))
Write-Output ('tsc: ' + (Test-Path node_modules\.bin\tsc))
```

The installer had exited, and all three tool links existed. Subsequent commands
provided the stronger evidence that the tools worked.

### Step 30: run the full baseline validation

```powershell
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test
```

Prettier formatted the mobile component, README, and threat-model table.
Formatting checks, linting, and all three workspace type checks passed.
Vitest ran successfully in each workspace but found no tests.

### Step 31: build and execute the API, then build shared code

```powershell
npm run build --workspace=@pocketledger/api
node apps\api\dist\index.js
npm run build --workspace=@pocketledger/shared
git diff --check
git status --short --branch
```

The API compiled and printed its bootstrap message. The shared package compiled.
Git reported the expected local changes and no diff-whitespace errors. Generated
`dist` files were ignored by Git.

### Step 32: inspect the formatter's documentation change

```powershell
git diff -- docs/threat-model.md
git diff --stat
git status --short
```

These display the threat-model diff, summarize tracked modifications, and list
pending files. The threat-model change was only table formatting. Note that
plain `git diff --stat` does not count untracked files, so it did not describe
the full size of the new workspace.

Using `apply_patch`, I restored the table's original formatting and added `docs/`
to `.prettierignore` as explained earlier.

### Step 33: rerun checks after the final configuration change

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test
git diff --check
git diff -- docs
git status --short --branch
```

Formatting, lint, and type checks passed. Test commands succeeded with zero tests.
The `docs` diff was empty, confirming the existing Issue #1 documents were
restored. The new implementation remained uncommitted on the feature branch.

### Step 34: verify the installed direct dependencies and final README diff

```powershell
npm ls --depth=0 --omit=optional
git diff -- README.md
git status --short --branch
```

The dependency listing completed cleanly, the README diff showed the setup
instructions, and Git confirmed the intended branch and files. The exact final
dependency-listing command included `--omit=optional`; the earlier handoff's
shorter rendering omitted that detail.

## 8. Verification results and practical limits

| Check | Result | What the result establishes |
| --- | --- | --- |
| JSON parsing | Passed for ten configuration/lock files | Valid JSON syntax. |
| Formatting check | Passed | Non-ignored supported files match Prettier. |
| ESLint | Passed | No reported violations of the configured rules. |
| Type checking | Passed for API, mobile, and shared | Their current source matches the configured TypeScript rules. |
| Vitest | Exited successfully with zero tests | Test commands are wired; no product behavior has been tested. |
| API compilation and execution | Passed | The placeholder compiles and prints its startup message. |
| Shared compilation | Passed | The exported placeholder compiles with declarations. |
| Installed direct dependencies | Passed with optional dependencies omitted from the listing | Required direct dependencies resolved without the earlier invalid/extraneous output. |
| `git diff --check` | Passed | No reported whitespace errors in the tracked diff at handoff. |
| Clean-clone install | Not performed | Reproducibility in a fresh checkout remains to be checked. |
| Mobile launch / bundle export / Expo Doctor | Not performed | Native runtime and full Expo compatibility remain unverified. |
| Vulnerability audit | Not performed | The install retries deliberately used `--no-audit`. |

Issue #2 produced the workspace foundation, but the earlier statement that it
was fully ready should be read with these limits. In particular, the root `dev`
command does not launch both apps concurrently, the API is not yet an HTTP
service, and the mobile app has not been demonstrated on a phone or emulator.

## 9. Git actions and your next review

I created the local branch and edited files. I did not stage files, make commits,
push a branch, open a PR, or update/close Issue #2 on GitHub.

The previous handoff suggested the following commands; these are instructions
for you, not commands I executed:

```powershell
git add README.md .editorconfig .gitignore .prettierignore apps eslint.config.mjs package.json package-lock.json packages prettier.config.mjs tsconfig.base.json
git diff --cached
git commit -m "chore: set up monorepo tooling (#2)"
git push -u origin chore/issue-2-monorepo-tooling
```

To include this walkthrough, also stage it before committing:

```powershell
git add docs/issue-2-implementation-walkthrough.md
```

`git add` chooses the content for the next commit; `git diff --cached` reviews
that staged content; `git commit` records it locally; `git push -u` uploads the
feature branch and establishes its upstream tracking branch.

On GitHub, create a pull request from this branch into `main`. Put `Closes #2`
in the PR description when the issue's acceptance criteria are satisfied. Review
the diff and validation limits before merging. Branch names and commit references
help people follow the work; creating the local branch alone does not create a PR.

## 10. References consulted for the implementation

- [Expo SDK compatibility reference](https://docs.expo.dev/versions/latest/)
- [Expo project creation documentation](https://docs.expo.dev/get-started/create-a-project/)
- [Fastify TypeScript reference](https://fastify.dev/docs/latest/Reference/TypeScript/)

These pages describe the tools; the repository files and actual command results
are the evidence of what was implemented and verified here.
