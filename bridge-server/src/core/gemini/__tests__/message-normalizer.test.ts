/**
 * @license
 * Copyright 2025-2026 Google LLC / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { normalizeCanonicalMessagesToGemini } from "../message-normalizer.js";
import { type CanonicalMessage } from "../canonical-ir.types.js";

interface FunctionCallTestPart {
  functionCall: {
    name: string;
    args?: Record<string, unknown>;
  };
}

interface FunctionResponseTestPart {
  functionResponse: {
    name: string;
    response?: unknown;
  };
}

describe("normalizeCanonicalMessagesToGemini", () => {
  it("groups multiple consecutive tool messages into a single user Content turn", () => {
    const messages: CanonicalMessage[] = [
      {
        role: "user",
        parts: [{ type: "text", text: "Evaluate the codebase with vue composables" }],
      },
      {
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "call_search_1",
            name: "search",
            args: { query: "composables" },
          },
          {
            type: "tool_call",
            id: "call_read_1",
            name: "read_file",
            args: { path: "a.ts" },
          },
          {
            type: "tool_call",
            id: "call_read_2",
            name: "read_file",
            args: { path: "b.ts" },
          },
          {
            type: "tool_call",
            id: "call_read_3",
            name: "read_file",
            args: { path: "c.ts" },
          },
        ],
      },
      {
        role: "tool",
        parts: [
          {
            type: "tool_result",
            toolCallId: "call_search_1",
            content: JSON.stringify({ matches: ["a.ts", "b.ts", "c.ts"] }),
          },
        ],
      },
      {
        role: "tool",
        parts: [
          {
            type: "tool_result",
            toolCallId: "call_read_1",
            content: "content of a.ts",
          },
        ],
      },
      {
        role: "tool",
        parts: [
          {
            type: "tool_result",
            toolCallId: "call_read_2",
            content: "content of b.ts",
          },
        ],
      },
      {
        role: "tool",
        parts: [
          {
            type: "tool_result",
            toolCallId: "call_read_3",
            content: "content of c.ts",
          },
        ],
      },
    ];

    const { contents } = normalizeCanonicalMessagesToGemini(messages);

    expect(contents).toHaveLength(3);
    expect(contents[0].role).toBe("user");
    expect(contents[1].role).toBe("model");
    expect(contents[1].parts).toHaveLength(4);
    expect(contents[2].role).toBe("user");
    expect(contents[2].parts).toHaveLength(4);

    const modelCallNames = contents[1].parts!.map(
      (part) => (part as unknown as FunctionCallTestPart).functionCall.name,
    );
    const userResponseNames = contents[2].parts!.map(
      (part) => (part as unknown as FunctionResponseTestPart).functionResponse.name,
    );

    expect(modelCallNames).toEqual(["search", "read_file", "read_file", "read_file"]);
    expect(userResponseNames).toEqual(["search", "read_file", "read_file", "read_file"]);

    expect(
      (contents[2].parts![0] as unknown as FunctionResponseTestPart).functionResponse.response,
    ).toEqual({
      matches: ["a.ts", "b.ts", "c.ts"],
    });
    expect(
      (contents[2].parts![1] as unknown as FunctionResponseTestPart).functionResponse.response,
    ).toEqual({
      output: "content of a.ts",
    });
  });

  it("reorders tool responses when received out of order to match model call order", () => {
    const messages: CanonicalMessage[] = [
      {
        role: "assistant",
        parts: [
          { type: "tool_call", id: "call_first", name: "toolA", args: {} },
          { type: "tool_call", id: "call_second", name: "toolB", args: {} },
        ],
      },
      {
        role: "tool",
        parts: [{ type: "tool_result", toolCallId: "call_second", content: "result B" }],
      },
      {
        role: "tool",
        parts: [{ type: "tool_result", toolCallId: "call_first", content: "result A" }],
      },
    ];

    const { contents } = normalizeCanonicalMessagesToGemini(messages);

    expect(contents[0].role).toBe("user");
    expect(contents[1].role).toBe("model");
    expect(contents[2].role).toBe("user");

    const responseNames = contents[2].parts!.map(
      (part) => (part as unknown as FunctionResponseTestPart).functionResponse.name,
    );
    expect(responseNames).toEqual(["toolA", "toolB"]);
  });

  it("synthesizes fallback responses when client omits a tool response to keep parity", () => {
    const messages: CanonicalMessage[] = [
      {
        role: "user",
        parts: [{ type: "text", text: "test" }],
      },
      {
        role: "assistant",
        parts: [
          { type: "tool_call", id: "call_1", name: "search", args: {} },
          { type: "tool_call", id: "call_2", name: "read_file", args: {} },
        ],
      },
      {
        role: "tool",
        parts: [{ type: "tool_result", toolCallId: "call_1", content: "found" }],
      },
    ];

    const { contents } = normalizeCanonicalMessagesToGemini(messages);
    expect(contents).toHaveLength(3);
    expect(contents[2].parts).toHaveLength(2);

    expect((contents[2].parts![1] as unknown as FunctionResponseTestPart).functionResponse).toEqual(
      {
        name: "read_file",
        response: { error: "No response provided for this tool call" },
      },
    );
  });

  it("merges consecutive user messages and separates system instruction", () => {
    const messages: CanonicalMessage[] = [
      { role: "system", parts: [{ type: "text", text: "You are helpful." }] },
      { role: "user", parts: [{ type: "text", text: "First message" }] },
      { role: "user", parts: [{ type: "text", text: "Second message" }] },
    ];

    const { contents, systemInstruction } = normalizeCanonicalMessagesToGemini(messages);

    expect(systemInstruction).toEqual({
      role: "system",
      parts: [{ text: "You are helpful." }],
    });

    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe("user");
    expect(contents[0].parts).toEqual([{ text: "First message" }, { text: "Second message" }]);
  });
});
