# Context Map

## Contexts

- [Provider](./apps/server/src/provider/CONTEXT.md) — manages CLI agent runtimes (Codex, Claude, Cursor, OpenCode, Devin), their lifecycle, configuration, and event translation

## Relationships

- **Provider → Orchestration**: Provider adapters emit `ProviderRuntimeEvent`s; the orchestration layer projects them into domain events pushed to the web client via WebSocket
- **Provider → TextGeneration**: Each provider instance bundles a `TextGenerationShape` used by the VCS layer for commit messages, PR titles, and branch names
- **Provider ↔ Contracts**: Provider drivers consume settings schemas and emit runtime event types defined in `packages/contracts`
