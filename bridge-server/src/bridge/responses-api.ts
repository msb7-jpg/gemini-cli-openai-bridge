import { Router, Request, Response } from 'express';
import { type Config } from '@google/gemini-cli-core';
import { GeminiApiClient } from '../gemini-client.js';
import { resolveModelId } from '../utils/model-resolver.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { globalQuotaTracker } from '../services/quota-tracker.js';
import type { OpenAIMessage, MessageContentPart } from '../types.js';

export function createResponsesApiRouter(config: Config, debugMode = false): Router {
  const router = Router();

  router.post('/responses', async (req: Request, res: Response) => {
    const requestId = randomUUID();
    const startTime = Date.now();
    globalQuotaTracker.recordRequestStart();

    const rateHeaders = globalQuotaTracker.getRateLimitHeaders();
    for (const [headerName, headerVal] of Object.entries(rateHeaders)) {
      res.setHeader(headerName, headerVal);
    }

    try {
      const body = req.body;
      const resolvedModel = resolveModelId(body.model);

      logger.info('Responses API request received', { requestId, model: body.model, resolvedModel });
      logger.debug(debugMode, 'Tools provided by Codex:', JSON.stringify(body.tools));

      // Convert Responses API input to standard messages
      const messages: OpenAIMessage[] = [];
      for (const item of body.input || []) {
        if (item.type === 'message') {
          let textContent = '';
          const parts: MessageContentPart[] = [];
          for (const part of item.content || []) {
            if (part.type === 'input_text' || part.type === 'text') {
              textContent += part.text;
            } else if (part.type === 'input_image') {
              parts.push({ type: 'image_url', image_url: { url: part.image_url.url } });
            }
          }
          
          let finalContent: any = textContent;
          if (parts.length > 0) {
            if (textContent) {
              parts.unshift({ type: 'text', text: textContent });
            }
            finalContent = parts;
          }

          let role = item.role;
          if (role === 'developer') role = 'system';
          
          messages.push({ role, content: finalContent });
        }
      }

      const client = new GeminiApiClient(config, debugMode);
      const geminiStream = await client.sendMessageStream({
        model: resolvedModel,
        messages,
        tools: body.tools,
        tool_choice: body.tool_choice,
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const responseId = `res_${randomUUID()}`;
      const itemId = `item_${randomUUID()}`;

      const sendEvent = (event: any) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      sendEvent({ type: 'response.created', response: { id: responseId, status: 'in_progress' } });
      let isFirstText = true;
      let fullText = '';
      
      let activeToolCallId: string | null = null;
      let toolCallIndex = 0;
      let toolCallArgs = '';
      let toolCallName = '';
      
      let currentOutputIndex = 0;
      let currentMsgId = `msg_${randomUUID()}`;
      let contentIndex = 0;

      for await (const chunk of geminiStream) {
        logger.debug(debugMode, 'Responses API chunk', { type: chunk.type });
        if (chunk.type === 'text' && chunk.data) {
          logger.debug(debugMode, 'Text chunk:', chunk.data);
          if (isFirstText) {
            sendEvent({ type: 'response.output_item.added', output_index: currentOutputIndex, item: { id: currentMsgId, type: 'message', role: 'assistant', content: [] } });
            sendEvent({ type: 'response.content_part.added', item_id: currentMsgId, output_index: currentOutputIndex, content_index: contentIndex, part: { type: 'text', text: '' } });
            isFirstText = false;
          }
          fullText += chunk.data;
          sendEvent({ type: 'response.output_text.delta', item_id: currentMsgId, output_index: currentOutputIndex, content_index: contentIndex, delta: chunk.data });
        } else if (chunk.type === 'tool_code' && chunk.data) {
          // If we had text, close it
          if (!isFirstText) {
            sendEvent({ type: 'response.content_part.done', item_id: currentMsgId, output_index: currentOutputIndex, content_index: contentIndex, part: { type: 'text', text: fullText } });
            sendEvent({ type: 'response.output_item.done', output_index: currentOutputIndex, item: { id: currentMsgId, type: 'message', role: 'assistant', content: [{ type: 'text', text: fullText }] } });
            contentIndex++;
            currentOutputIndex++;
            isFirstText = true;
            fullText = ''; // Reset for potential next text block
            currentMsgId = `msg_${randomUUID()}`; // generate new ID
          }

          toolCallName = chunk.data.name;
          toolCallArgs = JSON.stringify(chunk.data.args);
          activeToolCallId = `call_${randomUUID()}`;
          
          const toolCallItemId = `item_${randomUUID()}`;
          
          sendEvent({ type: 'response.output_item.added', output_index: currentOutputIndex, item: { id: toolCallItemId, type: 'function_call', name: toolCallName, call_id: activeToolCallId } });
          sendEvent({ type: 'response.function_call_arguments.delta', item_id: toolCallItemId, output_index: currentOutputIndex, call_id: activeToolCallId, delta: toolCallArgs });
          sendEvent({ type: 'response.function_call_arguments.done', item_id: toolCallItemId, output_index: currentOutputIndex, call_id: activeToolCallId, arguments: toolCallArgs });
          sendEvent({ type: 'response.output_item.done', output_index: currentOutputIndex, item: { id: toolCallItemId, type: 'function_call', name: toolCallName, call_id: activeToolCallId, arguments: toolCallArgs } });
          
          currentOutputIndex++;
        }
      }

      if (!isFirstText) {
        sendEvent({ type: 'response.content_part.done', item_id: currentMsgId, output_index: currentOutputIndex, content_index: contentIndex, part: { type: 'text', text: fullText } });
        sendEvent({ type: 'response.output_item.done', output_index: currentOutputIndex, item: { id: currentMsgId, type: 'message', role: 'assistant', content: [{ type: 'text', text: fullText }] } });
      }

      sendEvent({ type: 'response.completed', response: { id: responseId, status: 'completed' } });
      res.write('data: [DONE]\n\n');
      res.end();

    } catch (error: any) {
      logger.error('Error in Responses API', { error: error.message, stack: error.stack });
      if (!res.headersSent) {
        res.status(500).json({ error: { message: error.message } });
      } else {
        res.end();
      }
    }
  });

  return router;
}
