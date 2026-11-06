/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { globalQuotaTracker } from "./quota-tracker.service.js";
import { SUPPORTED_MODELS } from "./model-resolver.js";

/**
 * Registers quota (`/v1/quota`, `/quota`, `/v1/usage`, `/usage`) and
 * model catalog (`/v1/models`, `/models`) endpoints on the Fastify instance.
 *
 * @param app - Fastify server instance.
 */
export async function registerQuotaAndModelsRoutes(app: FastifyInstance): Promise<void> {
  const quotaHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    const snapshot = await globalQuotaTracker.getSnapshotAsync();
    return reply.status(200).send(snapshot);
  };

  app.get("/v1/quota", quotaHandler);
  app.get("/quota", quotaHandler);
  app.get("/v1/usage", quotaHandler);
  app.get("/usage", quotaHandler);

  const modelsHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      object: "list",
      data: SUPPORTED_MODELS,
    });
  };

  app.get("/v1/models", modelsHandler);
  app.get("/models", modelsHandler);
}
