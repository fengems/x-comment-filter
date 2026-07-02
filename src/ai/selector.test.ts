import { describe, it, expect } from 'vitest';
import { selectBackend, checkOrFallback, type BackendDeps } from './selector';
import type { AiSettings } from '../settings/types';
import { DEFAULT_AI_SETTINGS } from '../settings/types';
import type { FetchLike } from './cloud-client';
import type { LanguageModelLike } from './chrome-ai';
import type { WebllmEngineLike } from './webllm';

function aiSettings(over: Partial<AiSettings>): AiSettings {
  return { ...DEFAULT_AI_SETTINGS, ...over };
}

describe('selectBackend', () => {
  it('none 返回 null', () => {
    expect(selectBackend(aiSettings({ backend: 'none' }), {})).toBeNull();
  });

  it('cloud 构造 CloudBackend，名称含 provider', () => {
    const b = selectBackend(
      aiSettings({ backend: 'cloud', cloudProvider: 'deepseek', cloudApiKey: 'k' }),
      {},
    );
    expect(b).not.toBeNull();
    expect(b!.name).toBe('cloud-deepseek');
  });

  it('cloud custom 用自定义 endpoint', async () => {
    const b = selectBackend(
      aiSettings({
        backend: 'cloud',
        cloudProvider: 'custom',
        cloudEndpoint: 'https://my.api/chat',
        cloudApiKey: 'k',
      }),
      {},
    );
    // 通过 availability 不抛异常验证构造成功
    expect(await b!.availability()).toEqual({ available: true });
  });

  it('cloud 无 key 时 availability 标记不可用', async () => {
    const b = selectBackend(aiSettings({ backend: 'cloud', cloudProvider: 'openai' }), {});
    const avail = await b!.availability();
    expect(avail.available).toBe(false);
  });

  it('local-chrome 注入 languageModel 时使用它', async () => {
    const lm: LanguageModelLike = { availability: async () => 'available', create: async () => ({}) as never };
    const b = selectBackend(aiSettings({ backend: 'local-chrome' }), { languageModel: lm });
    expect(b!.name).toBe('local-chrome');
    expect((await b!.availability()).available).toBe(true);
  });

  it('local-chrome 无注入时用全局（测试环境无 → 不可用）', async () => {
    const b = selectBackend(aiSettings({ backend: 'local-chrome' }), {});
    expect((await b!.availability()).available).toBe(false);
  });

  it('local-webllm 注入 engine + detectWebgpu', async () => {
    const engine: WebllmEngineLike = {
      load: async () => true,
      loadedModel: () => 'qwen2.5-0.5b',
      chat: async () => '',
      unload: async () => {},
    };
    const b = selectBackend(
      aiSettings({ backend: 'local-webllm' }),
      { webllmEngine: engine, detectWebgpu: async () => true },
    );
    const avail = await b!.availability();
    expect(avail.available).toBe(true);
  });

  it('local-webllm 无 WebGPU 时不可用', async () => {
    const engine: WebllmEngineLike = {
      load: async () => true,
      loadedModel: () => null,
      chat: async () => '',
      unload: async () => {},
    };
    const b = selectBackend(
      aiSettings({ backend: 'local-webllm' }),
      { webllmEngine: engine, detectWebgpu: async () => false },
    );
    expect((await b!.availability()).available).toBe(false);
  });

  it('cloud fetcher 注入生效（mine 用注入的 fetch）', async () => {
    let called = false;
    const fetcher: FetchLike = async () => {
      called = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{}' } }] }),
        text: async () => '{}',
      };
    };
    const b = selectBackend(
      aiSettings({ backend: 'cloud', cloudProvider: 'openai', cloudApiKey: 'k' }),
      { fetcher },
    );
    await b!.mine([{ text: 'x', handle: 'h' }]);
    expect(called).toBe(true);
  });
});

describe('checkOrFallback', () => {
  it('null 后端 → 不可用', async () => {
    const r = await checkOrFallback(null);
    expect(r.ok).toBe(false);
  });

  it('可用后端 → ok', async () => {
    const b = selectBackend(
      aiSettings({ backend: 'cloud', cloudProvider: 'deepseek', cloudApiKey: 'k' }),
      {},
    );
    const r = await checkOrFallback(b);
    expect(r.ok).toBe(true);
  });

  it('不可用后端 → 返回原因', async () => {
    // 注入 engine 但禁用 WebGPU，才能走到 WebGPU 检查分支
    const engine: WebllmEngineLike = {
      load: async () => true,
      loadedModel: () => null,
      chat: async () => '',
      unload: async () => {},
    };
    const b = selectBackend(
      aiSettings({ backend: 'local-webllm' }),
      { webllmEngine: engine, detectWebgpu: async () => false },
    );
    const r = await checkOrFallback(b);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('WebGPU');
  });

  it('needsDownload 透传', async () => {
    const lm: LanguageModelLike = { availability: async () => 'downloadable', create: async () => ({}) as never };
    const b = selectBackend(aiSettings({ backend: 'local-chrome' }), { languageModel: lm });
    const r = await checkOrFallback(b);
    expect(r.ok).toBe(false);
    expect(r.needsDownload).toBe(true);
  });
});
