/**
 * 存储层：封装 chrome.storage 读写 + 规则集管理。
 *
 * 设计（docs/02-技术方案.md §4.9）：
 *  - 统一 key 前缀 tfc:，杜绝前后端不一致 bug（xModerator 教训）
 *  - 双通道：settings 走 sync（跨设备），大数据走 local
 *  - 规则合并：builtin + user + cloud + aiMined → 扁平数组给引擎
 *
 * chrome 依赖通过 BrowserAdapter 接口注入，便于单测（fake storage）。
 */
import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  DEFAULT_AI_SETTINGS,
  DEFAULT_STATS,
  EMPTY_RULE_SET,
  MAX_SUSPICIOUS_POOL,
  MAX_CANDIDATES,
  MAX_NEGATIVES,
  type Settings,
  type AiSettings,
  type Stats,
  type HistoryItem,
  type RuleSet,
  type SuspiciousSample,
  type CandidateRule,
  type PageStats,
  EMPTY_PAGE_STATS,
} from './settings/types';
import type { Rule } from './rules/types';

/** 浏览器存储适配器：抽象 chrome.storage，便于单测注入假实现 */
export interface BrowserAdapter {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** chrome.storage 的最小封装（三通道：sync / local / session） */
const chromeAdapter: BrowserAdapter = {
  async get(keys) {
    const syncKeys = keys.filter((k) => k === STORAGE_KEYS.SETTINGS);
    const sessionKeys = keys.filter((k) => k === STORAGE_KEYS.PAGE_STATS);
    const localKeys = keys.filter((k) => k !== STORAGE_KEYS.SETTINGS && k !== STORAGE_KEYS.PAGE_STATS);
    const out: Record<string, unknown> = {};
    if (syncKeys.length > 0) Object.assign(out, await chrome.storage.sync.get(syncKeys));
    if (localKeys.length > 0) Object.assign(out, await chrome.storage.local.get(localKeys));
    if (sessionKeys.length > 0) {
      // session 在某些环境可能不可用，降级 local
      try {
        Object.assign(out, await chrome.storage.session.get(sessionKeys));
      } catch {
        Object.assign(out, await chrome.storage.local.get(sessionKeys));
      }
    }
    return out;
  },
  async set(items) {
    const syncItems: Record<string, unknown> = {};
    const localItems: Record<string, unknown> = {};
    const sessionItems: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(items)) {
      if (k === STORAGE_KEYS.SETTINGS) syncItems[k] = v;
      else if (k === STORAGE_KEYS.PAGE_STATS) sessionItems[k] = v;
      else localItems[k] = v;
    }
    if (Object.keys(syncItems).length > 0) await chrome.storage.sync.set(syncItems);
    if (Object.keys(localItems).length > 0) await chrome.storage.local.set(localItems);
    if (Object.keys(sessionItems).length > 0) {
      try {
        await chrome.storage.session.set(sessionItems);
      } catch {
        await chrome.storage.local.set(sessionItems);
      }
    }
  },
};

export class Storage {
  constructor(private adapter: BrowserAdapter = chromeAdapter) {}

  // ---- Settings（sync） ----
  async getSettings(): Promise<Settings> {
    const data = await this.adapter.get([STORAGE_KEYS.SETTINGS]);
    return { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] as Partial<Settings> | undefined) };
  }

  async setSettings(patch: Partial<Settings>): Promise<void> {
    const current = await this.getSettings();
    await this.adapter.set({ [STORAGE_KEYS.SETTINGS]: { ...current, ...patch } });
  }

  // ---- RuleSet（local） ----
  async getRuleSet(): Promise<RuleSet> {
    const data = await this.adapter.get([STORAGE_KEYS.RULES]);
    const stored = data[STORAGE_KEYS.RULES] as Partial<RuleSet> | undefined;
    // 深拷贝各数组，避免修改污染模块级常量 EMPTY_RULE_SET
    return {
      user: stored?.user ? [...stored.user] : [],
      builtin: stored?.builtin ? [...stored.builtin] : [],
      cloud: stored?.cloud ? [...stored.cloud] : [],
      aiMined: stored?.aiMined ? [...stored.aiMined] : [],
    };
  }

  async setRuleSet(rs: RuleSet): Promise<void> {
    await this.adapter.set({ [STORAGE_KEYS.RULES]: rs });
  }

  /** 合并所有来源规则为扁平数组（给 RuleEngine） */
  static flattenRules(rs: RuleSet): Rule[] {
    return [...rs.builtin, ...rs.cloud, ...rs.aiMined, ...rs.user];
  }

  /** 现有所有规则 value 的集合（给 AI 挖掘去重用） */
  async existingRuleIndex(): Promise<Set<string>> {
    const rs = await this.getRuleSet();
    return new Set(Storage.flattenRules(rs).map((r) => r.value));
  }

  // ---- Stats（local） ----
  async getStats(): Promise<Stats> {
    const data = await this.adapter.get([STORAGE_KEYS.STATS]);
    const stored = data[STORAGE_KEYS.STATS] as Partial<Stats> | undefined;
    return { ...DEFAULT_STATS, ...stored, byCategory: { ...(stored?.byCategory ?? {}) } };
  }

  async incrementStats(category: string | undefined): Promise<void> {
    const stats = await this.getStats();
    stats.totalBlocked++;
    // 今日计数：按本地日期重置
    const today = new Date().toISOString().slice(0, 10);
    if (stats.todayDate !== today) {
      stats.todayDate = today;
      stats.todayBlocked = 0;
    }
    stats.todayBlocked++;
    const key = category ?? 'unknown';
    stats.byCategory[key] = (stats.byCategory[key] ?? 0) + 1;
    await this.adapter.set({ [STORAGE_KEYS.STATS]: stats });
  }

  async resetStats(): Promise<void> {
    await this.adapter.set({
      [STORAGE_KEYS.STATS]: { ...DEFAULT_STATS, byCategory: {}, todayDate: new Date().toISOString().slice(0, 10) },
    });
  }

  // ---- History（local，最近 N 条） ----
  private static readonly MAX_HISTORY = 200;

  async addHistory(item: HistoryItem): Promise<void> {
    const data = await this.adapter.get([STORAGE_KEYS.HISTORY]);
    const history = (data[STORAGE_KEYS.HISTORY] as HistoryItem[] | undefined) ?? [];
    history.unshift(item);
    if (history.length > Storage.MAX_HISTORY) {
      history.length = Storage.MAX_HISTORY;
    }
    await this.adapter.set({ [STORAGE_KEYS.HISTORY]: history });
  }

  async getHistory(): Promise<HistoryItem[]> {
    const data = await this.adapter.get([STORAGE_KEYS.HISTORY]);
    return (data[STORAGE_KEYS.HISTORY] as HistoryItem[] | undefined) ?? [];
  }

  // ---- 云端词库（local） ----
  async getCloudKeywords(): Promise<{ text: string; etag: string; lastSync: number; status: string }> {
    const data = await this.adapter.get([
      STORAGE_KEYS.CLOUD_KEYWORDS,
      STORAGE_KEYS.CLOUD_ETAG,
      STORAGE_KEYS.LAST_SYNC,
      STORAGE_KEYS.SYNC_STATUS,
    ]);
    return {
      text: (data[STORAGE_KEYS.CLOUD_KEYWORDS] as string | undefined) ?? '',
      etag: (data[STORAGE_KEYS.CLOUD_ETAG] as string | undefined) ?? '',
      lastSync: (data[STORAGE_KEYS.LAST_SYNC] as number | undefined) ?? 0,
      status: (data[STORAGE_KEYS.SYNC_STATUS] as string | undefined) ?? '',
    };
  }

  async setCloudKeywords(text: string, etag: string, status: string): Promise<void> {
    await this.adapter.set({
      [STORAGE_KEYS.CLOUD_KEYWORDS]: text,
      [STORAGE_KEYS.CLOUD_ETAG]: etag,
      [STORAGE_KEYS.LAST_SYNC]: Date.now(),
      [STORAGE_KEYS.SYNC_STATUS]: status,
    });
  }

  // ---- AI 设置（local，含 key 不跨设备同步） ----
  async getAiSettings(): Promise<AiSettings> {
    const data = await this.adapter.get([STORAGE_KEYS.AI_SETTINGS]);
    return {
      ...DEFAULT_AI_SETTINGS,
      ...(data[STORAGE_KEYS.AI_SETTINGS] as Partial<AiSettings> | undefined),
    };
  }

  async setAiSettings(patch: Partial<AiSettings>): Promise<void> {
    const current = await this.getAiSettings();
    await this.adapter.set({ [STORAGE_KEYS.AI_SETTINGS]: { ...current, ...patch } });
  }

  // ---- 可疑样本池（local，滚动截断） ----
  async getSuspiciousPool(): Promise<SuspiciousSample[]> {
    const data = await this.adapter.get([STORAGE_KEYS.SUSPICIOUS_POOL]);
    return (data[STORAGE_KEYS.SUSPICIOUS_POOL] as SuspiciousSample[] | undefined) ?? [];
  }

  /** 追加可疑样本，按 fingerprint 去重，截断到上限 */
  async addSuspicious(sample: SuspiciousSample): Promise<void> {
    const pool = await this.getSuspiciousPool();
    if (pool.some((s) => s.fingerprint === sample.fingerprint)) return; // 去重
    pool.push(sample);
    if (pool.length > MAX_SUSPICIOUS_POOL) {
      // 删最旧的
      pool.splice(0, pool.length - MAX_SUSPICIOUS_POOL);
    }
    await this.adapter.set({ [STORAGE_KEYS.SUSPICIOUS_POOL]: pool });
  }

  /** 移除已挖掘/已判定的一批 fingerprint */
  async removeSuspicious(fingerprints: string[]): Promise<void> {
    if (fingerprints.length === 0) return;
    const pool = await this.getSuspiciousPool();
    const set = new Set(fingerprints);
    const filtered = pool.filter((s) => !set.has(s.fingerprint));
    await this.adapter.set({ [STORAGE_KEYS.SUSPICIOUS_POOL]: filtered });
  }

  // ---- 候选规则（待用户确认，local） ----
  async getCandidates(): Promise<CandidateRule[]> {
    const data = await this.adapter.get([STORAGE_KEYS.CANDIDATE_RULES]);
    return (data[STORAGE_KEYS.CANDIDATE_RULES] as CandidateRule[] | undefined) ?? [];
  }

  /** 追加候选规则，按 value 去重，截断到上限 */
  async addCandidates(candidates: CandidateRule[]): Promise<void> {
    if (candidates.length === 0) return;
    const existing = await this.getCandidates();
    const existingValues = new Set(existing.map((c) => c.rule.value));
    for (const c of candidates) {
      if (c.status !== 'pending') continue;
      if (existingValues.has(c.rule.value)) continue;
      existing.push(c);
    }
    if (existing.length > MAX_CANDIDATES) {
      existing.splice(0, existing.length - MAX_CANDIDATES);
    }
    await this.adapter.set({ [STORAGE_KEYS.CANDIDATE_RULES]: existing });
  }

  async getPendingCandidates(): Promise<CandidateRule[]> {
    return (await this.getCandidates()).filter((c) => c.status === 'pending');
  }

  /** 采纳一条候选规则：状态置 accepted 并写入 aiMined 规则集 */
  async acceptCandidate(ruleValue: string): Promise<void> {
    const candidates = await this.getCandidates();
    const target = candidates.find((c) => c.rule.value === ruleValue);
    if (!target || target.status !== 'pending') return;
    target.status = 'accepted';
    await this.adapter.set({ [STORAGE_KEYS.CANDIDATE_RULES]: candidates });

    // 写入 aiMined 规则集，置为生效
    const rs = await this.getRuleSet();
    const rule: Rule = { ...target.rule, source: 'ai-mined', enabled: true };
    if (!rs.aiMined.some((r) => r.value === rule.value)) {
      rs.aiMined.push(rule);
      await this.setRuleSet(rs);
    }
  }

  /** 拒绝一条候选规则：状态置 rejected，并加入负反馈防止重复挖掘 */
  async rejectCandidate(ruleValue: string, fingerprint?: string): Promise<void> {
    const candidates = await this.getCandidates();
    const target = candidates.find((c) => c.rule.value === ruleValue);
    if (target && target.status === 'pending') {
      target.status = 'rejected';
      await this.adapter.set({ [STORAGE_KEYS.CANDIDATE_RULES]: candidates });
    }
    if (fingerprint) await this.addNegative(fingerprint);
  }

  // ---- 负反馈样本（local，防重复送检） ----
  async getNegatives(): Promise<string[]> {
    const data = await this.adapter.get([STORAGE_KEYS.NEGATIVE_SAMPLES]);
    return (data[STORAGE_KEYS.NEGATIVE_SAMPLES] as string[] | undefined) ?? [];
  }

  async addNegative(fingerprint: string): Promise<void> {
    const negatives = await this.getNegatives();
    if (negatives.includes(fingerprint)) return;
    negatives.push(fingerprint);
    if (negatives.length > MAX_NEGATIVES) {
      negatives.splice(0, negatives.length - MAX_NEGATIVES);
    }
    await this.adapter.set({ [STORAGE_KEYS.NEGATIVE_SAMPLES]: negatives });
  }

  /** 判断某指纹是否已被负反馈标记（不应再送检） */
  async isNegative(fingerprint: string): Promise<boolean> {
    const negatives = await this.getNegatives();
    return negatives.includes(fingerprint);
  }

  // ---- 当前页面过滤计数（session 存储） ----
  async getPageStats(): Promise<PageStats> {
    const data = await this.adapter.get([STORAGE_KEYS.PAGE_STATS]);
    const stored = data[STORAGE_KEYS.PAGE_STATS] as Partial<PageStats> | undefined;
    return { ...EMPTY_PAGE_STATS, ...stored, byCategory: { ...(stored?.byCategory ?? {}) } };
  }

  /** 累加本页过滤计数（content script 过滤命中时调用） */
  async incrementPageStats(url: string, category: string | undefined): Promise<void> {
    const ps = await this.getPageStats();
    // URL 变化（SPA 切页）→ 重置
    if (ps.url !== url) {
      ps.url = url;
      ps.count = 0;
      ps.byCategory = {};
    }
    ps.count++;
    const key = category ?? 'unknown';
    ps.byCategory[key] = (ps.byCategory[key] ?? 0) + 1;
    await this.adapter.set({ [STORAGE_KEYS.PAGE_STATS]: ps });
  }
}
