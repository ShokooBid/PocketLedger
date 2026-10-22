---
name: solid-code-quality
description: Apply SOLID principles when reviewing code structure or refactoring modules with unclear responsibilities, tightly coupled dependencies, or incompatible interfaces. Also use when explicitly asked to implement code using SOLID principles.
---

# SOLID Code Quality

Apply SOLID principles to improve maintainability without introducing unnecessary complexity. If the existing design is appropriate, do not refactor just to demonstrate the principles.

## Before changing code

Inspect the affected modules, their consumers, and existing project conventions and tests. Identify their responsibilities and the behavior that must be preserved. Keep changes scoped to the requested problem; a review request alone does not authorize edits.

## Apply the SOLID principles

- **Single responsibility:** Separate business logic, persistence, validation, and presentation when they have independent reasons to change. Do not split cohesive code solely to reduce file or function size.
- **Open/closed:** Consider composition, strategies, or interfaces when existing variants or demonstrated changes justify extension points. Avoid abstractions for hypothetical future needs.
- **Liskov substitution:** Implementations must honor their interface's behavioral contract, including error behavior. Do not strengthen preconditions or weaken postconditions; avoid inheritance when a subtype cannot safely replace its base.
- **Interface segregation:** Shape interfaces around consumer needs. Avoid forcing implementations to supply unrelated methods.
- **Dependency inversion:** Separate business rules from infrastructure when it meaningfully reduces coupling. Inject dependencies that need independent replacement, testing, or configuration; do not add an interface for every concrete dependency.

## Design decisions

Follow existing language and framework conventions. Apply these principles to functions, hooks, and modules where appropriate; do not introduce classes solely to use SOLID terminology.

Preserve observable behavior during refactoring. Do not combine unrelated code into an abstraction merely to remove a few repeated lines. Prefer the smallest change that addresses a concrete responsibility, contract, or coupling problem.

## Testing and verification

Add or update tests when behavior changes or a refactor introduces meaningful regression risk. Prefer tests of observable behavior over tests tied to implementation details. Cover relevant failure scenarios and contract guarantees.

Run relevant existing tests, type checks, or lint checks for the affected code. Fix regressions introduced by the changes and report what actually ran, including failures or checks that could not run.

## Report the result

For reviews, tie each finding to a concrete location and behavioral or maintenance consequence. If no meaningful design problem is found, say so.

For edits, summarize what changed, why, and the verification performed. Mention SOLID principles only where they explain a design decision, and include any material remaining trade-offs.
