# Project instructions

## Code quality

- Use the `solid-code-quality` skill at `.agents/skills/solid-code-quality/SKILL.md` when reviewing or refactoring module design, or when SOLID principles are explicitly requested.
- Preserve existing behavior during refactoring unless a behavior change is requested.
- Keep business logic separate from UI rendering when it can be tested independently.

## Verification

- Run tests, lint, and type checks relevant to the changed code. Start with the affected workspace and expand when failures or cross-workspace changes warrant it.
- Inspect changed files for obvious mistakes. Report which checks ran and their results; state clearly if a check could not run.

## Efficient workflow

- Inspect the code, callers, tests, and configuration needed to understand the change; expand the search when behavior or dependencies are unclear. Keep command output and final reports concise without omitting important findings.
