import { describe, it, expect } from 'vitest';
import {
  sanitizeGeminiSchema,
  convertOpenAIMessagesToGemini,
  parseFunctionNameFromId,
} from './gemini-client.js';
import { type OpenAIMessage } from './types.js';

describe('sanitizeGeminiSchema', () => {
  it('removes unsupported JSON Schema keys like exclusiveMinimum and exclusiveMaximum', () => {
    const input = {
      type: 'object',
      properties: {
        offset: {
          type: 'integer',
          exclusiveMinimum: 0,
        },
        limit: {
          type: 'integer',
          exclusiveMaximum: 100,
        },
      },
      required: ['offset'],
      additionalProperties: false,
      $schema: 'http://json-schema.org/draft-07/schema#',
    };

    const sanitized = sanitizeGeminiSchema(input);

    expect(sanitized).toEqual({
      type: 'object',
      properties: {
        offset: {
          type: 'integer',
          minimum: 1,
        },
        limit: {
          type: 'integer',
          maximum: 99,
        },
      },
      required: ['offset'],
    });

    expect(sanitized).not.toHaveProperty('additionalProperties');
    expect(sanitized).not.toHaveProperty('$schema');
    expect(sanitized.properties.offset).not.toHaveProperty('exclusiveMinimum');
    expect(sanitized.properties.limit).not.toHaveProperty('exclusiveMaximum');
  });

  it('handles number float exclusiveMinimum', () => {
    const input = {
      type: 'number',
      exclusiveMinimum: 5.5,
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: 'number',
      minimum: 5.5,
    });
  });

  it('converts const to enum', () => {
    const input = {
      type: 'string',
      const: 'git',
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: 'string',
      enum: ['git'],
    });
  });

  it('converts oneOf to anyOf', () => {
    const input = {
      oneOf: [
        { type: 'string' },
        { type: 'number' },
      ],
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      anyOf: [
        { type: 'string' },
        { type: 'number' },
      ],
    });
  });

  it('converts type array with null to nullable', () => {
    const input = {
      type: ['string', 'null'],
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: 'string',
      nullable: true,
    });
  });

  it('converts enum to array of strings', () => {
    const input = {
      type: 'integer',
      enum: [1, 2, 3],
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: 'integer',
      enum: ['1', '2', '3'],
    });
  });

  it('strips unknown metadata keys like $id, $ref, $defs', () => {
    const input = {
      type: 'object',
      $id: 'https://example.com/schema',
      $defs: { someDef: {} },
      properties: {
        name: {
          type: 'string',
          description: 'A name',
          minLength: 1,
        },
      },
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'A name',
          minLength: 1,
        },
      },
    });
  });
});

describe('parseFunctionNameFromId', () => {
  it('parses name from standard bridge format call_{name}_{uuid}', () => {
    expect(
      parseFunctionNameFromId(
        'call_read_file_4070a256-ff8e-4916-b8ef-bdae539958ee',
      ),
    ).toBe('read_file');
    expect(
      parseFunctionNameFromId('call_search_12345'),
    ).toBe('search');
  });

  it('handles names with colons and special characters', () => {
    expect(
      parseFunctionNameFromId('call_default_api:bash_uuid123'),
    ).toBe('default_api:bash');
  });
});

describe('convertOpenAIMessagesToGemini', () => {
  it('groups multiple consecutive tool messages into a single user Content turn', () => {
    // Exactly reproducing the 1 search, 3 reads scenario from OpenCode Plan mode
    const messages: OpenAIMessage[] = [
      {
        role: 'user',
        content: 'Evaluate the codebase with vue composables',
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_search_1',
            type: 'function',
            function: { name: 'search', arguments: '{"query":"composables"}' },
          },
          {
            id: 'call_read_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
          },
          {
            id: 'call_read_2',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"b.ts"}' },
          },
          {
            id: 'call_read_3',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"c.ts"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_search_1',
        content: JSON.stringify({ matches: ['a.ts', 'b.ts', 'c.ts'] }),
      },
      {
        role: 'tool',
        tool_call_id: 'call_read_1',
        content: 'content of a.ts',
      },
      {
        role: 'tool',
        tool_call_id: 'call_read_2',
        content: 'content of b.ts',
      },
      {
        role: 'tool',
        tool_call_id: 'call_read_3',
        content: 'content of c.ts',
      },
    ];

    const { contents } = convertOpenAIMessagesToGemini(messages);

    // Should produce exactly 3 turns:
    // Turn 0: user (initial prompt)
    // Turn 1: model (4 function calls)
    // Turn 2: user (4 function responses ALL in the same turn)
    expect(contents).toHaveLength(3);

    expect(contents[0].role).toBe('user');
    expect(contents[1].role).toBe('model');
    expect(contents[1].parts).toHaveLength(4);

    expect(contents[2].role).toBe('user');
    expect(contents[2].parts).toHaveLength(4);

    // Verify all function responses correspond 1:1
    const modelCallNames = contents[1].parts!.map(p => (p as any).functionCall.name);
    const userResponseNames = contents[2].parts!.map(p => (p as any).functionResponse.name);

    expect(modelCallNames).toEqual(['search', 'read_file', 'read_file', 'read_file']);
    expect(userResponseNames).toEqual(['search', 'read_file', 'read_file', 'read_file']);

    // Check payload wrapping
    expect((contents[2].parts![0] as any).functionResponse.response).toEqual({
      matches: ['a.ts', 'b.ts', 'c.ts'],
    });
    expect((contents[2].parts![1] as any).functionResponse.response).toEqual({
      output: 'content of a.ts',
    });
  });

  it('reorders tool responses when received out of order to match model call order', () => {
    const messages: OpenAIMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_first',
            type: 'function',
            function: { name: 'toolA', arguments: '{}' },
          },
          {
            id: 'call_second',
            type: 'function',
            function: { name: 'toolB', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_second',
        content: 'result B',
      },
      {
        role: 'tool',
        tool_call_id: 'call_first',
        content: 'result A',
      },
    ];

    const { contents } = convertOpenAIMessagesToGemini(messages);

    // Turn 0 is inserted Hello because messages started with assistant
    expect(contents[0].role).toBe('user');
    expect(contents[1].role).toBe('model');
    expect(contents[2].role).toBe('user');

    // Responses should be sorted toolA then toolB
    const responseNames = contents[2].parts!.map(p => (p as any).functionResponse.name);
    expect(responseNames).toEqual(['toolA', 'toolB']);
  });

  it('synthesizes fallback responses when client omits a tool response to keep parity', () => {
    const messages: OpenAIMessage[] = [
      {
        role: 'user',
        content: 'test',
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search', arguments: '{}' },
          },
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'found',
      },
      // call_2 was dropped or failed by client
    ];

    const { contents } = convertOpenAIMessagesToGemini(messages);
    expect(contents).toHaveLength(3);
    expect(contents[2].parts).toHaveLength(2); // Still 2 parts to satisfy Gemini parity!

    expect((contents[2].parts![1] as any).functionResponse).toEqual({
      name: 'read_file',
      response: { error: 'No response provided for this tool call' },
    });
  });

  it('merges consecutive user messages and separates system instruction', () => {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'First message' },
      { role: 'user', content: 'Second message' },
    ];

    const { contents, systemInstruction } = convertOpenAIMessagesToGemini(messages);

    expect(systemInstruction).toEqual({
      role: 'system',
      parts: [{ text: 'You are helpful.' }],
    });

    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe('user');
    expect(contents[0].parts).toEqual([
      { text: 'First message' },
      { text: 'Second message' },
    ]);
  });
});

