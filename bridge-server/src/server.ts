/**
 * @license
 * Copyright 2025-2026 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Config } from "@google/gemini-cli-core";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import { registerOpenAIRoutes } from "./features/openai-chat/openai.routes.js";
import { registerAnthropicRoutes } from "./features/anthropic-messages/anthropic.routes.js";
import { registerResponsesApiRoutes } from "./features/openai-responses/responses.routes.js";
import { registerQuotaAndModelsRoutes } from "./features/models-and-quota/quota.routes.js";

/**
 * Creates and configures the Fastify bridge server instance with Zod validation and protocol slices.
 *
 * @param config - Initialized Gemini CLI `Config` instance.
 * @param debugMode - Whether debug logging is enabled.
 * @param cliVersion - Semantic version reported by `/health`.
 * @returns Configured Fastify server instance.
 */
export async function createServer(
  config: Config,
  debugMode = false,
  cliVersion = "0.0.0",
): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 50 * 1024 * 1024,
    logger: false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: true,
  });

  app.all("/api/hello", async (_req, reply) => {
    return reply.status(200).send("OK");
  });

  app.get("/health", async (_req, reply) => {
    return reply.status(200).send({ status: "ok", version: cliVersion });
  });

  await registerQuotaAndModelsRoutes(app);
  await registerOpenAIRoutes(app, config, debugMode);
  await registerAnthropicRoutes(app, config, debugMode);
  await registerResponsesApiRoutes(app, config, debugMode);

  return app;
}
