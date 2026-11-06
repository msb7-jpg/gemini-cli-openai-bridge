/**
 * @license
 * Copyright 2025-2026 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { type Config } from "@google/gemini-cli-core";
import { randomUUID } from "node:crypto";
import { GeminiTransportClient } from "../../core/gemini/gemini-transport.js";
import { pipeCanonicalStreamToSSE } from "../../core/sse/sse-pipeline.js";
import { logger } from "../../shared/logger.js";
import { globalQuotaTracker } from "../models-and-quota/quota-tracker.service.js";
import {
  AnthropicMessagesRequestSchema,
  type AnthropicMessagesRequest,
} from "./anthropic.schema.js";
import {
  resolveAnthropicModel,
  mapAnthropicRequestToCanonical,
  collectAnthropicMessageResponse,
  estimateAnthropicInputTokens,
} from "./anthropic.mapper.js";
import { createAnthropicSSEEncoder } from "./anthropic.sse-encoder.js";

/**
 * Registers Anthropic Messages endpoints (`/v1/messages`, `/messages`,
 * `/v1/messages/count_tokens`, and `/messages/count_tokens`).
 *
 * @param app - Fastify server instance.
 * @param config - Initialized Gemini CLI `Config`.
 * @param debugMode - Whether debug logging is enabled.
 */
export async function registerAnthropicRoutes(
  app: FastifyInstance,
  config: Config,
  debugMode = false,
): Promise<void> {
  const handler = async (
    req: FastifyRequest<{ Body: AnthropicMessagesRequest }>,
    reply: FastifyReply,
  ) => {
    const requestId = randomUUID();
    const startTime = Date.now();
    globalQuotaTracker.recordRequestStart();

    const rateHeaders = globalQuotaTracker.getRateLimitHeaders();
    for (const [headerName, headerVal] of Object.entries(rateHeaders)) {
      reply.header(headerName, headerVal);
    }

    try {
      const body = req.body;
      const targetModel = resolveAnthropicModel(body.model);
      const isStream = body.stream !== false;
      const responseModel = body.model || targetModel;

      logger.info("Anthropic bridge request received", {
        requestId,
        requestedModel: body.model,
        targetModel,
        stream: isStream,
        messageCount: body.messages?.length || 0,
      });
      logger.debug(debugMode, "Anthropic request body:", { requestId, body });

      const client = new GeminiTransportClient(config, debugMode);
      const canonicalRequest = mapAnthropicRequestToCanonical(body, targetModel);
      const canonicalStream = await client.sendCanonicalStream(canonicalRequest);

      if (isStream) {
        const encoder = createAnthropicSSEEncoder(responseModel, debugMode);
        await pipeCanonicalStreamToSSE(req, reply, canonicalStream, encoder);

        const durationMs = Date.now() - startTime;
        logger.info("Anthropic bridge stream finished", {
          requestId,
          durationMs,
        });
        return reply;
      }

      const responsePayload = await collectAnthropicMessageResponse(canonicalStream, responseModel);
      const durationMs = Date.now() - startTime;
      logger.info("Anthropic bridge non-streaming finished", {
        requestId,
        durationMs,
      });
      return reply.status(200).send(responsePayload);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error("Error handling Anthropic request", {
        requestId,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });

      globalQuotaTracker.recordQuotaError(error);

      if (!reply.raw.headersSent) {
        return reply.status(500).send({
          type: "error",
          error: {
            type: "api_error",
            message: error instanceof Error ? error.message : "Internal server error",
          },
        });
      } else {
        reply.raw.end();
        return reply;
      }
    }
  };

  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    "/v1/messages",
    {
      schema: {
        body: AnthropicMessagesRequestSchema,
      },
    },
    handler,
  );

  typedApp.post(
    "/messages",
    {
      schema: {
        body: AnthropicMessagesRequestSchema,
      },
    },
    handler,
  );

  const countTokensHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Partial<AnthropicMessagesRequest> | undefined;
    return reply.send({
      input_tokens: estimateAnthropicInputTokens(body),
    });
  };

  app.post("/v1/messages/count_tokens", countTokensHandler);
  app.post("/messages/count_tokens", countTokensHandler);
}
