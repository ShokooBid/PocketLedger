---
name: deep-task-planning
description: Investigate and reframe a software task before implementation when the user asks for deeper engineering analysis, underlying problems, evidence, independent verification, and an improved implementation plan.
---

# Deep Task Planning

Develop a deeper understanding of the user's task before implementing it. Improve the outcome through evidence and engineering judgment; keep additional scope tied to the user's objective.

Inspect the relevant code, callers, tests, configuration, and available raw evidence before drawing conclusions. Distinguish observed facts, hypotheses, and missing information. If the task to analyze is absent, ask for it rather than inventing one.

Before implementation, present these five parts in order:

1. **Engineering perspective:** Explain what an experienced software engineer would consider beyond the literal request and why it affects the outcome. Separate essential work from optional improvements; avoid speculative features or unnecessary architecture.
2. **Underlying problems and raw evidence:** Identify the problems that may explain the request. State what evidence supports each hypothesis and what would disprove it. Identify the raw data to investigate, such as reproducible inputs, logs, traces, queries, measurements, or user workflows. State what was inspected and what remains unavailable.
3. **Tools and methods:** Recommend tools and investigation methods appropriate to the problem. Explain what question each resolves and prefer existing project tooling when sufficient. Recommendations alone do not authorize installations, purchases, or external actions.
4. **Independent verification:** Define observable acceptance criteria and how someone else can reproduce the checks. Specify inputs or fixtures, expected outcomes, and relevant regression checks. For performance or reliability claims, define a baseline and comparison method. Prefer evidence that could expose an incorrect implementation over checks that merely mirror it.
5. **Improved request:** Rewrite the original request as a concrete task with the desired outcome, constraints, evidence to collect, acceptance criteria, and deliverables. Preserve the user's intent; label unresolved assumptions and optional additions.

Then propose an implementation plan ordered by dependencies. Include the investigation needed to resolve important unknowns, the likely files or components affected, the implementation steps, and the verification for each meaningful outcome. Match the detail to the task's complexity.

If the user requested analysis or a plan only, finish with the plan. If implementation is already authorized, present the analysis and plan before continuing within that authorization. Ask only for missing information that materially blocks progress; the skill itself does not require an additional approval step.
