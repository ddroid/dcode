# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This repo uses a **multi-context** domain docs layout.

The root `CONTEXT-MAP.md` is the entry point. It points to one `CONTEXT.md` per context. Read the map first, then read each context file relevant to the task.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — use it to identify relevant contexts.
- **Context-specific `CONTEXT.md` files** listed by `CONTEXT-MAP.md`.
- **`docs/adr/`** for system-wide architectural decisions.
- **Context-scoped ADRs**, such as `src/<context>/docs/adr/`, when working inside a specific context.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context repo:

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
