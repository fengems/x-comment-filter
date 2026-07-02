import { describe, it, expect } from 'vitest';
import { ChromeAiBackend, getLanguageModelGlobal, type LanguageModelLike } from './chrome-ai';

/** 构造假 LanguageModel 全局 */
function fakeLM(opts: {
  avail: 'available' | 'downloadable' | 'downloading' | 'unavailable';
  output?: string;
  throwOnCreate?: boolean;
}): LanguageModelLike {
  return {
    availability: async () => opts.avail,
    create: async () => {
      if (opts.throwOnCreate) throw new Error('create failed');
      return {
        prompt: async () => opts.output ?? '',
        promptStreaming: () => {
          // 构造一个 ReadableStream<string>，分两块吐出 output
          const chunks = (opts.output ?? '').match(/.{1,5}/g) ?? [];
          return new ReadableStream<string>({
            start(controller) {
              for (const c of chunks) controller.enqueue(c);
              controller.close();
            },
          }) as ReadableStream<string>;
        },
        destroy: () => {},
      };
    },
  };
}

/** 构造带假 LM 的 scope */
function scopeWith(lm?: LanguageModelLike): typeof globalThis {
  const scope = { LanguageModel: lm } as unknown as typeof globalThis;
  return scope;
}

describe('getLanguageModelGlobal', () => {
  it('存在 LanguageModel 全局时返回', () => {
    const scope = scopeWith(fakeLM({ avail: 'available' }));
    expect(getLanguageModelGlobal(scope)).toBeDefined();
  });
  it('不存在时返回 undefined', () => {
    expect(getLanguageModelGlobal({} as typeof globalThis)).toBeUndefined();
  });
});

describe('ChromeAiBackend.availability', () => {
  it('无 LanguageModel 全局 → 不可用', async () => {
    const backend = new ChromeAiBackend(scopeWith(undefined));
    const avail = await backend.availability();
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain('不支持');
  });

  it("available → 可用", async () => {
    const backend = new ChromeAiBackend(scopeWith(fakeLM({ avail: 'available' })));
    expect((await backend.availability()).available).toBe(true);
  });

  it("downloadable → 不可用但提示需下载", async () => {
    const backend = new ChromeAiBackend(scopeWith(fakeLM({ avail: 'downloadable' })));
    const avail = await backend.availability();
    expect(avail.available).toBe(false);
    expect(avail.needsDownload).toBe(true);
    expect(avail.reason).toContain('下载');
  });

  it("downloading → 不可用，提示下载中", async () => {
    const backend = new ChromeAiBackend(scopeWith(fakeLM({ avail: 'downloading' })));
    const avail = await backend.availability();
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain('下载中');
  });

  it("unavailable → 不可用", async () => {
    const backend = new ChromeAiBackend(scopeWith(fakeLM({ avail: 'unavailable' })));
    const avail = await backend.availability();
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain('不可用');
  });
});

describe('ChromeAiBackend.mine', () => {
  const samples = [{ text: '加vx约炮', handle: 'bot' }];

  it('流式收集并解析结果', async () => {
    const output = JSON.stringify({
      isNewPattern: true,
      confidence: 0.8,
      summary: '色情',
      suggestedRules: [{ type: 'keyword', value: '约炮', category: 'porn' }],
    });
    const backend = new ChromeAiBackend(scopeWith(fakeLM({ avail: 'available', output })));
    const result = await backend.mine(samples);
    expect(result.isNewPattern).toBe(true);
    expect(result.suggestedRules[0]?.value).toBe('约炮');
  });

  it('模型不可用时返回空结果', async () => {
    const backend = new ChromeAiBackend(scopeWith(fakeLM({ avail: 'unavailable' })));
    const result = await backend.mine(samples);
    expect(result.isNewPattern).toBe(false);
  });

  it('无 LanguageModel 全局返回空结果', async () => {
    const backend = new ChromeAiBackend(scopeWith(undefined));
    const result = await backend.mine(samples);
    expect(result.isNewPattern).toBe(false);
  });

  it('空样本返回空结果', async () => {
    const backend = new ChromeAiBackend(scopeWith(fakeLM({ avail: 'available', output: '{}' })));
    expect((await backend.mine([])).isNewPattern).toBe(false);
  });

  it('create 抛异常时优雅降级返回空结果', async () => {
    const backend = new ChromeAiBackend(
      scopeWith(fakeLM({ avail: 'available', throwOnCreate: true })),
    );
    const result = await backend.mine(samples);
    expect(result.isNewPattern).toBe(false); // 不抛异常，降级
  });

  it('非法 JSON 输出降级返回空结果', async () => {
    const backend = new ChromeAiBackend(
      scopeWith(fakeLM({ avail: 'available', output: '这不是JSON' })),
    );
    const result = await backend.mine(samples);
    expect(result.isNewPattern).toBe(false);
  });

  it('实现 MiningBackend 接口', () => {
    const backend = new ChromeAiBackend(scopeWith(undefined));
    expect(backend.name).toBe('local-chrome');
    expect(typeof backend.availability).toBe('function');
    expect(typeof backend.mine).toBe('function');
  });
});
