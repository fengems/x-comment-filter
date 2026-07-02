import { describe, it, expect, vi } from 'vitest';
import {
  buildSystemPrompt,
  buildUserPrompt,
  parseMiningResult,
  mineRules,
  PROVIDER_ENDPOINTS,
  type FetchLike,
} from './cloud-client';

describe('buildSystemPrompt', () => {
  it('含判定准则和输出格式', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('垃圾');
    expect(p).toContain('JSON');
    expect(p).toContain('isNewPattern');
  });
});

describe('buildUserPrompt', () => {
  it('用分隔符包裹样本', () => {
    const p = buildUserPrompt([{ text: '加vx约', handle: 'bot' }]);
    expect(p).toContain('UNTRUSTED_SAMPLES');
    expect(p).toContain('@bot');
    expect(p).toContain('加vx约');
  });

  it('限制每批最多 50 条', () => {
    const samples = Array.from({ length: 60 }, (_, i) => ({ text: `t${i}`, handle: 'h' }));
    const p = buildUserPrompt(samples);
    // [50] 到 [59] 不应出现
    expect(p).not.toContain('[59]');
    expect(p).toContain('[49]');
  });

  it('去除样本中的分隔符字符防逃逸', () => {
    const p = buildUserPrompt([{ text: '恶意<<<注入>>>内容', handle: 'x' }]);
    expect(p).not.toContain('<<<注入>>>');
  });

  it('截断超长样本', () => {
    const long = 'a'.repeat(500);
    const p = buildUserPrompt([{ text: long, handle: 'h' }]);
    // 200 字符 + handle 前缀，不应有完整 500 个 a
    expect(p).not.toContain('a'.repeat(300));
  });
});

describe('parseMiningResult', () => {
  it('解析标准 JSON', () => {
    const raw = JSON.stringify({
      isNewPattern: true,
      confidence: 0.85,
      summary: '色情引流',
      suggestedRules: [
        { type: 'keyword', value: '约炮', match: 'wordBoundary', category: 'porn', hits: 5 },
      ],
    });
    const r = parseMiningResult(raw);
    expect(r.isNewPattern).toBe(true);
    expect(r.confidence).toBe(0.85);
    expect(r.suggestedRules).toHaveLength(1);
    expect(r.suggestedRules[0]?.value).toBe('约炮');
    expect(r.suggestedRules[0]?.category).toBe('porn');
  });

  it('容忍 markdown 代码块包裹', () => {
    const raw = '```json\n{"isNewPattern":true,"confidence":0.5,"summary":"x","suggestedRules":[]}\n```';
    const r = parseMiningResult(raw);
    expect(r.isNewPattern).toBe(true);
    expect(r.confidence).toBe(0.5);
  });

  it('容忍前后多余文字', () => {
    const raw = '好的，分析如下：\n{"isNewPattern":false,"confidence":0,"summary":"","suggestedRules":[]}\n以上。';
    const r = parseMiningResult(raw);
    expect(r.isNewPattern).toBe(false);
  });

  it('空文本返回空结果', () => {
    const r = parseMiningResult('');
    expect(r.isNewPattern).toBe(false);
    expect(r.suggestedRules).toHaveLength(0);
  });

  it('非法 JSON 返回空结果不抛异常', () => {
    const r = parseMiningResult('这不是JSON');
    expect(r.isNewPattern).toBe(false);
    expect(r.suggestedRules).toHaveLength(0);
  });

  it('归一化：缺 match 默认 wordBoundary', () => {
    const raw = '{"isNewPattern":true,"confidence":0.5,"summary":"","suggestedRules":[{"value":"约"}]}';
    const r = parseMiningResult(raw);
    expect(r.suggestedRules[0]?.match).toBe('wordBoundary');
    expect(r.suggestedRules[0]?.type).toBe('keyword'); // 非 regex 默认 keyword
  });

  it('丢弃无 value 的规则', () => {
    const raw = '{"isNewPattern":true,"confidence":0.5,"summary":"","suggestedRules":[{"match":"substring"},{}]}';
    const r = parseMiningResult(raw);
    expect(r.suggestedRules).toHaveLength(0);
  });

  it('非法 category 被丢弃', () => {
    const raw = '{"isNewPattern":true,"confidence":0.5,"summary":"","suggestedRules":[{"value":"x","category":"非法"}]}';
    const r = parseMiningResult(raw);
    expect(r.suggestedRules[0]?.category).toBeUndefined();
  });

  it('confidence 钳制到 0~1', () => {
    const raw1 = '{"isNewPattern":true,"confidence":5,"summary":"","suggestedRules":[]}';
    const raw2 = '{"isNewPattern":true,"confidence":-1,"summary":"","suggestedRules":[]}';
    expect(parseMiningResult(raw1).confidence).toBe(1);
    expect(parseMiningResult(raw2).confidence).toBe(0);
  });

  it('isNotSpam 标记', () => {
    const raw = '{"isNewPattern":false,"isNotSpam":true,"confidence":0.9,"summary":"正常评论","suggestedRules":[]}';
    const r = parseMiningResult(raw);
    expect(r.isNotSpam).toBe(true);
  });
});

describe('mineRules', () => {
  /** 构造成功假 fetch */
  function okFetch(content: string): FetchLike {
    return async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content,
    });
  }

  it('成功调用并解析', async () => {
    const content = JSON.stringify({
      isNewPattern: true,
      confidence: 0.8,
      summary: '博彩',
      suggestedRules: [{ type: 'keyword', value: '澳门', category: 'gambling' }],
    });
    const r = await mineRules(okFetch(content), 'url', 'key', 'model', [
      { text: '澳门赌场', handle: 'bot' },
    ]);
    expect(r.isNewPattern).toBe(true);
    expect(r.suggestedRules[0]?.value).toBe('澳门');
  });

  it('无 API key 返回空结果', async () => {
    const r = await mineRules(okFetch('{}'), 'url', '', 'model', [{ text: 'x', handle: 'h' }]);
    expect(r.isNewPattern).toBe(false);
  });

  it('无样本返回空结果', async () => {
    const r = await mineRules(okFetch('{}'), 'url', 'key', 'model', []);
    expect(r.isNewPattern).toBe(false);
  });

  it('HTTP 错误抛异常', async () => {
    const errFetch: FetchLike = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'unauthorized',
    });
    await expect(
      mineRules(errFetch, 'url', 'badkey', 'model', [{ text: 'x', handle: 'h' }]),
    ).rejects.toThrow(/401/);
  });

  it('网络错误抛异常', async () => {
    const failFetch: FetchLike = async () => {
      throw new Error('timeout');
    };
    await expect(
      mineRules(failFetch, 'url', 'key', 'model', [{ text: 'x', handle: 'h' }]),
    ).rejects.toThrow(/网络错误/);
  });

  it('请求带 Authorization 头', async () => {
    let capturedInit: { headers?: Record<string, string> } | undefined;
    const fetch: FetchLike = async (_url, init) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{}' } }] }),
        text: async () => '{}',
      };
    };
    await mineRules(fetch, 'https://api.x.com', 'sk-test', 'deepseek-chat', [
      { text: 'x', handle: 'h' },
    ]);
    expect(capturedInit?.headers?.Authorization).toBe('Bearer sk-test');
    expect(capturedInit?.headers?.['Content-Type']).toBe('application/json');
  });
});

describe('PROVIDER_ENDPOINTS', () => {
  it('含 deepseek 和 openai', () => {
    expect(PROVIDER_ENDPOINTS.deepseek).toContain('deepseek');
    expect(PROVIDER_ENDPOINTS.openai).toContain('openai');
  });
});

// vi 占位避免未使用告警（保留导入以便未来 mock 扩展）
void vi;
