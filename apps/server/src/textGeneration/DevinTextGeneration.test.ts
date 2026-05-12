// @effect-diagnostics nodeBuiltinImport:off
import * as path from "node:path";
import * as os from "node:os";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { createModelSelection } from "@t3tools/shared/model";
import { expect } from "vitest";

import { DevinSettings, ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import { ServerConfig } from "../config.ts";
import { makeDevinTextGeneration } from "./DevinTextGeneration.ts";
import type { TextGenerationShape } from "./TextGeneration.ts";

const decodeDevinSettings = Schema.decodeSync(DevinSettings);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockAgentPath = path.join(__dirname, "../../scripts/acp-mock-agent.ts");
const bunExe = "bun";

async function makeMockAgentWrapper(responseText: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "devin-text-generation-mock-"));
  const wrapperPath = path.join(dir, "fake-devin.sh");
  const script = `#!/bin/sh
export T3_ACP_PROMPT_RESPONSE_TEXT=${JSON.stringify(responseText)}
exec ${JSON.stringify(bunExe)} ${JSON.stringify(mockAgentPath)} "$@"
`;
  await writeFile(wrapperPath, script, "utf8");
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

const DEFAULT_TEST_MODEL_SELECTION = createModelSelection(
  ProviderInstanceId.make("devin"),
  "swe-1.6",
);

const DevinTextGenerationTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-devin-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

function withMockDevinEnv<A, E, R>(
  responseText: string,
  effectFn: (textGeneration: TextGenerationShape) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const binaryPath = yield* Effect.promise(() => makeMockAgentWrapper(responseText));
    const settings = decodeDevinSettings({ binaryPath });
    const textGeneration = yield* makeDevinTextGeneration(settings);
    return yield* effectFn(textGeneration);
  });
}

it.layer(DevinTextGenerationTestLayer)("DevinTextGeneration", (it) => {
  it.effect("generates and sanitizes commit messages", () =>
    withMockDevinEnv(
      JSON.stringify({
        subject:
          "  Add important change to the system with too much detail and a trailing period.\nsecondary line",
        body: "\n- added migration\n- updated tests\n",
      }),
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/devin-effect",
            stagedSummary: "M README.md",
            stagedPatch: "diff --git a/README.md b/README.md",
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          });

          expect(generated.subject.length).toBeLessThanOrEqual(72);
          expect(generated.subject.endsWith(".")).toBe(false);
          expect(generated.body).toBe("- added migration\n- updated tests");
          expect(generated.branch).toBeUndefined();
        }),
    ),
  );

  it.effect("generates commit message with branch when includeBranch is true", () =>
    withMockDevinEnv(
      JSON.stringify({
        subject: "Add important change",
        body: "",
        branch: "fix/important-system-change",
      }),
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/devin-effect",
            stagedSummary: "M README.md",
            stagedPatch: "diff --git a/README.md b/README.md",
            includeBranch: true,
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          });

          expect(generated.subject).toBe("Add important change");
          expect(generated.branch).toBe("feature/fix/important-system-change");
        }),
    ),
  );

  it.effect("generates PR content and trims markdown body", () =>
    withMockDevinEnv(
      JSON.stringify({
        title: "  Improve orchestration flow\nwith ignored suffix",
        body: "\n## Summary\n- improve flow\n\n## Testing\n- bun test\n\n",
      }),
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generatePrContent({
            cwd: process.cwd(),
            baseBranch: "main",
            headBranch: "feature/devin-effect",
            commitSummary: "feat: improve orchestration flow",
            diffSummary: "2 files changed",
            diffPatch: "diff --git a/a.ts b/a.ts",
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          });

          expect(generated.title).toBe("Improve orchestration flow");
          expect(generated.body.startsWith("## Summary")).toBe(true);
          expect(generated.body.endsWith("\n\n")).toBe(false);
        }),
    ),
  );

  it.effect("generates branch names and normalizes branch fragments", () =>
    withMockDevinEnv(
      JSON.stringify({
        branch: "  Feat/Session  ",
      }),
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateBranchName({
            cwd: process.cwd(),
            message: "Please update session handling.",
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          });

          expect(generated.branch).toBe("feat/session");
        }),
    ),
  );

  it.effect("generates thread titles and trims them for sidebar use", () =>
    withMockDevinEnv(
      JSON.stringify({
        title:
          '  "Investigate websocket reconnect regressions after worktree restore"  \nignored line',
      }),
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateThreadTitle({
            cwd: process.cwd(),
            message: "Please investigate websocket reconnect regressions after a worktree restore.",
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          });

          expect(generated.title).toBe("Investigate websocket reconnect regressions aft...");
        }),
    ),
  );

  it.effect("returns typed TextGenerationError on empty output", () =>
    withMockDevinEnv("", (textGeneration) =>
      Effect.gen(function* () {
        const result = yield* textGeneration
          .generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/devin-empty",
            stagedSummary: "M README.md",
            stagedPatch: "diff --git a/README.md b/README.md",
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(TextGenerationError);
          expect(result.failure.message).toContain("Devin returned empty output.");
        }
      }),
    ),
  );

  it.effect("returns typed TextGenerationError on invalid structured output", () =>
    withMockDevinEnv("not valid json", (textGeneration) =>
      Effect.gen(function* () {
        const result = yield* textGeneration
          .generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/devin-invalid",
            stagedSummary: "M README.md",
            stagedPatch: "diff --git a/README.md b/README.md",
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(TextGenerationError);
          expect(result.failure.message).toContain("Devin returned invalid structured output.");
        }
      }),
    ),
  );

  it.effect("returns typed TextGenerationError on wrong payload shape", () =>
    withMockDevinEnv(JSON.stringify({ title: "This is not a commit payload" }), (textGeneration) =>
      Effect.gen(function* () {
        const result = yield* textGeneration
          .generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/devin-shape",
            stagedSummary: "M README.md",
            stagedPatch: "diff --git a/README.md b/README.md",
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          })
          .pipe(Effect.result);

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(TextGenerationError);
          expect(result.failure.message).toContain("Devin returned invalid structured output.");
        }
      }),
    ),
  );
});
