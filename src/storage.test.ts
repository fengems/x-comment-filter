import { describe, it, expect } from 'vitest';
import { Storage, type BrowserAdapter } from './storage';
import { createRule } from './rules/types';
import { DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS } from './settings/types';
import type { RuleSet, HistoryItem, SuspiciousSample, CandidateRule } from './settings/types';

/** 内存假存储 */
function fakeAdapter(): BrowserAdapter {
  const mem = new Map<string, unknown>();
  return {
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (mem.has(k)) out[k] = mem.get(k);
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) mem.set(k, v);
    },
  };
}

describe('Storage', () => {
  describe('Settings', () => {
    it('首次读取返回默认值', async () => {
      const s = new Storage(fakeAdapter());
      expect(await s.getSettings()).toEqual(DEFAULT_SETTINGS);
    });

    it('写入后合并读取', async () => {
      const s = new Storage(fakeAdapter());
      await s.setSettings({ enabled: false, dryRun: true });
      const got = await s.getSettings();
      expect(got.enabled).toBe(false);
      expect(got.dryRun).toBe(true);
      expect(got.action).toBe(DEFAULT_SETTINGS.action); // 未改的保持默认
    });

    it('增量写入不丢失其它字段', async () => {
      const s = new Storage(fakeAdapter());
      await s.setSettings({ enabled: false });
      await s.setSettings({ dryRun: true });
      const got = await s.getSettings();
      expect(got.enabled).toBe(false);
      expect(got.dryRun).toBe(true);
    });
  });

  describe('RuleSet', () => {
    it('首次返回空集', async () => {
      const s = new Storage(fakeAdapter());
      const rs = await s.getRuleSet();
      expect(rs.user).toEqual([]);
      expect(rs.builtin).toEqual([]);
    });

    it('flattenRules 合并所有来源', () => {
      const rs: RuleSet = {
        user: [createRule({ value: 'u1' })],
        builtin: [createRule({ value: 'b1' })],
        cloud: [createRule({ value: 'c1' })],
        aiMined: [createRule({ value: 'a1' })],
      };
      const flat = Storage.flattenRules(rs);
      expect(flat.map((r) => r.value).sort()).toEqual(['a1', 'b1', 'c1', 'u1']);
    });

    it('写入读取一致', async () => {
      const s = new Storage(fakeAdapter());
      const rs: RuleSet = {
        user: [createRule({ value: 'test' })],
        builtin: [],
        cloud: [],
        aiMined: [],
      };
      await s.setRuleSet(rs);
      const got = await s.getRuleSet();
      expect(got.user).toHaveLength(1);
      expect(got.user[0].value).toBe('test');
    });
  });

  describe('Stats', () => {
    it('首次返回零', async () => {
      const s = new Storage(fakeAdapter());
      const stats = await s.getStats();
      expect(stats.totalBlocked).toBe(0);
    });

    it('increment 累加并按类别计数', async () => {
      const s = new Storage(fakeAdapter());
      await s.incrementStats('porn');
      await s.incrementStats('porn');
      await s.incrementStats('spam');
      const stats = await s.getStats();
      expect(stats.totalBlocked).toBe(3);
      expect(stats.byCategory.porn).toBe(2);
      expect(stats.byCategory.spam).toBe(1);
    });

    it('reset 清零', async () => {
      const s = new Storage(fakeAdapter());
      await s.incrementStats('porn');
      await s.resetStats();
      expect((await s.getStats()).totalBlocked).toBe(0);
    });

    it('todayBlocked 累加并记录日期', async () => {
      const s = new Storage(fakeAdapter());
      await s.incrementStats('porn');
      await s.incrementStats('spam');
      const stats = await s.getStats();
      expect(stats.todayBlocked).toBe(2);
      expect(stats.todayDate).toBe(new Date().toISOString().slice(0, 10));
    });

    it('resetStats 后 todayDate 设为今天', async () => {
      const s = new Storage(fakeAdapter());
      await s.resetStats();
      const stats = await s.getStats();
      expect(stats.todayDate).toBe(new Date().toISOString().slice(0, 10));
      expect(stats.byCategory).toEqual({});
    });
  });

  describe('PageStats（session）', () => {
    it('首次返回空', async () => {
      const s = new Storage(fakeAdapter());
      const ps = await s.getPageStats();
      expect(ps.count).toBe(0);
      expect(ps.byCategory).toEqual({});
    });

    it('累加本页过滤计数', async () => {
      const s = new Storage(fakeAdapter());
      await s.incrementPageStats('https://x.com/status/1', 'porn');
      await s.incrementPageStats('https://x.com/status/1', 'porn');
      await s.incrementPageStats('https://x.com/status/1', 'spam');
      const ps = await s.getPageStats();
      expect(ps.count).toBe(3);
      expect(ps.url).toBe('https://x.com/status/1');
      expect(ps.byCategory.porn).toBe(2);
      expect(ps.byCategory.spam).toBe(1);
    });

    it('URL 变化（SPA 切页）重置', async () => {
      const s = new Storage(fakeAdapter());
      await s.incrementPageStats('https://x.com/status/1', 'porn');
      await s.incrementPageStats('https://x.com/status/2', 'spam'); // 新 URL
      const ps = await s.getPageStats();
      expect(ps.count).toBe(1); // 重置后只算新页的
      expect(ps.url).toBe('https://x.com/status/2');
      expect(ps.byCategory.porn).toBeUndefined(); // 旧类别清掉
      expect(ps.byCategory.spam).toBe(1);
    });
  });

  describe('History', () => {
    it('追加并保持最新在前', async () => {
      const s = new Storage(fakeAdapter());
      await s.addHistory({ user: 'a', handle: 'a', text: 'x', reason: 'r', ruleIds: [], time: 1 });
      await s.addHistory({ user: 'b', handle: 'b', text: 'y', reason: 'r', ruleIds: [], time: 2 });
      const h = await s.getHistory();
      expect(h[0].handle).toBe('b'); // 最新在前
      expect(h).toHaveLength(2);
    });

    it('超过上限截断为最近 N 条', async () => {
      const s = new Storage(fakeAdapter());
      const items: HistoryItem[] = Array.from({ length: 250 }, (_, i) => ({
        user: `u${i}`,
        handle: `h${i}`,
        text: 'x',
        reason: 'r',
        ruleIds: [],
        time: i,
      }));
      for (const it of items) await s.addHistory(it);
      const h = await s.getHistory();
      expect(h.length).toBeLessThanOrEqual(200);
      // 最早的被丢弃
      expect(h.some((x) => x.handle === 'h0')).toBe(false);
      // 最新的保留
      expect(h[0].handle).toBe('h249');
    });
  });

  describe('Cloud keywords', () => {
    it('写入读取一致', async () => {
      const s = new Storage(fakeAdapter());
      await s.setCloudKeywords('约炮\n博彩', 'etag123', 'ok');
      const got = await s.getCloudKeywords();
      expect(got.text).toBe('约炮\n博彩');
      expect(got.etag).toBe('etag123');
      expect(got.status).toBe('ok');
      expect(got.lastSync).toBeGreaterThan(0);
    });
  });

  describe('AiSettings', () => {
    it('首次返回默认', async () => {
      const s = new Storage(fakeAdapter());
      expect(await s.getAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
    });
    it('增量写入合并', async () => {
      const s = new Storage(fakeAdapter());
      await s.setAiSettings({ backend: 'cloud', cloudApiKey: 'sk-xxx' });
      const got = await s.getAiSettings();
      expect(got.backend).toBe('cloud');
      expect(got.cloudApiKey).toBe('sk-xxx');
      expect(got.miningBatchSize).toBe(DEFAULT_AI_SETTINGS.miningBatchSize);
    });
  });

  describe('SuspiciousPool', () => {
    function sample(fp: string): SuspiciousSample {
      return { fingerprint: fp, text: fp, handle: 'h', suspicion: 0.6, time: 1 };
    }
    it('追加并按 fingerprint 去重', async () => {
      const s = new Storage(fakeAdapter());
      await s.addSuspicious(sample('a'));
      await s.addSuspicious(sample('a')); // 重复不进
      await s.addSuspicious(sample('b'));
      const pool = await s.getSuspiciousPool();
      expect(pool).toHaveLength(2);
    });
    it('removeSuspicious 删除指定指纹', async () => {
      const s = new Storage(fakeAdapter());
      await s.addSuspicious(sample('a'));
      await s.addSuspicious(sample('b'));
      await s.removeSuspicious(['a']);
      const pool = await s.getSuspiciousPool();
      expect(pool.map((p) => p.fingerprint)).toEqual(['b']);
    });
    it('超过上限截断', async () => {
      const s = new Storage(fakeAdapter());
      // MAX_SUSPICIOUS_POOL=500，塞 550 条
      for (let i = 0; i < 550; i++) await s.addSuspicious(sample(`fp${i}`));
      const pool = await s.getSuspiciousPool();
      expect(pool.length).toBeLessThanOrEqual(500);
      // 最旧的被丢弃
      expect(pool.some((p) => p.fingerprint === 'fp0')).toBe(false);
      expect(pool.some((p) => p.fingerprint === 'fp549')).toBe(true);
    });
  });

  describe('Candidates', () => {
    function candidate(value: string): CandidateRule {
      return {
        rule: createRule({ value }),
        confidence: 0.8,
        reason: 'r',
        evidenceCount: 3,
        examples: ['e'],
        createdAt: Date.now(),
        status: 'pending',
      };
    }
    it('追加并按 value 去重，只入 pending', async () => {
      const s = new Storage(fakeAdapter());
      await s.addCandidates([candidate('约炮'), candidate('博彩'), candidate('dup')]);
      await s.addCandidates([candidate('约炮')]); // 重复不入
      expect(await s.getPendingCandidates()).toHaveLength(3);
    });
    it('acceptCandidate 置 accepted 并写入 aiMined 规则集', async () => {
      const s = new Storage(fakeAdapter());
      await s.addCandidates([candidate('约炮')]);
      await s.acceptCandidate('约炮');
      expect((await s.getPendingCandidates())).toHaveLength(0);
      const rs = await s.getRuleSet();
      expect(rs.aiMined.some((r) => r.value === '约炮')).toBe(true);
    });
    it('rejectCandidate 置 rejected 并加负反馈', async () => {
      const s = new Storage(fakeAdapter());
      await s.addCandidates([candidate('约炮')]);
      await s.rejectCandidate('约炮', 'fp1');
      expect((await s.getPendingCandidates())).toHaveLength(0);
      expect(await s.isNegative('fp1')).toBe(true);
    });
    it('accept 不存在的 value 无副作用', async () => {
      const s = new Storage(fakeAdapter());
      await s.acceptCandidate('不存在');
      expect((await s.getRuleSet()).aiMined).toHaveLength(0);
    });
  });

  describe('Negatives', () => {
    it('追加去重 + isNegative 判定', async () => {
      const s = new Storage(fakeAdapter());
      expect(await s.isNegative('a')).toBe(false);
      await s.addNegative('a');
      await s.addNegative('a'); // 去重
      expect(await s.isNegative('a')).toBe(true);
      expect(await s.getNegatives()).toHaveLength(1);
    });
  });
});
