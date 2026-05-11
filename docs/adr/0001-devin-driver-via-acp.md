# Devin driver uses ACP over stdio

Devin CLI exposes `devin acp`, an ACP (Agent Client Protocol) server over stdio speaking JSON-RPC — the same protocol Cursor's `agent acp` uses. We integrate Devin through the existing `effect-acp` client and `AcpSessionRuntime` infrastructure rather than wrapping the interactive TUI or the `-p/--print` non-interactive mode.

## Considered Options

- **ACP (`devin acp`)** — structured JSON-RPC, session lifecycle, streaming events, permission requests, and cancellation. Reuses the battle-tested `AcpSessionRuntime`, `AcpCoreRuntimeEvents`, and `AcpAdapterSupport` shared with Cursor.
- **Print mode (`devin -p`)** — simpler but no session lifecycle, no streaming events, no approval flow, no cancellation. Would require a fundamentally different adapter shape.
- **Devin MCP server (`mcp.devin.ai`)** — cloud-based, requires API key, different protocol (MCP not ACP), no local execution. Not suitable for a local CLI driver.

## Consequences

- Devin's ACP does not support `agent/getConfigOptions` or `agent/getModels`, so the driver uses a static built-in model list rather than runtime discovery. If Devin adds these methods later, we can upgrade without changing the adapter's core structure.
- Text generation (commit messages, PR titles) also runs through ACP sessions rather than `devin -p`, keeping a single integration path.
- The `DevinAcpSupport` module is intentionally simpler than `CursorAcpSupport` — no model-capability probing, no Cursor-specific ACP extensions (plan requests, todos).
