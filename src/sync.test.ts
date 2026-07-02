import { describe, it, expect } from 'vitest';
import { syncCloudKeywords, type Fetcher } from './sync';

/** 构造假 fetcher */
function fakeFetcher(opts: {
  status: number;
  body?: string;
  etag?: string;
  throwErr?: string;
}): Fetcher {
  return async () => {
    if (opts.throwErr) throw new Error(opts.throwErr);
    return {
      status: opts.status,
      text: async () => opts.body ?? '',
      headers: { get: (name: string) => (name === 'ETag' ? opts.etag ?? null : null) },
    };
  };
}

describe('syncCloudKeywords', () => {
  it('200 拉取新词库，解析成规则', async () => {
    const fetcher = fakeFetcher({
      status: 200,
      body: '约炮 #category=porn\n澳门赌场 #category=gambling',
      etag: 'new-etag',
    });
    const res = await syncCloudKeywords(fetcher, 'https://example/kw.txt', '');
    expect(res.updated).toBe(true);
    expect(res.etag).toBe('new-etag');
    expect(res.rules).toHaveLength(2);
    expect(res.rules![0].source).toBe('cloud');
    expect(res.rules![0].category).toBe('porn');
  });

  it('304 未变，不更新', async () => {
    const fetcher = fakeFetcher({ status: 304 });
    const res = await syncCloudKeywords(fetcher, 'url', 'old-etag');
    expect(res.updated).toBe(false);
    expect(res.etag).toBe('old-etag');
    expect(res.rules).toBeUndefined();
  });

  it('403 限流标记错误', async () => {
    const fetcher = fakeFetcher({ status: 403 });
    const res = await syncCloudKeywords(fetcher, 'url', '');
    expect(res.updated).toBe(false);
    expect(res.error).toMatch(/限流/);
  });

  it('429 限流标记错误', async () => {
    const fetcher = fakeFetcher({ status: 429 });
    const res = await syncCloudKeywords(fetcher, 'url', '');
    expect(res.updated).toBe(false);
    expect(res.error).toMatch(/限流/);
  });

  it('网络错误返回 error', async () => {
    const fetcher = fakeFetcher({ status: 0, throwErr: 'timeout' });
    const res = await syncCloudKeywords(fetcher, 'url', '');
    expect(res.updated).toBe(false);
    expect(res.error).toMatch(/网络错误/);
  });

  it('其它非 200 状态返回 error', async () => {
    const fetcher = fakeFetcher({ status: 500 });
    const res = await syncCloudKeywords(fetcher, 'url', '');
    expect(res.updated).toBe(false);
    expect(res.error).toBe('HTTP 500');
  });

  it('无 ETag 响应头时沿用旧 etag', async () => {
    const fetcher = fakeFetcher({ status: 200, body: '约炮', etag: undefined });
    const res = await syncCloudKeywords(fetcher, 'url', 'prev-etag');
    expect(res.etag).toBe('prev-etag');
  });
});
