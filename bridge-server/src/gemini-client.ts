/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Config, GeminiChat } from '@google/gemini-cli-core';
import {
  type Content,
  type Part,
  type Tool,
  type FunctionDeclaration,
  type GenerateContentConfig,
  FunctionCallingConfigMode,
} from '@google/genai';
import {
  type OpenAIMessage,
  type MessageContentPart,
  type OpenAIChatCompletionRequest,
  type StreamChunk,
  type ReasoningData,
} from './types.js';
import { logger } from './utils/logger.js';
import {
  thoughtSignatureCache,
  lastThoughtSignatureByTool,
  toolCallNameCache,
} from './utils/thought-signature-cache.js';
import { resolveModelId } from './utils/model-resolver.js';

const ALLOWED_GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'maxItems',
  'minItems',
  'properties',
  'required',
  'propertyOrdering',
  'items',
  'maximum',
  'minimum',
  'maxLength',
  'minLength',
  'maxProperties',
  'minProperties',
  'pattern',
  'example',
  'anyOf',
  'default',
]);

/**
 * Recursively removes fields from a JSON schema that are not supported by the
 * Gemini API and maps common JSON Schema / OpenAPI 3.1 constructs to Gemini Schema.
 * @param schema The JSON schema to sanitize.
 * @returns A new schema object without the unsupported fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeGeminiSchema(schema: any): any {
  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(sanitizeGeminiSchema);
  }

  // Create a new object, filtering out unsupported keys at the current level.
  const newSchema: { [key: string]: any } = {};

  // Extract / convert numeric bounds
  let minimum = schema.minimum;
  let maximum = schema.maximum;

  if (typeof schema.exclusiveMinimum === 'number' && minimum === undefined) {
    minimum =
      schema.type === 'integer'
        ? schema.exclusiveMinimum + 1
        : schema.exclusiveMinimum;
  }
  if (typeof schema.exclusiveMaximum === 'number' && maximum === undefined) {
    maximum =
      schema.type === 'integer'
        ? schema.exclusiveMaximum - 1
        : schema.exclusiveMaximum;
  }

  // Handle allOf by merging properties if possible
  const mergedProperties = { ...(schema.properties || {}) };
  let mergedRequired = Array.isArray(schema.required)
    ? [...schema.required]
    : undefined;
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      if (typeof sub === 'object' && sub !== null) {
        const sanitizedSub = sanitizeGeminiSchema(sub);
        if (sanitizedSub.properties) {
          Object.assign(mergedProperties, sanitizedSub.properties);
        }
        if (Array.isArray(sanitizedSub.required)) {
          mergedRequired = [
            ...(mergedRequired || []),
            ...sanitizedSub.required,
          ];
        }
      }
    }
  }

  // Convert oneOf to anyOf
  let anyOf = schema.anyOf;
  if (!anyOf && Array.isArray(schema.oneOf)) {
    anyOf = schema.oneOf;
  }

  // Convert const to enum
  let enumValues = schema.enum;
  if (!enumValues && schema.const !== undefined) {
    enumValues = [schema.const];
  }

  // Populate allowed keys only
  for (const key in schema) {
    if (ALLOWED_GEMINI_SCHEMA_KEYS.has(key)) {
      newSchema[key] = schema[key];
    }
  }

  if (Object.keys(mergedProperties).length > 0) {
    newSchema.properties = mergedProperties;
  }
  if (mergedRequired && mergedRequired.length > 0) {
    newSchema.required = mergedRequired;
  }
  if (minimum !== undefined) {
    newSchema.minimum = minimum;
  }
  if (maximum !== undefined) {
    newSchema.maximum = maximum;
  }
  if (anyOf !== undefined) {
    newSchema.anyOf = anyOf;
  }
  if (enumValues !== undefined) {
    newSchema.enum = enumValues;
  }

  // Handle type array (e.g. ["string", "null"])
  if (Array.isArray(newSchema.type)) {
    if (newSchema.type.includes('null')) {
      newSchema.nullable = true;
      const nonNullType = newSchema.type.find((t: any) => t !== 'null');
      if (nonNullType) {
        newSchema.type = nonNullType;
      } else {
        delete newSchema.type;
      }
    } else if (newSchema.type.length > 0) {
      newSchema.type = newSchema.type[0];
    }
  }

  // Ensure enum is string[]
  if (Array.isArray(newSchema.enum)) {
    newSchema.enum = newSchema.enum.map((item: any) => String(item));
  }

  // Ensure required is string[]
  if (Array.isArray(newSchema.required)) {
    newSchema.required = newSchema.required.filter(
      (item: any) => typeof item === 'string',
    );
    if (newSchema.required.length === 0) {
      delete newSchema.required;
    }
  } else if (newSchema.required !== undefined) {
    delete newSchema.required;
  }

  // Recurse into nested 'properties'
  if (newSchema.properties && typeof newSchema.properties === 'object') {
    const newProperties: { [key: string]: any } = {};
    for (const key in newSchema.properties) {
      newProperties[key] = sanitizeGeminiSchema(newSchema.properties[key]);
    }
    newSchema.properties = newProperties;
  }

  // Recurse into nested 'items'
  if (newSchema.items) {
    if (Array.isArray(newSchema.items)) {
      newSchema.items =
        newSchema.items.length > 0
          ? sanitizeGeminiSchema(newSchema.items[0])
          : {};
    } else {
      newSchema.items = sanitizeGeminiSchema(newSchema.items);
    }
  }

  // Recurse into anyOf
  if (Array.isArray(newSchema.anyOf)) {
    newSchema.anyOf = newSchema.anyOf.map(sanitizeGeminiSchema);
  }

  return newSchema;
}

export interface ConvertedGeminiMessages {
  contents: Content[];
  systemInstruction?: Content;
}

export function parseFunctionNameFromId(toolCallId: string): string {
  if (!toolCallId) return 'unknown_tool';
  const parts = toolCallId.split('_');
  if (parts.length > 2 && parts[0] === 'call') {
    return parts.slice(1, parts.length - 1).join('_');
  }
  return 'unknown_tool_from_id';
}

export function formatResponsePayload(content: unknown): Record<string, unknown> {
  if (content === null || content === undefined) {
    return { output: null };
  }
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
      return { output: parsed };
    } catch {
      return { output: content };
    }
  }
  if (typeof content === 'object' && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }
  return { output: content };
}

export function convertAssistantMessage(msg: OpenAIMessage): Content {
  const parts: Part[] = [];

  if (msg.content && typeof msg.content === 'string') {
    parts.push({ text: msg.content });
  }

  if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
    for (const toolCall of msg.tool_calls) {
      if (toolCall.type === 'function' && toolCall.function) {
        let argsObject: Record<string, unknown> = {};
        try {
          argsObject = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          logger.warn(
            'Failed to parse tool call arguments',
            { arguments: toolCall.function.arguments },
            e,
          );
        }

        const signature =
          thoughtSignatureCache.get(toolCall.id) ||
          lastThoughtSignatureByTool.get(toolCall.function.name);

        const functionCallPart: Part = {
          functionCall: {
            name: toolCall.function.name,
            args: argsObject,
          },
        };
        if (signature) {
          (functionCallPart as any).thoughtSignature = signature;
          (functionCallPart as any).thought_signature = signature;
        }
        parts.push(functionCallPart);
      }
    }
  }

  if (parts.length === 0) {
    parts.push({ text: '' });
  }

  return { role: 'model', parts };
}

export function convertUserMessage(msg: OpenAIMessage): Content {
  if (typeof msg.content === 'string') {
    return { role: 'user', parts: [{ text: msg.content }] };
  }

  if (Array.isArray(msg.content)) {
    const parts = msg.content.reduce<Part[]>((acc, part: MessageContentPart) => {
      if (part.type === 'text') {
        acc.push({ text: part.text || '' });
      } else if (part.type === 'image_url' && part.image_url) {
        const imageUrl = part.image_url.url;
        if (imageUrl.startsWith('data:')) {
          const [mimePart, dataPart] = imageUrl.split(',');
          const mimeType = mimePart.split(':')[1]?.split(';')[0] || 'image/jpeg';
          acc.push({ inlineData: { mimeType, data: dataPart } });
        } else {
          acc.push({ fileData: { mimeType: 'image/jpeg', fileUri: imageUrl } });
        }
      }
      return acc;
    }, []);

    return { role: 'user', parts: parts.length > 0 ? parts : [{ text: '' }] };
  }

  return { role: 'user', parts: [{ text: '' }] };
}

export function convertOpenAIMessagesToGemini(
  messages: OpenAIMessage[],
  options?: {
    useInternalPrompt?: boolean;
    debugMode?: boolean;
  },
): ConvertedGeminiMessages {
  const systemParts: Part[] = [];
  const nonSystemMessages: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (typeof msg.content === 'string' && msg.content.trim()) {
        systemParts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            systemParts.push({ text: part.text });
          }
        }
      }
    } else {
      nonSystemMessages.push(msg);
    }
  }

  let systemInstruction: Content | undefined = undefined;
  if (systemParts.length > 0 && !options?.useInternalPrompt) {
    systemInstruction = { role: 'system', parts: systemParts };
  }

  // Pre-index tool calls from all assistant messages
  const toolCallMap = new Map<string, { id: string; name: string }>();
  for (const msg of nonSystemMessages) {
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const call of msg.tool_calls) {
        if (call.id && call.function?.name) {
          toolCallMap.set(call.id, { id: call.id, name: call.function.name });
          toolCallNameCache.set(call.id, call.function.name);
        }
      }
    }
  }

  const contents: Content[] = [];
  let i = 0;

  while (i < nonSystemMessages.length) {
    const msg = nonSystemMessages[i];

    if (msg.role === 'tool') {
      // Collect ALL consecutive 'tool' messages
      const toolMessages: OpenAIMessage[] = [];
      const toolStartIndex = i;
      while (i < nonSystemMessages.length && nonSystemMessages[i].role === 'tool') {
        toolMessages.push(nonSystemMessages[i]);
        i++;
      }

      // Find the assistant message immediately preceding this tool batch
      let precedingAssistant: OpenAIMessage | undefined;
      for (let k = toolStartIndex - 1; k >= 0; k--) {
        if (nonSystemMessages[k].role === 'assistant') {
          precedingAssistant = nonSystemMessages[k];
          break;
        }
      }

      const assistantToolCalls = precedingAssistant?.tool_calls || [];
      const functionResponseParts: Part[] = [];

      // Index current batch of tool messages by tool_call_id
      const toolMsgByCallId = new Map<string, OpenAIMessage>();
      const unconsumedToolMsgs: OpenAIMessage[] = [];

      for (const tm of toolMessages) {
        if (tm.tool_call_id) {
          toolMsgByCallId.set(tm.tool_call_id, tm);
        } else {
          unconsumedToolMsgs.push(tm);
        }
      }

      // If the preceding assistant message had tool calls, match them in EXACT order
      if (assistantToolCalls.length > 0) {
        for (const call of assistantToolCalls) {
          const matchingMsg = toolMsgByCallId.get(call.id);
          if (matchingMsg) {
            toolMsgByCallId.delete(call.id);
            functionResponseParts.push({
              functionResponse: {
                name: call.function.name,
                response: formatResponsePayload(matchingMsg.content),
              },
            });
          } else {
            // Try matching unconsumed tool message by name
            const matchIdx = unconsumedToolMsgs.findIndex(
              m => m.name === call.function.name,
            );
            if (matchIdx !== -1) {
              const [m] = unconsumedToolMsgs.splice(matchIdx, 1);
              functionResponseParts.push({
                functionResponse: {
                  name: call.function.name,
                  response: formatResponsePayload(m.content),
                },
              });
            } else {
              // Synthesize fallback response for missing tool response so count matches!
              logger.warn(
                `Synthesizing missing response for tool call ${call.id} (${call.function.name}) to ensure Gemini tool call parity`,
              );
              functionResponseParts.push({
                functionResponse: {
                  name: call.function.name,
                  response: { error: 'No response provided for this tool call' },
                },
              });
            }
          }
        }
      }

      // Any remaining tool messages that didn't match assistantToolCalls
      for (const remaining of toolMsgByCallId.values()) {
        const funcName =
          toolCallMap.get(remaining.tool_call_id!)?.name ||
          remaining.name ||
          toolCallNameCache.get(remaining.tool_call_id!) ||
          parseFunctionNameFromId(remaining.tool_call_id!);
        functionResponseParts.push({
          functionResponse: {
            name: funcName,
            response: formatResponsePayload(remaining.content),
          },
        });
      }

      for (const remaining of unconsumedToolMsgs) {
        const funcName = remaining.name || 'unknown_tool';
        functionResponseParts.push({
          functionResponse: {
            name: funcName,
            response: formatResponsePayload(remaining.content),
          },
        });
      }

      if (functionResponseParts.length > 0) {
        contents.push({
          role: 'user',
          parts: functionResponseParts,
        });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const assistantContent = convertAssistantMessage(msg);
      const prev = contents.length > 0 ? contents[contents.length - 1] : undefined;
      if (prev && prev.role === 'model') {
        if (!prev.parts) prev.parts = [];
        if (assistantContent.parts) {
          prev.parts.push(...assistantContent.parts);
        }
      } else {
        contents.push(assistantContent);
      }
      i++;
      continue;
    }

    // msg.role === 'user'
    const userContent = convertUserMessage(msg);
    const prev = contents.length > 0 ? contents[contents.length - 1] : undefined;
    const prevIsFunctionResponse = prev?.parts
      ? prev.parts.some(p => 'functionResponse' in p)
      : false;

    // Only merge into prev if prev is user AND is not a functionResponse turn
    if (prev && prev.role === 'user' && !prevIsFunctionResponse) {
      if (!prev.parts) prev.parts = [];
      if (userContent.parts) {
        prev.parts.push(...userContent.parts);
      }
    } else {
      contents.push(userContent);
    }
    i++;
  }

  // Ensure first turn starts with 'user'
  if (contents.length > 0 && contents[0].role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  return { contents, systemInstruction };
}

export class GeminiApiClient {
  private readonly config: Config;
  private readonly contentGenerator;
  private readonly debugMode: boolean;

  constructor(config: Config, debugMode = false) {
    this.config = config;
    this.contentGenerator = this.config.getGeminiClient().getContentGenerator();
    this.debugMode = debugMode;
  }

  /**
   * Converts OpenAI tool definitions to Gemini tool definitions.
   */
  private convertOpenAIToolsToGemini(
    openAITools?: OpenAIChatCompletionRequest['tools'],
  ): Tool[] | undefined {
    if (!openAITools || openAITools.length === 0) {
      return undefined;
    }

    const functionDeclarations: FunctionDeclaration[] = openAITools
      .filter(tool => tool.type === 'function' && tool.function)
      .map(tool => {
        const sanitizedParameters = sanitizeGeminiSchema(
          tool.function.parameters,
        );
        return {
          name: tool.function.name,
          description: tool.function.description,
          parameters: sanitizedParameters,
        };
      });

    if (functionDeclarations.length === 0) {
      return undefined;
    }

    return [{ functionDeclarations }];
  }

  /**
   * Parses the original function name from a tool_call_id.
   * ID format: "call_{functionName}_{uuid}"
   */
  private parseFunctionNameFromId(toolCallId: string): string {
    return parseFunctionNameFromId(toolCallId);
  }

  /**
   * Converts an OpenAI-formatted message to a Gemini-formatted Content object.
   */
  private openAIMessageToGemini(msg: OpenAIMessage): Content {
    if (msg.role === 'assistant') {
      return convertAssistantMessage(msg);
    }
    if (msg.role === 'tool') {
      return {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: this.parseFunctionNameFromId(msg.tool_call_id || ''),
              response: formatResponsePayload(msg.content),
            },
          },
        ],
      };
    }
    return convertUserMessage(msg);
  }

  /**
   * Sends a streaming request to the Gemini API.
   */
  public async sendMessageStream({
    model,
    messages,
    tools,
    tool_choice,
  }: {
    model: string;
    messages: OpenAIMessage[];
    tools?: OpenAIChatCompletionRequest['tools'];
    tool_choice?: any;
  }): Promise<AsyncGenerator<StreamChunk>> {
    const useInternalPrompt = !!this.config.getUserMemory();

    const { contents, systemInstruction } = convertOpenAIMessagesToGemini(
      messages,
      { useInternalPrompt, debugMode: this.debugMode },
    );

    if (contents.length === 0) {
      throw new Error('No message to send.');
    }

    const lastMessage = contents.pop()!;
    const history = contents;

    const canonicalModel = resolveModelId(model);
    logger.info('Calling Gemini API', { model: canonicalModel, requestedModel: model });

    logger.debug(this.debugMode, 'Sending request to Gemini', {
      historyLength: history.length,
      lastMessage,
    });

    // Create a proxy of config so GeminiChat uses the requested model instead of global default
    const requestConfig = new Proxy(this.config, {
      get(target, prop, receiver) {
        if (prop === 'getModel') {
          return () => canonicalModel;
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    // Create a new, isolated chat session for each request.
    const oneShotChat = new GeminiChat(
      requestConfig,
      this.contentGenerator,
      {},
      history,
    );

    const geminiTools = this.convertOpenAIToolsToGemini(tools);

    const generationConfig: GenerateContentConfig = {};
    if (systemInstruction) {
      generationConfig.systemInstruction = systemInstruction;
    }

    if (tool_choice && tool_choice !== 'auto') {
      generationConfig.toolConfig = {
        functionCallingConfig: {
          mode:
            tool_choice.type === 'function'
              ? FunctionCallingConfigMode.ANY
              : FunctionCallingConfigMode.AUTO,
          allowedFunctionNames: tool_choice.function
            ? [tool_choice.function.name]
            : undefined,
        },
      };
    }

    
    const prompt_id = Math.random().toString(16).slice(2);
    const geminiStream = await oneShotChat.sendMessageStream({
      message: lastMessage.parts || [],
      config: {
        tools: geminiTools,
        ...generationConfig,
      },
    }, prompt_id);

    logger.debug(this.debugMode, 'Got stream from Gemini.');

    // Transform the event stream to a simpler StreamChunk stream
    return (async function* (): AsyncGenerator<StreamChunk> {
      for await (const response of geminiStream) {
        const parts = response.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.text) {
            yield { type: 'text', data: part.text };
          }
          if (part.functionCall && part.functionCall.name) {
            const thoughtSignature =
              (part as any).thoughtSignature ||
              (part as any).thought_signature ||
              undefined;
            yield {
              type: 'tool_code',
              data: {
                name: part.functionCall.name,
                args:
                  (part.functionCall.args as Record<string, unknown>) ?? {},
                thoughtSignature,
              },
            };
          }
        }
      }
    })();
  }
}
