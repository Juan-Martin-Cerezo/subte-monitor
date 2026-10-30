import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  usage: LlmUsage;
}

export class LlmConfigError extends Error {}

const DEFAULT_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const TIMEOUT_MS = 20_000;

interface Config {
  key: string;
  base: string;
  model: string;
}

let fallback: Promise<Config | null> | null = null;

function baseFor(provider: string | undefined): string {
  if (!provider) return DEFAULT_BASE;
  if (/^https?:\/\//i.test(provider)) return provider.replace(/\/+$/, '');
  return DEFAULT_BASE;
}

async function readFallback(): Promise<Config | null> {
  const file = process.env.ANDEN_LLM_ENV ?? path.join(os.homedir(), '.config/b2first/ai.env');

  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }

  const values = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    values.set(match[1], match[2].replace(/^["']|["']$/g, '').trim());
  }

  const key = values.get('B2_AI_KEY');
  if (!key) return null;

  return {
    key,
    base: baseFor(values.get('B2_AI_PROVIDER')),
    model: values.get('B2_AI_MODEL') || DEFAULT_MODEL,
  };
}

async function resolveConfig(): Promise<Config> {
  const key = process.env.ANDEN_LLM_KEY;
  if (key) {
    return {
      key,
      base: (process.env.ANDEN_LLM_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, ''),
      model: process.env.ANDEN_LLM_MODEL?.trim() || DEFAULT_MODEL,
    };
  }

  if (!fallback) fallback = readFallback();
  const config = await fallback;
  if (!config) throw new LlmConfigError('no llm key configured');
  return config;
}

export async function currentModel(): Promise<string> {
  return (await resolveConfig()).model;
}

export async function chat(
  messages: ChatMessage[],
  options: {
    temperature?: number;
    maxTokens?: number;
    responseFormat?: 'json_object';
    tools?: ToolDefinition[];
  } = {},
): Promise<ChatResult> {
  const config = await resolveConfig();

  const response = await fetch(`${config.base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 400,
      ...(options.responseFormat ? { response_format: { type: options.responseFormat } } : {}),
      ...(options.tools?.length ? { tools: options.tools, tool_choice: 'auto' } : {}),
      stream: false,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`chat completions returned ${response.status}`);

  const data = (await response.json()) as {
    choices?: { message?: { content?: unknown; tool_calls?: unknown } }[];
    usage?: LlmUsage;
  };

  const message = data.choices?.[0]?.message;
  const content = typeof message?.content === 'string' ? message.content : '';
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls.filter(
        (call): call is ToolCall =>
          Boolean(call) &&
          typeof call === 'object' &&
          typeof (call as ToolCall).id === 'string' &&
          typeof (call as ToolCall).function?.name === 'string' &&
          typeof (call as ToolCall).function?.arguments === 'string',
      )
    : [];

  if (!content && !toolCalls.length) throw new Error('chat completions returned no content');

  return { content, toolCalls, usage: data.usage ?? {} };
}
