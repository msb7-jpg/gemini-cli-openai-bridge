import { randomUUID } from "node:crypto";
import {
  thoughtSignatureCache,
  lastThoughtSignatureByTool,
  toolCallNameCache,
} from "../utils/thought-signature-cache.js";
import { type StreamChunk } from "../types.js";
import { globalQuotaTracker } from "../services/quota-tracker.js";

// --- OpenAI Response Interfaces ---
interface OpenAIDelta {
  role?: "assistant";
  content?: string | null;
  tool_calls?: {
    index: number;
    id: string;
    type: "function";
    function: {
      name?: string;
      arguments?: string;
    };
  }[];
}

interface OpenAIChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: OpenAIDelta;
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
}

// --- New Stateful Transformer ---
export function createOpenAIStreamTransformer(
  model: string,
  debugMode = false,
): TransformStream<StreamChunk, Uint8Array> {
  const chatID = `chatcmpl-${randomUUID()}`;
  const creationTime = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  let isFirstChunk = true;
  let toolCallIndex = 0;
  let usageData: OpenAIChunk["usage"] = null;

  const createChunk = (
    delta: OpenAIDelta,
    finish_reason: string | null = null,
    usage: OpenAIChunk["usage"] = null,
  ): OpenAIChunk => {
    const chunk: OpenAIChunk = {
      id: chatID,
      object: "chat.completion.chunk",
      created: creationTime,
      model: model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason,
        },
      ],
    };
    if (usage) {
      chunk.usage = usage;
    }
    return chunk;
  };

  const enqueueChunk = (
    controller: TransformStreamDefaultController<Uint8Array>,
    chunk: OpenAIChunk,
  ) => {
    const sseString = `data: ${JSON.stringify(chunk)}\n\n`;
    controller.enqueue(encoder.encode(sseString));
  };

  return new TransformStream({
    transform(chunk: StreamChunk, controller) {
      if (debugMode) {
        console.log(
          `[Stream Transformer] Received chunk: ${chunk.type}`,
          chunk.data ? JSON.stringify(chunk.data) : "",
        );
      }
      let delta: OpenAIDelta = {};

      if (isFirstChunk) {
        delta.role = "assistant";
        isFirstChunk = false;
      }

      switch (chunk.type) {
        case "text":
          if (chunk.data) {
            delta.content = chunk.data;
            enqueueChunk(controller, createChunk(delta));
          }
          break;

        case "tool_code": {
          const { name, args, thoughtSignature } = chunk.data;
          // IMPORTANT: Embed the function name in the ID so it can be parsed when a tool response is received.
          const toolCallId = `call_${name}_${randomUUID()}`;
          toolCallNameCache.set(toolCallId, name);
          if (thoughtSignature) {
            thoughtSignatureCache.set(toolCallId, thoughtSignature);
            lastThoughtSignatureByTool.set(name, thoughtSignature);
          }

          // OpenAI streaming tool calls need to be sent in chunks.
          // 1. Send the chunk containing the function name.
          const nameDelta: OpenAIDelta = {
            ...delta, // Include role if it's the first chunk
            tool_calls: [
              {
                index: toolCallIndex,
                id: toolCallId,
                type: "function",
                function: { name: name, arguments: "" },
              },
            ],
          };
          enqueueChunk(controller, createChunk(nameDelta));

          // 2. Send the chunk containing the arguments.
          const argsDelta: OpenAIDelta = {
            tool_calls: [
              {
                index: toolCallIndex,
                id: toolCallId,
                type: "function",
                function: { arguments: JSON.stringify(args) },
              },
            ],
          };
          enqueueChunk(controller, createChunk(argsDelta));

          toolCallIndex++;
          break;
        }

        case "reasoning":
          // These events currently have no direct equivalent in the OpenAI format and can be ignored or logged.
          if (debugMode) {
            console.log(`[Stream Transformer] Ignoring chunk: ${chunk.type}`);
          }
          break;

        case "usage":
          if (chunk.data) {
            const prompt = chunk.data.promptTokenCount || 0;
            const completion = chunk.data.candidatesTokenCount || 0;
            const cached = chunk.data.cachedContentTokenCount || 0;
            const total = chunk.data.totalTokenCount || prompt + completion;

            globalQuotaTracker.recordUsage(model, {
              promptTokens: prompt,
              completionTokens: completion,
              cachedTokens: cached,
              totalTokens: total,
            });

            usageData = {
              prompt_tokens: prompt,
              completion_tokens: completion,
              total_tokens: total,
            };
          }
          break;
      }
    },

    flush(controller) {
      // At the end of the stream, send a finish_reason of 'tool_calls' or 'stop'.
      const finish_reason = toolCallIndex > 0 ? "tool_calls" : "stop";
      enqueueChunk(controller, createChunk({}, finish_reason, usageData));

      const doneString = `data: [DONE]\n\n`;
      controller.enqueue(encoder.encode(doneString));
    },
  });
}
