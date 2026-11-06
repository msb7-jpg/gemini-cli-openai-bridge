/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { ResponsesApiRequestBodySchema } from "../responses.schema.js";
import { mapResponsesRequestToCanonical } from "../responses.mapper.js";
import { createResponsesSSEEncoder } from "../responses.sse-encoder.js";

describe("OpenAI Responses API Slice", () => {
  it("validates and maps Responses API payload to CanonicalRequest", () => {
    const rawBody = {
      model: "gemini-3.8-flash",
      input: [
        {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "Follow coding conventions." }],
        },
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "Explain this diagram" },
            { type: "input_image", image_url: { url: "https://example.com/diagram.png" } },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "run_shell",
            description: "Execute command",
            parameters: { type: "object" },
          },
        },
      ],
    };

    const parsed = ResponsesApiRequestBodySchema.parse(rawBody);
    const canonical = mapResponsesRequestToCanonical(parsed, "gemini-3.8-flash");

    expect(canonical.model).toBe("gemini-3.8-flash");
    expect(canonical.messages).toHaveLength(2);
    expect(canonical.messages[0].role).toBe("system");
    expect(canonical.messages[0].parts).toEqual([
      { type: "text", text: "Follow coding conventions." },
    ]);
    expect(canonical.messages[1].role).toBe("user");
    expect(canonical.messages[1].parts).toEqual([
      { type: "text", text: "Explain this diagram" },
      { type: "image_uri", mimeType: "image/jpeg", fileUri: "https://example.com/diagram.png" },
    ]);
    expect(canonical.tools).toHaveLength(1);
    expect(canonical.tools?.[0].name).toBe("run_shell");
  });

  it("encodes text and tool_code events into Responses API SSE frames", () => {
    const encoder = createResponsesSSEEncoder(false);

    const textFrames = encoder.encodeEvent({ type: "text", data: "Hello Codex" });
    expect(textFrames).toHaveLength(4);
    expect(textFrames[0]).toContain('"type":"response.created"');
    expect(textFrames[1]).toContain('"type":"response.output_item.added"');
    expect(textFrames[2]).toContain('"type":"response.content_part.added"');
    expect(textFrames[3]).toContain('"type":"response.output_text.delta"');

    const toolFrames = encoder.encodeEvent({
      type: "tool_code",
      data: { name: "bash", args: { cmd: "pwd" } },
    });
    expect(toolFrames.some((frame) => frame.includes('"type":"response.content_part.done"'))).toBe(
      true,
    );
    expect(
      toolFrames.some((frame) => frame.includes('"type":"response.function_call_arguments.delta"')),
    ).toBe(true);

    const flushFrames = encoder.flush();
    expect(flushFrames[0]).toContain('"type":"response.completed"');
    expect(flushFrames[1]).toBe("data: [DONE]\n\n");
  });
});
