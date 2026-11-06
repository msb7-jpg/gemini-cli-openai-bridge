import { describe, it, expect } from 'vitest';
import {
  resolveAnthropicModel,
  convertAnthropicMessagesToOpenAI,
  convertAnthropicToolsToOpenAI,
} from './anthropic.js';

describe('Anthropic Bridge Adapter', () => {
  describe('resolveAnthropicModel', () => {
    it('uses specified gemini model directly', () => {
      expect(resolveAnthropicModel('gemini-3.8-flash')).toBe('gemini-3.8-flash');
      expect(resolveAnthropicModel('gemini-2.5-pro')).toBe('gemini-2.5-pro');
    });

    it('strips provider prefixes', () => {
      expect(resolveAnthropicModel('anthropic/gemini-3.8-flash')).toBe('gemini-3.8-flash');
      expect(resolveAnthropicModel('google/gemini-2.5-flash')).toBe('gemini-2.5-flash');
    });

    it('maps Claude Sonnet to default gemini-3.8-flash', () => {
      expect(resolveAnthropicModel('claude-3-7-sonnet-20250219')).toBe('gemini-3.8-flash');
      expect(resolveAnthropicModel('claude-sonnet-4-6')).toBe('gemini-3.8-flash');
    });

    it('maps Claude Opus to gemini-2.5-pro', () => {
      expect(resolveAnthropicModel('claude-opus-4-8')).toBe('gemini-2.5-pro');
    });

    it('maps Claude Haiku to gemini-2.5-flash', () => {
      expect(resolveAnthropicModel('claude-3-5-haiku-20241022')).toBe('gemini-2.5-flash');
    });
  });

  describe('convertAnthropicMessagesToOpenAI', () => {
    it('converts basic text messages with system prompt', () => {
      const messages = convertAnthropicMessagesToOpenAI(
        [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        'You are a helpful assistant',
      );

      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant',
      });
      expect(messages[1]).toEqual({ role: 'user', content: 'Hello' });
      expect(messages[2]).toEqual({ role: 'assistant', content: 'Hi there!' });
    });

    it('converts array system prompts', () => {
      const messages = convertAnthropicMessagesToOpenAI(
        [{ role: 'user', content: 'Ping' }],
        [
          { type: 'text', text: 'System instruction 1' },
          { type: 'text', text: 'System instruction 2' },
        ],
      );

      expect(messages[0]).toEqual({
        role: 'system',
        content: 'System instruction 1\n\nSystem instruction 2',
      });
    });

    it('converts assistant tool_use and user tool_result blocks', () => {
      const messages = convertAnthropicMessagesToOpenAI([
        { role: 'user', content: 'List files' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Listing files...' },
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'Bash',
              input: { command: 'ls -la' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: 'file1.txt\nfile2.txt',
            },
          ],
        },
      ]);

      expect(messages).toHaveLength(3);

      // Assistant message with tool_calls
      expect(messages[1]).toEqual({
        role: 'assistant',
        content: 'Listing files...',
        tool_calls: [
          {
            id: 'toolu_123',
            type: 'function',
            function: {
              name: 'Bash',
              arguments: JSON.stringify({ command: 'ls -la' }),
            },
          },
        ],
      });

      // User tool response converted to role: 'tool'
      expect(messages[2]).toEqual({
        role: 'tool',
        tool_call_id: 'toolu_123',
        content: 'file1.txt\nfile2.txt',
      });
    });
  });

  describe('convertAnthropicToolsToOpenAI', () => {
    it('converts Anthropic tools to OpenAI function tools', () => {
      const tools = convertAnthropicToolsToOpenAI([
        {
          name: 'Bash',
          description: 'Run commands',
          input_schema: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      ]);

      expect(tools).toHaveLength(1);
      expect(tools![0]).toEqual({
        type: 'function',
        function: {
          name: 'Bash',
          description: 'Run commands',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      });
    });
  });
});
