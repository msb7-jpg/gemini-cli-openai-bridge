/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import {
  OpenAIChatCompletionRequestSchema,
  OpenAIMessageSchema,
  type OpenAIMessage,
} from "../openai.schema.js";
import { mapOpenAIMessagesToCanonical } from "../openai.mapper.js";
import { normalizeCanonicalMessagesToGemini } from "../../../core/gemini/message-normalizer.js";

describe("OpenAI Chat Slice (Zod 4 Schemas & Canonical Mapping)", () => {
  it("validates a minimal valid OpenAI chat completion request", () => {
    const payload = {
      model: "gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: "Hello world",
        },
      ],
    };

    const parsed = OpenAIChatCompletionRequestSchema.parse(payload);
    expect(parsed.model).toBe("gemini-2.5-flash");
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].role).toBe("user");
    expect(parsed.messages[0].content).toBe("Hello world");
    expect(parsed.stream).toBe(false);
  });

  it("validates full OpenAI request with tools, tool_calls, and thinking config", () => {
    const payload = {
      model: "gemini-2.5-pro",
      messages: [
        {
          role: "system",
          content: "You are a helpful coding assistant.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this image and code" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,abc123", detail: "high" },
            },
          ],
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"location": "Tokyo"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: '{"temp": 22}',
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather for location",
            parameters: {
              type: "object",
              properties: {
                location: { type: "string" },
              },
            },
          },
        },
      ],
      tool_choice: "auto",
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 2048,
      reasoning_effort: "high",
      thinking: {
        type: "enabled",
        budget_tokens: 1024,
      },
    };

    const parsed = OpenAIChatCompletionRequestSchema.parse(payload);
    expect(parsed.messages).toHaveLength(4);
    expect(parsed.stream).toBe(true);
    expect(parsed.tools).toBeDefined();
    expect(parsed.tools?.[0].function.name).toBe("get_weather");
    expect(parsed.thinking?.budget_tokens).toBe(1024);
    expect(parsed.reasoning_effort).toBe("high");
  });

  it("preserves unknown/passthrough fields via z.looseObject for client compatibility", () => {
    const payload = {
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "hi" }],
      custom_client_field: "opencode-v2",
      metadata: { sessionId: "ses-123" },
    };

    const parsed = OpenAIChatCompletionRequestSchema.parse(payload) as Record<string, unknown> & {
      custom_client_field?: string;
      metadata?: { sessionId?: string };
    };
    expect(parsed.custom_client_field).toBe("opencode-v2");
    expect(parsed.metadata?.sessionId).toBe("ses-123");
  });

  it("fails validation on missing model, empty messages, or invalid role/temperature", () => {
    expect(() =>
      OpenAIChatCompletionRequestSchema.parse({
        model: "",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toThrow();

    expect(() =>
      OpenAIChatCompletionRequestSchema.parse({
        model: "gemini-2.5-flash",
        messages: [],
      }),
    ).toThrow();

    expect(() =>
      OpenAIMessageSchema.parse({
        role: "invalid_role",
        content: "hello",
      }),
    ).toThrow();

    expect(() =>
      OpenAIChatCompletionRequestSchema.parse({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "hi" }],
        temperature: 3.5,
      }),
    ).toThrow();
  });

  it("maps OpenAI messages to Canonical IR and normalizes to Gemini Contents", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "First message" },
      { role: "user", content: "Second message" },
    ];

    const canonical = mapOpenAIMessagesToCanonical(messages);
    const { contents, systemInstruction } = normalizeCanonicalMessagesToGemini(canonical);

    expect(systemInstruction).toEqual({
      role: "system",
      parts: [{ text: "You are helpful." }],
    });
    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe("user");
    expect(contents[0].parts).toEqual([{ text: "First message" }, { text: "Second message" }]);
  });
});
