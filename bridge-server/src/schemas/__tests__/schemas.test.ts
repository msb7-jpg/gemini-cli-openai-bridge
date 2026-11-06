/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import {
  OpenAIChatCompletionRequestSchema,
  OpenAIMessageSchema,
  AnthropicMessagesRequestSchema,
  QuotaSnapshotSchema,
  TokenUsageSchema,
  ModelsListResponseSchema,
} from "../index.js";

describe("OpenAI Zod Schemas", () => {
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

  it("preserves unknown/passthrough fields for client compatibility", () => {
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

  it("fails validation on missing model or empty messages", () => {
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
  });

  it("fails validation on invalid message role or invalid temperature", () => {
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
});

describe("Anthropic Zod Schemas", () => {
  it("validates a basic string-content Anthropic request with default max_tokens", () => {
    const payload = {
      model: "claude-3-7-sonnet",
      messages: [
        {
          role: "user",
          content: "Hello Claude",
        },
      ],
    };

    const parsed = AnthropicMessagesRequestSchema.parse(payload);
    expect(parsed.model).toBe("claude-3-7-sonnet");
    expect(parsed.max_tokens).toBe(4096);
    expect(parsed.stream).toBe(false);
  });

  it("validates Anthropic request with content blocks (tool_use, tool_result, thinking)", () => {
    const payload = {
      model: "claude-3-7-sonnet",
      system: "You are an AI assistant",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Calculate something" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: "base64data...",
              },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Let me think step by step...",
              signature: "sig_abc",
            },
            {
              type: "tool_use",
              id: "tu_123",
              name: "calculator",
              input: { expr: "2+2" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_123",
              content: "4",
            },
          ],
        },
      ],
      thinking: {
        type: "enabled",
        budget_tokens: 2000,
      },
    };

    const parsed = AnthropicMessagesRequestSchema.parse(payload);
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.system).toBe("You are an AI assistant");
    expect(parsed.thinking?.budget_tokens).toBe(2000);
  });

  it("validates system prompt as array of content blocks or strings", () => {
    const payload = {
      model: "claude-3-7-sonnet",
      system: [
        { type: "text", text: "System instruction 1" },
        { type: "text", text: "System instruction 2" },
      ],
      messages: [{ role: "user", content: "test" }],
    };

    const parsed = AnthropicMessagesRequestSchema.parse(payload);
    expect(Array.isArray(parsed.system)).toBe(true);
    expect(parsed.system as unknown[]).toHaveLength(2);
  });

  it("preserves passthrough vendor fields in Anthropic request and messages", () => {
    const payload = {
      model: "claude-3-7-sonnet",
      messages: [
        {
          role: "user",
          content: "Hello",
          custom_client_field: true,
        },
      ],
      metadata: {
        user_id: "usr_abc123",
      },
    };

    const parsed = AnthropicMessagesRequestSchema.parse(payload) as Record<string, unknown> & {
      metadata?: { user_id?: string };
      messages: Array<{ custom_client_field?: boolean }>;
    };
    expect(parsed.metadata?.user_id).toBe("usr_abc123");
    expect(parsed.messages[0].custom_client_field).toBe(true);
  });

  it("fails validation on missing model or empty messages", () => {
    expect(() =>
      AnthropicMessagesRequestSchema.parse({
        model: "",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toThrow();

    expect(() =>
      AnthropicMessagesRequestSchema.parse({
        model: "claude-3-7-sonnet",
        messages: [],
      }),
    ).toThrow();
  });
});

describe("Quota and Management Schemas", () => {
  it("validates TokenUsage with defaults", () => {
    const usage = TokenUsageSchema.parse({});
    expect(usage.promptTokens).toBe(0);
    expect(usage.completionTokens).toBe(0);
    expect(usage.cachedTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
  });

  it("validates QuotaSnapshot schema", () => {
    const snapshot = {
      status: "healthy",
      authType: "oauth",
      uptimeSeconds: 3600,
      requests: {
        total: 10,
        rpm: { used: 2, limit: 60, remaining: 58, windowSeconds: 60 },
        rpd: { used: 10, limit: 1000, remaining: 990, windowHours: 24 },
      },
      tokens: {
        promptTokens: 100,
        completionTokens: 50,
        cachedTokens: 0,
        totalTokens: 150,
      },
      byModel: {
        "gemini-2.5-flash": {
          requests: 10,
          tokens: {
            promptTokens: 100,
            completionTokens: 50,
            cachedTokens: 0,
            totalTokens: 150,
          },
        },
      },
      remoteModelQuotas: [
        { model: "gemini-2.5-pro", percentage: 0.8, resetTime: "2026-11-07T00:00:00Z" },
      ],
      proQuotaExceeded: false,
      genericQuotaExceeded: false,
      retryAfterSeconds: 0,
      retryUntil: null,
      lastQuotaError: null,
      lastQuotaErrorTime: null,
    };

    const parsed = QuotaSnapshotSchema.parse(snapshot);
    expect(parsed.status).toBe("healthy");
    expect(parsed.requests.rpm.remaining).toBe(58);
    expect(parsed.remoteModelQuotas?.[0].model).toBe("gemini-2.5-pro");
  });

  it("validates ModelsListResponse schema", () => {
    const response = {
      object: "list",
      data: [
        {
          id: "gemini-2.5-flash",
          object: "model",
          created: 1700000000,
          owned_by: "google",
        },
      ],
    };

    const parsed = ModelsListResponseSchema.parse(response);
    expect(parsed.object).toBe("list");
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].id).toBe("gemini-2.5-flash");
  });
});
