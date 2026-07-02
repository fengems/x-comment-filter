/**
 * 云端 LLM 后端：实现 MiningBackend 接口，调用 DeepSeek/OpenAI 兼容 API。
 *
 * 兼容 OpenAI Chat Completions 协议（DeepSeek、OpenAI、兼容第三方都用同一格式）。
 * Prompt 构造与结果解析复用 backend.ts（三个后端共用）。
 * fetch 注入：便于单测（假 fetch 返回固定 JSON）。
 *
 * 隐私：opt-in 功能，用户自填 key（仅本地存，不随规则导出）。
 * 文本会上传到第三方，开启前必须告知用户。
 */
import type {
  MiningBackend,
  MiningInput,
  MiningResult,
  BackendAvailability,
} from './backend';
import { buildSystemPrompt, buildUserPrompt, parseMiningResult, emptyResult } from './backend';

// 向后兼容：重新导出共享类型（旧测试和 miner 仍可从这里导入）
export type { MiningInput, MiningResult, SuggestedRule } from './backend';
export {
  buildSystemPrompt,
  buildUserPrompt,
  parseMiningResult,
} from './backend';

/** fetch 接口（注入用） */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

/** provider → 默认 endpoint */
export const PROVIDER_ENDPOINTS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
};

/** provider → 默认模型名 */
export function modelForProvider(provider: string): string {
  if (provider === 'deepseek') return 'deepseek-chat';
  if (provider === 'openai') return 'gpt-4o-mini';
  return 'gpt-4o-mini';
}

/** 云端后端配置 */
export interface CloudConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  /** fetch 实现（默认 globalThis.fetch，单测注入） */
  fetcher?: FetchLike;
}

/**
 * 执行一次规则挖掘（向后兼容的独立函数，内部被 CloudBackend 调用）。
 */
export async function mineRules(
  fetcher: FetchLike,
  endpoint: string,
  apiKey: string,
  model: string,
  samples: MiningInput[],
): Promise<MiningResult> {
  if (!apiKey) return emptyResult();
  if (samples.length === 0) return emptyResult();

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(samples) },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  let res;
  try {
    res = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });
  } catch (e) {
    throw new Error(`网络错误：${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`API 返回 ${res.status}：${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  return parseMiningResult(content);
}

/**
 * 云端挖掘后端（实现 MiningBackend）。
 */
export class CloudBackend implements MiningBackend {
  readonly name: string;
  private cfg: CloudConfig;

  constructor(cfg: CloudConfig, name = 'cloud') {
    this.cfg = cfg;
    this.name = name;
  }

  async availability(): Promise<BackendAvailability> {
    if (!this.cfg.apiKey) {
      return { available: false, reason: '未配置 API key' };
    }
    return { available: true };
  }

  async mine(samples: MiningInput[]): Promise<MiningResult> {
    const fetcher = this.cfg.fetcher ?? (globalThis.fetch as unknown as FetchLike);
    return mineRules(fetcher, this.cfg.endpoint, this.cfg.apiKey, this.cfg.model, samples);
  }
}
