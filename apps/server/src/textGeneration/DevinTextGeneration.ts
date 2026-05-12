import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import { TextGenerationError, type DevinSettings, type ModelSelection } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

import { makeDevinAcpRuntime } from "../provider/acp/DevinAcpSupport.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import type { TextGenerationShape } from "./TextGeneration.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const DEVIN_TEXT_GENERATION_TIMEOUT = "30 seconds";

const isTextGenerationError = Schema.is(TextGenerationError);

export const makeDevinTextGeneration = Effect.fn("makeDevinTextGeneration")(function* (
  devinSettings: DevinSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runDevinJson = <S extends Schema.Top>(input: {
    readonly operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchemaJson: S;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const collectedTextRef = yield* Ref.make("");

      const acp = yield* makeDevinAcpRuntime({
        devinSettings,
        cwd: input.cwd,
        childProcessSpawner: spawner,
        environment,
        clientInfo: { name: "t3-code", version: "0.0.0" },
      });

      yield* acp.handleSessionUpdate((notification) => {
        const update = notification.update;
        if (update.sessionUpdate !== "agent_message_chunk") {
          return Effect.void;
        }
        const content = update.content;
        if (content.type !== "text") {
          return Effect.void;
        }
        return Ref.update(collectedTextRef, (current) => current + content.text);
      });

      yield* Effect.logDebug("DevinTextGeneration: starting ACP session");

      yield* acp.start();

      yield* Effect.logDebug("DevinTextGeneration: sending prompt");

      const promptResult = yield* acp
        .prompt({
          prompt: [{ type: "text", text: input.prompt }],
        })
        .pipe(
          Effect.timeoutOption(DEVIN_TEXT_GENERATION_TIMEOUT),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new TextGenerationError({
                    operation: input.operation,
                    detail: "Devin text generation timed out.",
                  }),
                ),
              onSome: (result) => Effect.succeed(result),
            }),
          ),
        );

      yield* Effect.logDebug("DevinTextGeneration: prompt done");

      const rawText = (yield* Ref.get(collectedTextRef)).trim();

      if (rawText.length === 0) {
        return yield* new TextGenerationError({
          operation: input.operation,
          detail:
            promptResult.stopReason === "cancelled"
              ? "Devin text generation was cancelled."
              : "Devin returned empty output.",
        });
      }

      const jsonText = extractJsonObject(rawText);
      const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(input.outputSchemaJson));
      return yield* decodeOutput(jsonText).pipe(
        Effect.catchTag("SchemaError", (schemaError) =>
          Effect.fail(
            new TextGenerationError({
              operation: input.operation,
              detail: "Devin returned invalid structured output.",
              cause: schemaError,
            }),
          ),
        ),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation: input.operation,
              detail: `Devin ACP request failed: ${cause.message ?? String(cause)}`,
              cause,
            }),
      ),
      Effect.scoped,
    );

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "DevinTextGeneration.generateCommitMessage",
  )(function* (input) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });

    const generated = yield* runDevinJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "DevinTextGeneration.generatePrContent",
  )(function* (input) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });

    const generated = yield* runDevinJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "DevinTextGeneration.generateBranchName",
  )(function* (input) {
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    const generated = yield* runDevinJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "DevinTextGeneration.generateThreadTitle",
  )(function* (input) {
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    const generated = yield* runDevinJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    };
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationShape;
});
