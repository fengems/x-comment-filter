import { describe, it, expect } from 'vitest';
import {
  type MiningBackend,
  type MiningInput,
  type MiningResult,
  type BackendAvailability,
  emptyResult,
  buildSystemPrompt,
  buildUserPrompt,
  parseMiningResult,
} from './backend';
import { CloudBackend, type FetchLike } from './cloud-client';

/** 构造一个可注入的假后端（验证接口契约） */
function makeFakeBackend(
  avail: BackendAvailability,
  result: MiningResult,
): MiningBackend {
  return {
    name: 'fake',
    availability: async () => avail,
    mine: async () => result,
  };
}

const samples: MiningInput[] = [{ text: '加vx约', handle: 'bot' }];

describe('MiningBackend 接口契约', () => {
  it('可用后端返回 mine 结果', async () => {
    const backend = makeFakeBackend(
      { available: true },
      { isNewPattern: true, confidence: 0.8, summary: '色情', suggestedRules: [] },
    );
    const avail = await backend.availability();
    expect(avail.available).toBe(true);
    const result = await backend.mine(samples);
    expect(result.isNewPattern).toBe(true);
  });

  it('不可用后端标记原因', async () => {
    const backend = makeFakeBackend({ available: false, reason: 'WebGPU 不可用' });
    expect((await backend.availability()).available).toBe(false);
  });
});

describe('emptyResult', () => {
  it('返回标准空结果', () => {
    const r = emptyResult();
    expect(r.isNewPattern).toBe(false);
    expect(r.suggestedRules).toHaveLength(0);
    expect(r.confidence).toBe(0);
  });
});

describe('共享 prompt/parse（已在 backend.ts）', () => {
  it('buildSystemPrompt 含 JSON 格式要求', () => {
    expect(buildSystemPrompt()).toContain('isNewPattern');
  });
  it('buildUserPrompt 防注入分隔符', () => {
    expect(buildUserPrompt(samples)).toContain('UNTRUSTED_SAMPLES');
  });
  it('parseMiningResult 解析 JSON', () => {
    const r = parseMiningResult('{"isNewPattern":true,"confidence":0.5,"summary":"","suggestedRules":[]}');
    expect(r.isNewPattern).toBe(true);
  });
});

describe('CloudBackend（接口实现）', () => {
  function okFetch(content: string): FetchLike {
    return async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content,
    });
  }

  it('实现 MiningBackend 接口', () => {
    const backend = new CloudBackend({ endpoint: 'u', apiKey: 'k', model: 'm' });
    expect(backend.name).toBe('cloud');
    expect(typeof backend.availability).toBe('function');
    expect(typeof backend.mine).toBe('function');
  });

  it('availability：无 key 标记不可用', async () => {
    const backend = new CloudBackend({ endpoint: 'u', apiKey: '', model: 'm' });
    const avail = await backend.availability();
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain('API key');
  });

  it('availability：有 key 可用', async () => {
    const backend = new CloudBackend({ endpoint: 'u', apiKey: 'k', model: 'm' });
    expect((await backend.availability()).available).toBe(true);
  });

  it('mine 成功解析', async () => {
    const content = JSON.stringify({
      isNewPattern: true,
      confidence: 0.85,
      summary: '博彩',
      suggestedRules: [{ type: 'keyword', value: '澳门', category: 'gambling' }],
    });
    const backend = new CloudBackend({
      endpoint: 'https://api.test',
      apiKey: 'k',
      model: 'm',
      fetcher: okFetch(content),
    });
    const result = await backend.mine([{ text: '澳门赌场', handle: 'b' }]);
    expect(result.isNewPattern).toBe(true);
    expect(result.suggestedRules[0]?.value).toBe('澳门');
  });

  it('mine 失败抛异常（HTTP 错误）', async () => {
    const errFetch: FetchLike = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'server error',
    });
    const backend = new CloudBackend({
      endpoint: 'u',
      apiKey: 'k',
      model: 'm',
      fetcher: errFetch,
    });
    await expect(backend.mine([{ text: 'x', handle: 'h' }])).rejects.toThrow(/500/);
  });

  it('无 key 时 mine 返回空结果而非抛异常', async () => {
    const backend = new CloudBackend({ endpoint: 'u', apiKey: '', model: 'm', fetcher: okFetch('{}') });
    const result = await backend.mine([{ text: 'x', handle: 'h' }]);
    expect(result.isNewPattern).toBe(false);
  });
});
