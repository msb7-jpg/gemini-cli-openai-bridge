/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { AnthropicMessagesRequestSchema } from "../anthropic.schema.js";
import {
  resolveAnthropicModel,
  mapAnthropicMessagesToCanonical,
  mapAnthropicToolsToCanonical,
} from "../anthropic.mapper.js";

describe("Anthropic Messages Slice (Zod 4 Schemas & Direct Canonical Mapping)", () => {
  describe("resolveAnthropicModel", () => {
    it("uses specified gemini model directly", () => {
      expect(resolveAnthropicModel("gemini-3.8-flash")).toBe("gemini-3.8-flash");
      expect(resolveAnthropicModel("gemini-2.5-pro")).toBe("gemini-2.5-pro");
    });

    it("strips provider prefixes", () => {
      expect(resolveAnthropicModel("anthropic/gemini-3.8-flash")).toBe("gemini-3.8-flash");
      expect(resolveAnthropicModel("google/gemini-2.5-flash")).toBe("gemini-2.5-flash");
    });

    it("maps Claude Sonnet, Opus, and Haiku to Gemini models", () => {
      expect(resolveAnthropicModel("claude-3-7-sonnet-20250219")).toBe("gemini-3.8-flash");
      expect(resolveAnthropicModel("claude-sonnet-4-6")).toBe("gemini-3.8-flash");
      expect(resolveAnthropicModel("claude-opus-4-8")).toBe("gemini-2.5-pro");
      expect(resolveAnthropicModel("claude-3-5-haiku-20241022")).toBe("gemini-2.5-flash");
    });
  });

  describe("mapAnthropicMessagesToCanonical", () => {
    it("converts basic text messages with system prompt directly to Canonical IR", () => {
      const messages = mapAnthropicMessagesToCanonical(
        [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
        "You are a helpful assistant",
      );

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({
        role: "system",
        parts: [{ type: "text", text: "You are a helpful assistant" }],
      });
      expect(messages[1]).toEqual({
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      });
      expect(messages[2]).toEqual({
        role: "assistant",
        parts: [{ type: "text", text: "Hi there!" }],
      });
    });

    it("converts array system prompts", () => {
      const messages = mapAnthropicMessagesToCanonical(
        [{ role: "user", content: "Ping" }],
        [
          { type: "text", text: "System instruction 1" },
          { type: "text", text: "System instruction 2" },
        ],
      );

      expect(messages[0]).toEqual({
        role: "system",
        parts: [{ type: "text", text: "System instruction 1\n\nSystem instruction 2" }],
      });
    });

    it("converts assistant tool_use and user tool_result blocks directly to Canonical IR", () => {
      const messages = mapAnthropicMessagesToCanonical([
        { role: "user", content: "List files" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Listing files..." },
            {
              type: "tool_use",
              id: "toolu_123",
              name: "Bash",
              input: { command: "ls -la" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "file1.txt\nfile2.txt",
            },
          ],
        },
      ]);

      expect(messages).toHaveLength(3);
      expect(messages[1]).toEqual({
        role: "assistant",
        parts: [
          { type: "text", text: "Listing files..." },
          {
            type: "tool_call",
            id: "toolu_123",
            name: "Bash",
            args: { command: "ls -la" },
          },
        ],
      });
      expect(messages[2]).toEqual({
        role: "tool",
        parts: [
          {
            type: "tool_result",
            toolCallId: "toolu_123",
            content: "file1.txt\nfile2.txt",
          },
        ],
      });
    });
  });

  describe("mapAnthropicToolsToCanonical", () => {
    it("converts Anthropic tools directly to CanonicalToolDefinition", () => {
      const tools = mapAnthropicToolsToCanonical([
        {
          name: "Bash",
          description: "Run commands",
          input_schema: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      ]);

      expect(tools).toHaveLength(1);
      expect(tools![0]).toEqual({
        name: "Bash",
        description: "Run commands",
        parameters: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      });
    });
  });

  describe("Anthropic Zod 4 Schemas", () => {
    it("validates a basic string-content Anthropic request with default max_tokens", () => {
      const parsed = AnthropicMessagesRequestSchema.parse({
        model: "claude-3-7-sonnet",
        messages: [{ role: "user", content: "Hello Claude" }],
      });
      expect(parsed.model).toBe("claude-3-7-sonnet");
      expect(parsed.max_tokens).toBe(4096);
      expect(parsed.stream).toBe(false);
    });

    it("validates Anthropic request with content blocks (tool_use, tool_result, thinking, image)", () => {
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

    it("preserves passthrough vendor fields via z.looseObject in Anthropic request and messages", () => {
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
});
