/**
 * @license
 * Copyright 2025-2026 Google LLC / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Config, GeminiChat } from "@google/gemini-cli-core";
import {
  type Part,
  type Tool,
  type FunctionDeclaration,
  type GenerateContentConfig,
  FunctionCallingConfigMode,
} from "@google/genai";
import {
  type CanonicalRequest,
  type CanonicalToolDefinition,
  type CanonicalStreamEvent,
} from "./canonical-ir.types.js";
import { sanitizeGeminiSchema } from "./schema-sanitizer.js";
import { normalizeCanonicalMessagesToGemini } from "./message-normalizer.js";
import { logger } from "../../shared/logger.js";
import { resolveModelId } from "../../features/models-and-quota/model-resolver.js";
import {
  isAdaptiveModel,
  globalAdaptiveRouter,
} from "../../features/adaptive-routing/adaptive-router.js";
import { type AdaptiveRouteDecision } from "../../features/adaptive-routing/adaptive.types.js";
import { globalQuotaTracker } from "../../features/models-and-quota/quota-tracker.service.js";

interface PartWithThoughtSignature {
  thoughtSignature?: string;
  thought_signature?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiStreamResponse {
  usageMetadata?: GeminiUsageMetadata;
  candidates?: Array<{
    content?: {
      parts?: Part[];
    };
  }>;
}

function convertCanonicalToolsToGemini(tools?: CanonicalToolDefinition[]): Tool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => {
    let parameters: FunctionDeclaration["parameters"];
    if (tool.parameters) {
      const sanitized = sanitizeGeminiSchema(tool.parameters, {
        isRootParameters: true,
      }) as Record<string, unknown>;
      if (typeof sanitized === "object" && sanitized !== null) {
        if (!sanitized.type) {
          sanitized.type = "object";
        }
        parameters = sanitized as FunctionDeclaration["parameters"];
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters,
    };
  });

  if (functionDeclarations.length === 0) {
    return undefined;
  }

  return [{ functionDeclarations }];
}

function createCanonicalEventGenerator(
  geminiStream: AsyncIterable<unknown>,
): AsyncGenerator<CanonicalStreamEvent> {
  return (async function* (): AsyncGenerator<CanonicalStreamEvent> {
    for await (const response of geminiStream) {
      const streamResponse = response as unknown as GeminiStreamResponse;
      if (streamResponse.usageMetadata) {
        yield { type: "usage", data: streamResponse.usageMetadata };
      }
      const parts = streamResponse.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.text) {
          yield { type: "text", data: part.text };
        }
        if (part.functionCall && part.functionCall.name) {
          const partWithSignature = part as unknown as PartWithThoughtSignature;
          const thoughtSignature =
            partWithSignature.thoughtSignature || partWithSignature.thought_signature || undefined;
          yield {
            type: "tool_code",
            data: {
              name: part.functionCall.name,
              args: (part.functionCall.args as Record<string, unknown>) ?? {},
              thoughtSignature,
            },
          };
        }
      }
    }
  })();
}

/**
 * Protocol-agnostic transport client that dispatches `CanonicalRequest` payloads
 * to `@google/gemini-cli-core` and yields `CanonicalStreamEvent` chunks.
 */
export class GeminiTransportClient {
  private readonly config: Config;
  private readonly contentGenerator;
  private readonly debugMode: boolean;
  private lastRoutingDecision?: AdaptiveRouteDecision;

  constructor(config: Config, debugMode = false) {
    this.config = config;
    this.contentGenerator = this.config.getGeminiClient().getContentGenerator();
    this.debugMode = debugMode;
  }

  /**
   * Returns the most recent adaptive routing decision, if adaptive routing was used.
   *
   * @returns The AdaptiveRouteDecision, or undefined if standard routing was used.
   */
  public getLastRoutingDecision(): AdaptiveRouteDecision | undefined {
    return this.lastRoutingDecision;
  }

  /**
   * Sends a streaming request to the Gemini API using the Canonical Intermediate Representation.
   * @param request - Protocol-agnostic canonical request.
   * @returns An async generator yielding canonical stream events.
   */
  public async sendCanonicalStream(
    request: CanonicalRequest,
  ): Promise<AsyncGenerator<CanonicalStreamEvent>> {
    const { model, messages, systemPrompt, tools, toolChoice } = request;
    const useInternalPrompt = !!this.config.getUserMemory();

    const { contents, systemInstruction } = normalizeCanonicalMessagesToGemini(messages, {
      systemPrompt,
      useInternalPrompt,
    });

    if (contents.length === 0) {
      throw new Error("No message to send.");
    }

    const lastMessage = contents.pop()!;
    const history = contents;

    let canonicalModel = resolveModelId(model);

    if (isAdaptiveModel(canonicalModel) || isAdaptiveModel(model)) {
      const quotaSnapshot = globalQuotaTracker.getSnapshot();
      const decision = globalAdaptiveRouter.route({
        request,
        quotaSnapshot,
      });
      this.lastRoutingDecision = decision;
      canonicalModel = decision.targetModel;
      logger.info("Adaptive router selected model", {
        requestedModel: model,
        tier: decision.tier,
        targetModel: decision.targetModel,
        reason: decision.reason,
        latencyMs: decision.latencyMs,
      });
    } else {
      this.lastRoutingDecision = undefined;
    }

    logger.info("Calling Gemini API", { model: canonicalModel, requestedModel: model });

    logger.debug(this.debugMode, "Sending request to Gemini", {
      historyLength: history.length,
      lastMessage,
    });

    const createConfigForModel = (modelId: string) => {
      return new Proxy(this.config, {
        get(target, prop, receiver) {
          if (prop === "getModel") {
            return () => modelId;
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    };

    const oneShotChat = new GeminiChat(
      createConfigForModel(canonicalModel),
      this.contentGenerator,
      {},
      history,
    );
    const geminiTools = convertCanonicalToolsToGemini(tools);

    const generationConfig: GenerateContentConfig = {};
    if (systemInstruction) {
      generationConfig.systemInstruction = systemInstruction;
    }

    if (toolChoice && toolChoice !== "auto" && typeof toolChoice === "object") {
      const choice = toolChoice as { type?: string; function?: { name?: string } };
      generationConfig.toolConfig = {
        functionCallingConfig: {
          mode:
            choice.type === "function"
              ? FunctionCallingConfigMode.ANY
              : FunctionCallingConfigMode.AUTO,
          allowedFunctionNames: choice.function?.name ? [choice.function.name] : undefined,
        },
      };
    }

    const promptId = Math.random().toString(16).slice(2);
    let geminiStream: AsyncIterable<unknown>;

    try {
      geminiStream = (await oneShotChat.sendMessageStream(
        {
          message: lastMessage.parts || [],
          config: {
            tools: geminiTools,
            ...generationConfig,
          },
        },
        promptId,
      )) as unknown as AsyncIterable<unknown>;
    } catch (primaryError: unknown) {
      if (this.lastRoutingDecision && globalAdaptiveRouter.getConfig().quotaFallbackEnabled) {
        const errorStr =
          primaryError instanceof Error ? primaryError.message : String(primaryError);
        const isQuotaError =
          errorStr.includes("429") ||
          errorStr.toLowerCase().includes("quota") ||
          errorStr.toLowerCase().includes("resource_exhausted");

        if (isQuotaError) {
          globalQuotaTracker.recordQuotaError(primaryError);
          const fallback = globalAdaptiveRouter.getNextFallbackTier(this.lastRoutingDecision.tier);
          if (fallback) {
            logger.warn("Adaptive router quota fallback triggered", {
              fromModel: canonicalModel,
              toModel: fallback.targetModel,
              fromTier: this.lastRoutingDecision.tier,
              toTier: fallback.tier,
            });
            this.lastRoutingDecision = {
              tier: fallback.tier,
              targetModel: fallback.targetModel,
              reason: `quota_fallback_from_${canonicalModel}`,
              latencyMs: this.lastRoutingDecision.latencyMs,
            };

            const fallbackChat = new GeminiChat(
              createConfigForModel(fallback.targetModel),
              this.contentGenerator,
              {},
              history,
            );
            geminiStream = (await fallbackChat.sendMessageStream(
              {
                message: lastMessage.parts || [],
                config: {
                  tools: geminiTools,
                  ...generationConfig,
                },
              },
              promptId,
            )) as unknown as AsyncIterable<unknown>;
            logger.debug(this.debugMode, "Got fallback stream from Gemini.");
            return createCanonicalEventGenerator(geminiStream);
          }
        }
      }
      throw primaryError;
    }

    logger.debug(this.debugMode, "Got stream from Gemini.");
    return createCanonicalEventGenerator(geminiStream);
  }
}
