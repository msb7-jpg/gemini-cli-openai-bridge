/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { type FastifyRequest, type FastifyReply } from "fastify";
import { type CanonicalStreamEvent } from "../gemini/canonical-ir.types.js";

/**
 * Protocol-specific stateful encoder that translates CanonicalStreamEvents into SSE frames.
 */
export interface ProtocolSSEEncoder {
  /**
   * Encodes a single canonical stream event into zero or more SSE frame strings.
   * @param event - The canonical stream event emitted by Gemini.
   * @returns Array of formatted SSE frame strings.
   */
  encodeEvent(event: CanonicalStreamEvent): string[];

  /**
   * Produces final SSE frames when the stream completes.
   * @returns Array of closing SSE frame strings.
   */
  flush(): string[];
}

/**
 * Pipes a CanonicalStreamEvent generator directly to Fastify's raw HTTP socket as Server-Sent Events.
 * Handles SSE response headers, header flushing, client disconnect detection, and final frame flushing.
 *
 * @param req - Fastify incoming request used to detect client socket closure.
 * @param reply - Fastify reply whose raw response stream receives SSE data.
 * @param canonicalStream - Async generator yielding canonical events from the Gemini transport.
 * @param encoder - Stateful protocol SSE encoder (OpenAI, Anthropic, or Responses API).
 * @returns Promise that resolves once the stream finishes or the client disconnects.
 */
export async function pipeCanonicalStreamToSSE(
  req: FastifyRequest,
  reply: FastifyReply,
  canonicalStream: AsyncGenerator<CanonicalStreamEvent>,
  encoder: ProtocolSSEEncoder,
): Promise<void> {
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

  for await (const event of canonicalStream) {
    if (isClientAborted) {
      break;
    }
    const frames = encoder.encodeEvent(event);
    for (const frame of frames) {
      if (isClientAborted) {
        break;
      }
      reply.raw.write(frame);
    }
  }

  if (!isClientAborted) {
    const finalFrames = encoder.flush();
    for (const frame of finalFrames) {
      if (isClientAborted) {
        break;
      }
      reply.raw.write(frame);
    }
  }

  reply.raw.end();
}
