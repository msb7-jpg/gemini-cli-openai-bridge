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

  const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: sanitizeGeminiSchema(tool.parameters) as FunctionDeclaration["parameters"],
  }));

  if (functionDeclarations.length === 0) {
    return undefined;
  }

  return [{ functionDeclarations }];
}

/**
 * Protocol-agnostic transport client that dispatches `CanonicalRequest` payloads
 * to `@google/gemini-cli-core` and yields `CanonicalStreamEvent` chunks.
 */
export class GeminiTransportClient {
  private readonly config: Config;
  private readonly contentGenerator;
  private readonly debugMode: boolean;

  constructor(config: Config, debugMode = false) {
    this.config = config;
    this.contentGenerator = this.config.getGeminiClient().getContentGenerator();
    this.debugMode = debugMode;
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

    const canonicalModel = resolveModelId(model);
    logger.info("Calling Gemini API", { model: canonicalModel, requestedModel: model });

    logger.debug(this.debugMode, "Sending request to Gemini", {
      historyLength: history.length,
      lastMessage,
    });

    const requestConfig = new Proxy(this.config, {
      get(target, prop, receiver) {
        if (prop === "getModel") {
          return () => canonicalModel;
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const oneShotChat = new GeminiChat(requestConfig, this.contentGenerator, {}, history);
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
    const geminiStream = await oneShotChat.sendMessageStream(
      {
        message: lastMessage.parts || [],
        config: {
          tools: geminiTools,
          ...generationConfig,
        },
      },
      promptId,
    );

    logger.debug(this.debugMode, "Got stream from Gemini.");

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
              partWithSignature.thoughtSignature ||
              partWithSignature.thought_signature ||
              undefined;
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
}
