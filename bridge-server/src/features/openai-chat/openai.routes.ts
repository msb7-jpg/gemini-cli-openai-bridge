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
import { mapErrorToOpenAIError } from "../../core/errors/error-mapper.js";
import { logger } from "../../shared/logger.js";
import { resolveModelId } from "../models-and-quota/model-resolver.js";
import { globalQuotaTracker } from "../models-and-quota/quota-tracker.service.js";
import {
  OpenAIChatCompletionRequestSchema,
  type OpenAIChatCompletionRequest,
} from "./openai.schema.js";
import { mapOpenAIRequestToCanonical, collectOpenAIChatCompletion } from "./openai.mapper.js";
import { createOpenAISSEEncoder } from "./openai.sse-encoder.js";

/**
 * Registers OpenAI Chat Completions endpoints (`/v1/chat/completions` and `/chat/completions`).
 *
 * @param app - Fastify server instance.
 * @param config - Initialized Gemini CLI `Config`.
 * @param debugMode - Whether debug logging is enabled.
 */
export async function registerOpenAIRoutes(
  app: FastifyInstance,
  config: Config,
  debugMode = false,
): Promise<void> {
  const handler = async (
    req: FastifyRequest<{ Body: OpenAIChatCompletionRequest }>,
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
      const resolvedModel = resolveModelId(body.model);
      const isStream = body.stream !== false;

      logger.info("OpenAI bridge request received", {
        requestId,
        model: body.model,
        resolvedModel,
        stream: body.stream,
      });
      logger.debug(debugMode, "Request body:", { requestId, body, resolvedModel });

      const client = new GeminiTransportClient(config, debugMode);
      const canonicalRequest = mapOpenAIRequestToCanonical(body, resolvedModel);
      const canonicalStream = await client.sendCanonicalStream(canonicalRequest);

      if (isStream) {
        const encoder = createOpenAISSEEncoder(body.model, debugMode);
        await pipeCanonicalStreamToSSE(req, reply, canonicalStream, encoder);

        const durationMs = Date.now() - startTime;
        logger.info("OpenAI bridge request finished", {
          requestId,
          status: "success",
          durationMs,
        });
        return reply;
      }

      const finalResponse = await collectOpenAIChatCompletion(
        canonicalStream,
        body.model,
        startTime,
      );

      const durationMs = Date.now() - startTime;
      logger.info("OpenAI bridge non-streaming request finished", {
        requestId,
        status: "success",
        durationMs,
      });

      return reply.status(200).send(finalResponse);
    } catch (e: unknown) {
      const durationMs = Date.now() - startTime;
      logger.error("OpenAI bridge request failed", e as Error, {
        requestId,
        durationMs,
      });

      globalQuotaTracker.recordQuotaError(e);
      const { openAIError, statusCode } = mapErrorToOpenAIError(e);

      if (!reply.raw.headersSent) {
        return reply.status(statusCode).send(openAIError);
      } else {
        reply.raw.write(`data: ${JSON.stringify({ error: openAIError.error })}\n\n`);
        reply.raw.end();
        return reply;
      }
    }
  };

  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    "/v1/chat/completions",
    {
      schema: {
        body: OpenAIChatCompletionRequestSchema,
      },
    },
    handler,
  );

  typedApp.post(
    "/chat/completions",
    {
      schema: {
        body: OpenAIChatCompletionRequestSchema,
      },
    },
    handler,
  );
}
