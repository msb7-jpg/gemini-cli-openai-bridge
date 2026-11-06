/**
 * @license
 * Copyright 2025-2026 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { type Config } from "@google/gemini-cli-core";
import { randomUUID } from "node:crypto";
import { GeminiTransportClient } from "../../core/gemini/gemini-transport.js";
import { pipeCanonicalStreamToSSE } from "../../core/sse/sse-pipeline.js";
import { logger } from "../../shared/logger.js";
import { resolveModelId } from "../models-and-quota/model-resolver.js";
import { globalQuotaTracker } from "../models-and-quota/quota-tracker.service.js";
import { type ResponsesApiRequestBody } from "./responses.schema.js";
import { mapResponsesRequestToCanonical } from "./responses.mapper.js";
import { createResponsesSSEEncoder } from "./responses.sse-encoder.js";

/**
 * Registers OpenAI Codex Responses API endpoints (`/v1/responses` and `/responses`).
 *
 * @param app - Fastify server instance.
 * @param config - Initialized Gemini CLI `Config`.
 * @param debugMode - Whether debug logging is enabled.
 */
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

      const client = new GeminiTransportClient(config, debugMode);
      const canonicalRequest = mapResponsesRequestToCanonical(body, resolvedModel);
      const canonicalStream = await client.sendCanonicalStream(canonicalRequest);

      const encoder = createResponsesSSEEncoder(debugMode);
      await pipeCanonicalStreamToSSE(req, reply, canonicalStream, encoder);
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
