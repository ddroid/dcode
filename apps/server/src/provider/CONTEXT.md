# Provider

The provider subsystem manages CLI coding-agent runtimes — spawning them, translating their wire protocols into a uniform event stream, and presenting their capabilities to the web UI.

## Language

### Core

**ProviderDriverKind**:
An open branded slug naming a driver implementation (e.g. `codex`, `claudeAgent`, `cursor`, `opencode`, `devin`). Picks which driver package handles the protocol, probe, adapter, and text generation.
_Avoid_: provider type, provider name

**ProviderInstanceId**:
A user-defined routing key for a configured provider instance. Threads, sessions, and persisted bindings reference instance ids, never driver kinds.
_Avoid_: provider id

**ProviderDriver**:
A plain value (not a Context.Service) registered at startup that knows how to materialize `ProviderInstance`s from settings. Carries a `configSchema`, `metadata`, `defaultConfig`, and a `create` function.
_Avoid_: provider factory, provider builder

**ProviderInstance**:
One materialized runtime — three captured closures (`snapshot`, `adapter`, `textGeneration`), an id, and a driver kind. Two instances of the same driver share no mutable state.
_Avoid_: provider, runtime

**ProviderAdapter**:
The session/turn/approval runtime for an instance. Translates between T3 Code's session lifecycle and the underlying CLI agent protocol (Codex JSON-RPC, Claude SDK, ACP, OpenCode SDK).
_Avoid_: connector, bridge

### Protocols

**ACP (Agent Client Protocol)**:
JSON-RPC over stdio protocol spoken by Cursor (`agent acp`) and Devin (`devin acp`). The `effect-acp` package provides the typed client; `AcpSessionRuntime` manages the lifecycle.
_Avoid_: agent protocol

**Codex App Server**:
JSON-RPC over stdio protocol spoken by `codex app-server`. Managed by `CodexSessionRuntime`.
_Avoid_: codex RPC

**Claude SDK**:
The `@anthropic-ai/claude-agent-sdk` TypeScript SDK used to spawn and interact with Claude Code.
_Avoid_: claude protocol

### Lifecycle

**ServerProvider**:
The snapshot shape pushed to the web UI — contains status, models, auth state, version, and capabilities for one provider instance.
_Avoid_: provider state, provider info

**ServerProviderDraft**:
A `ServerProvider` without `instanceId` and `driver` fields. Produced by driver-level helpers; the driver stamps identity before publishing.
_Avoid_: partial snapshot

**ProviderRuntimeEvent**:
A discriminated-union event emitted by adapters during a session. Types include `session.started`, `turn.started`, `content.delta`, `request.opened`, etc. Projected into orchestration domain events server-side.
_Avoid_: provider event, runtime message

**ManagedServerProvider**:
A `ServerProviderShape` that owns its own refresh lifecycle — periodic re-probing, enrichment hooks, and change streaming. Created via `makeManagedServerProvider`.
_Avoid_: auto-refreshing provider

### Configuration

**ProviderInstanceConfig**:
The envelope shape in `ServerSettings.providerInstances`. Keyed by `ProviderInstanceId`, carries `driver`, `displayName`, `accentColor`, `environment`, `enabled`, and an opaque `config` payload decoded by the driver.
_Avoid_: provider config, instance settings

**ProviderSettings** (e.g. `CodexSettings`, `ClaudeSettings`, `DevinSettings`):
The typed config payload inside a `ProviderInstanceConfig.config` envelope. Each driver owns its own schema. Rendered generically in the settings UI via field annotations.
_Avoid_: driver config, driver settings

### Text Generation

**TextGenerationShape**:
Service API for generating commit messages, PR titles, branch names, and thread titles. Each driver bundles an implementation on its `ProviderInstance`.
_Avoid_: git text, commit generator

### Maintenance

**ProviderMaintenanceCapabilities**:
Describes how a driver can be updated — package manager commands, native update commands, or manual-only. Used by the maintenance runner to offer one-click updates in the UI.
_Avoid_: update capabilities

## Relationships

- A **ProviderDriver** produces **ProviderInstance**s via its `create` function
- A **ProviderInstance** bundles one **ServerProviderShape** (snapshot), one **ProviderAdapter**, and one **TextGenerationShape**
- **ProviderInstanceConfig** is decoded by **ProviderDriver.configSchema** into typed **ProviderSettings**
- **ProviderAdapter** emits **ProviderRuntimeEvent**s consumed by the orchestration layer
- Multiple **ProviderInstance**s of the same **ProviderDriverKind** can coexist (e.g. `codex_personal` + `codex_work`)

## Example dialogue

> **Dev:** "When a user adds a second Devin instance, does it share state with the first?"
> **Domain expert:** "No — each **ProviderInstance** is fully independent. The **ProviderDriver**'s `create` captures the config in closures. Two instances of the same **ProviderDriverKind** share no mutable state."

> **Dev:** "Where does the model list come from for ACP drivers?"
> **Domain expert:** "It depends. Cursor probes models via ACP `getConfigOptions`. Devin doesn't support that, so it uses a static built-in list merged with **ProviderSettings**.`customModels` via `providerModelsFromSettings`."

## Flagged ambiguities

- "provider" was historically used to mean both the driver kind and a specific instance — resolved: **ProviderDriverKind** is the implementation selector, **ProviderInstanceId** is the routing key, **ProviderInstance** is the materialized runtime.
