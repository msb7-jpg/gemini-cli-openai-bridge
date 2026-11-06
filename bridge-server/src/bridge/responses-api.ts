/**
 * @license
 * Copyright 2025 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */
import { FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { type Config } from "@google/gemini-cli-core";
import { GeminiApiClient } from "../gemini-client.js";
import { resolveModelId } from "../utils/model-resolver.js";
import { logger } from "../utils/logger.js";
import { randomUUID } from "node:crypto";
import { globalQuotaTracker } from "../services/quota-tracker.js";
import type { OpenAIMessage, MessageContentPart, OpenAITool } from "../types.js";

interface ResponsesApiInputItem {
  type: string;
  role?: string;
  content?: Array<{
    type: string;
    text?: string;
    image_url?: { url: string };
  }>;
}

interface ResponsesApiRequestBody {
  model?: string;
  input?: ResponsesApiInputItem[];
  tools?: unknown;
  tool_choice?: unknown;
}

export async function registerResponsesApiRoutes(
  app: FastifyInstance,
  config: Config,
  debugMode = false,
): Promise<void> {
  const handler = async (
    req: FastifyRequest<{ Body: ResponsesApiRequestBody }>,
    reply: FastifyReply,
  ) => {
    const requestId = randomUUID();
    globalQuotaTracker.recordRequestStart();

    const rateHeaders = globalQuotaTracker.getRateLimitHeaders();
    for (const [headerName, headerVal] of Object.entries(rateHeaders)) {
      reply.header(headerName, headerVal);
    }

    try {
      const body = req.body;
      const resolvedModel = resolveModelId(body.model);

      logger.info("Responses API request received", {
        requestId,
        model: body.model,
        resolvedModel,
      });
      logger.debug(debugMode, "Tools provided by Codex:", JSON.stringify(body.tools));

      // Convert Responses API input to standard messages
      const messages: OpenAIMessage[] = [];
      for (const item of body.input || []) {
        if (item.type === "message") {
          let textContent = "";
          const parts: MessageContentPart[] = [];
          for (const part of item.content || []) {
            if (part.type === "input_text" || part.type === "text") {
              textContent += part.text;
            } else if (part.type === "input_image" && part.image_url?.url) {
              parts.push({ type: "image_url", image_url: { url: part.image_url.url } });
            }
          }

          let finalContent: string | MessageContentPart[] = textContent;
          if (parts.length > 0) {
            if (textContent) {
              parts.unshift({ type: "text", text: textContent });
            }
            finalContent = parts;
          }

          let role = item.role;
          if (role === "developer") role = "system";

          messages.push({
            role: (role ?? "user") as "assistant" | "system" | "tool" | "user",
            content: finalContent,
          });
        }
      }

      const client = new GeminiApiClient(config, debugMode);
      const geminiStream = await client.sendMessageStream({
        model: resolvedModel,
        messages,
        tools: body.tools as OpenAITool[] | undefined,
        tool_choice: body.tool_choice,
      });

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const rawReply = reply.raw as { flushHeaders?: () => void };
      if (typeof rawReply.flushHeaders === "function") {
        rawReply.flushHeaders();
      }

      let isClientAborted = false;
      req.raw.on("close", () => {
        isClientAborted = true;
      });

      const responseId = `res_${randomUUID()}`;

      const sendEvent = (event: unknown) => {
        if (!isClientAborted) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };

      sendEvent({ type: "response.created", response: { id: responseId, status: "in_progress" } });
      let isFirstText = true;
      let fullText = "";

      let activeToolCallId: string | null = null;
      let toolCallArgs = "";
      let toolCallName = "";

      let currentOutputIndex = 0;
      let currentMsgId = `msg_${randomUUID()}`;
      let contentIndex = 0;

      for await (const chunk of geminiStream) {
        if (isClientAborted) {
          break;
        }
        logger.debug(debugMode, "Responses API chunk", { type: chunk.type });
        if (chunk.type === "text" && chunk.data) {
          logger.debug(debugMode, "Text chunk:", chunk.data);
          if (isFirstText) {
            sendEvent({
              type: "response.output_item.added",
              output_index: currentOutputIndex,
              item: { id: currentMsgId, type: "message", role: "assistant", content: [] },
            });
            sendEvent({
              type: "response.content_part.added",
              item_id: currentMsgId,
              output_index: currentOutputIndex,
              content_index: contentIndex,
              part: { type: "text", text: "" },
            });
            isFirstText = false;
          }
          fullText += chunk.data;
          sendEvent({
            type: "response.output_text.delta",
            item_id: currentMsgId,
            output_index: currentOutputIndex,
            content_index: contentIndex,
            delta: chunk.data,
          });
        } else if (chunk.type === "tool_code" && chunk.data) {
          // If we had text, close it
          if (!isFirstText) {
            sendEvent({
              type: "response.content_part.done",
              item_id: currentMsgId,
              output_index: currentOutputIndex,
              content_index: contentIndex,
              part: { type: "text", text: fullText },
            });
            sendEvent({
              type: "response.output_item.done",
              output_index: currentOutputIndex,
              item: {
                id: currentMsgId,
                type: "message",
                role: "assistant",
                content: [{ type: "text", text: fullText }],
              },
            });
            contentIndex++;
            currentOutputIndex++;
            isFirstText = true;
            fullText = ""; // Reset for potential next text block
            currentMsgId = `msg_${randomUUID()}`; // generate new ID
          }

          toolCallName = chunk.data.name;
          toolCallArgs = JSON.stringify(chunk.data.args);
          activeToolCallId = `call_${randomUUID()}`;

          const toolCallItemId = `item_${randomUUID()}`;

          sendEvent({
            type: "response.output_item.added",
            output_index: currentOutputIndex,
            item: {
              id: toolCallItemId,
              type: "function_call",
              name: toolCallName,
              call_id: activeToolCallId,
            },
          });
          sendEvent({
            type: "response.function_call_arguments.delta",
            item_id: toolCallItemId,
            output_index: currentOutputIndex,
            call_id: activeToolCallId,
            delta: toolCallArgs,
          });
          sendEvent({
            type: "response.function_call_arguments.done",
            item_id: toolCallItemId,
            output_index: currentOutputIndex,
            call_id: activeToolCallId,
            arguments: toolCallArgs,
          });
          sendEvent({
            type: "response.output_item.done",
            output_index: currentOutputIndex,
            item: {
              id: toolCallItemId,
              type: "function_call",
              name: toolCallName,
              call_id: activeToolCallId,
              arguments: toolCallArgs,
            },
          });

          currentOutputIndex++;
        }
      }

      if (!isFirstText && !isClientAborted) {
        sendEvent({
          type: "response.content_part.done",
          item_id: currentMsgId,
          output_index: currentOutputIndex,
          content_index: contentIndex,
          part: { type: "text", text: fullText },
        });
        sendEvent({
          type: "response.output_item.done",
          output_index: currentOutputIndex,
          item: {
            id: currentMsgId,
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: fullText }],
          },
        });
      }

      if (!isClientAborted) {
        sendEvent({
          type: "response.completed",
          response: { id: responseId, status: "completed" },
        });
        reply.raw.write("data: [DONE]\n\n");
      }
      reply.raw.end();
      return reply;
    } catch (error: unknown) {
      const err = error as Error;
      logger.error("Error in Responses API", { error: err.message, stack: err.stack });
      if (!reply.raw.headersSent) {
        return reply.status(500).send({ error: { message: err.message } });
      } else {
        reply.raw.end();
        return reply;
      }
    }
  };

  app.post("/v1/responses", handler);
  app.post("/responses", handler);
}
