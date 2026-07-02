import { describe, it, expect } from 'vitest';
import {
  WebllmBackend,
  LOCAL_MODELS,
  DEFAULT_LOCAL_MODEL,
  type WebllmEngineLike,
  type ChatMessage,
} from './webllm';

/** 假 WebLLM 引擎 */
function fakeEngine(opts: {
  loaded?: string | null;
  loadOk?: boolean;
  output?: string;
  chatThrow?: boolean;
}): WebllmEngineLike {
  let loaded = opts.loaded ?? null;
  return {
    load: async () => {
      if (opts.loadOk === false) return false;
      loaded = 'qwen2.5-0.5b';
      return true;
    },
    loadedModel: () => loaded,
    chat: async (messages: ChatMessage[]) => {
      if (opts.chatThrow) throw new Error('chat failed');
      // 验证消息结构正确
      void messages;
      return opts.output ?? '';
    },
    unload: async () => {
      loaded = null;
    },
  };
}

describe('LOCAL_MODELS / DEFAULT_LOCAL_MODEL', () => {
  it('含推荐模型', () => {
    expect(LOCAL_MODELS['qwen2.5-0.5b']).toBeDefined();
    expect(LOCAL_MODELS['qwen2.5-0.5b']!.sizeMb).toBeGreaterThan(0);
  });
  it('默认模型存在', () => {
    expect(LOCAL_MODELS[DEFAULT_LOCAL_MODEL]).toBeDefined();
  });
});

describe('WebllmBackend.availability', () => {
  it('无引擎 → 不可用', async () => {
    const b = new WebllmBackend({ modelId: 'qwen2.5-0.5b', detectWebgpu: async () => true });
    const avail = await b.availability();
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain('引擎');
  });

  it('未知模型 → 不可用', async () => {
    const b = new WebllmBackend({
      modelId: '不存在的模型',
      engine: fakeEngine({}),
      detectWebgpu: async () => true,
    });
    const avail = await b.availability();
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain('未知模型');
  });

  it('无 WebGPU → 不可用', async () => {
    const b = new WebllmBackend({
      modelId: 'qwen2.5-0.5b',
      engine: fakeEngine({}),
      detectWebgpu: async () => false,
    });
    const avail = await b.availability();
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain('WebGPU');
  });

  it('模型已加载 → 可用', async () => {
    const b = new WebllmBackend({
      modelId: 'qwen2.5-0.5b',
      engine: fakeEngine({ loaded: 'qwen2.5-0.5b' }),
      detectWebgpu: async () => true,
    });
    expect((await b.availability()).available).toBe(true);
  });

  it('模型未加载 → 不可用但 needsDownload', async () => {
    const b = new WebllmBackend({
      modelId: 'qwen2.5-0.5b',
      engine: fakeEngine({ loaded: null }),
      detectWebgpu: async () => true,
    });
    const avail = await b.availability();
    expect(avail.available).toBe(false);
    expect(avail.needsDownload).toBe(true);
  });
});

describe('WebllmBackend.mine', () => {
  const samples = [{ text: '加vx约炮', handle: 'bot' }];

  it('模型已加载时直接推理并解析', async () => {
    const output = JSON.stringify({
      isNewPattern: true,
      confidence: 0.75,
      summary: '色情',
      suggestedRules: [{ type: 'keyword', value: '约炮', category: 'porn' }],
    });
    const b = new WebllmBackend({
      modelId: 'qwen2.5-0.5b',
      engine: fakeEngine({ loaded: 'qwen2.5-0.5b', output }),
      detectWebgpu: async () => true,
    });
    const result = await b.mine(samples);
    expect(result.isNewPattern).toBe(true);
    expect(result.suggestedRules[0]?.value).toBe('约炮');
  });

  it('模型未加载时先 load 再推理', async () => {
    const output = '{"isNewPattern":false,"confidence":0,"summary":"","suggestedRules":[]}';
    const b = new WebllmBackend({
      modelId: 'qwen2.5-0.5b',
      engine: fakeEngine({ loaded: null, loadOk: true, output }),
      detectWebgpu: async () => true,
    });
    const result = await b.mine(samples);
    expect(result.isNewPattern).toBe(false); // 推理成功但结果是空
  });

  it('load 失败时降级返回空结果', async () => {
    const b = new WebllmBackend({
      modelId: 'qwen2.5-0.5b',
      engine: fakeEngine({ loaded: null, loadOk: false }),
      detectWebgpu: async () => true,
    });
    const result = await b.mine(samples);
    expect(result.isNewPattern).toBe(false);
  });

  it('chat 抛异常降级返回空结果', async () => {
    const b = new WebllmBackend({
      modelId: 'qwen2.5-0.5b',
      engine: fakeEngine({ loaded: 'qwen2.5-0.5b', chatThrow: true }),
      detectWebgpu: async () => true,
    });
    const result = await b.mine(samples);
    expect(result.isNewPattern).toBe(false);
  });

  it('无引擎返回空结果', async () => {
    const b = new WebllmBackend({ modelId: 'qwen2.5-0.5b', detectWebgpu: async () => true });
    expect((await b.mine(samples)).isNewPattern).toBe(false);
  });

  it('空样本返回空结果', async () => {
    const b = new WebllmBackend({
      modelId: 'qwen2.5-0.5b',
      engine: fakeEngine({ loaded: 'qwen2.5-0.5b' }),
      detectWebgpu: async () => true,
    });
    expect((await b.mine([])).isNewPattern).toBe(false);
  });

  it('setEngine 注入新引擎', async () => {
    const b = new WebllmBackend({ modelId: 'qwen2.5-0.5b', detectWebgpu: async () => true });
    expect((await b.availability()).available).toBe(false);
    b.setEngine(fakeEngine({ loaded: 'qwen2.5-0.5b' }));
    expect((await b.availability()).available).toBe(true);
  });

  it('实现 MiningBackend 接口', () => {
    const b = new WebllmBackend({ modelId: 'qwen2.5-0.5b' });
    expect(b.name).toBe('local-webllm');
    expect(typeof b.availability).toBe('function');
    expect(typeof b.mine).toBe('function');
  });
});
