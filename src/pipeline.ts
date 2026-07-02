/**
 * 过滤管线编排：把 observer → cache → extractor → context → engine → action
 * 串联起来。这是 content script 的核心逻辑。
 *
 * 设计为可注入依赖的纯类（不直接依赖 chrome.* / 全局 location），
 * 便于在 jsdom 里单测：传入 window/location/document 即可。
 */

import { ObserverManager } from './dom/observer';
import { CacheManager } from './dom/cache';
import {
  extractTweet,
} from './dom/extractor';
import {
  getPageContext,
  extractStatusId,
  isMainTweet,
  shouldProcess,
  type PageContext,
} from './dom/context';
import { applyAction, revert } from './dom/action';
import { RuleEngine } from './rules/engine';
import { suspicionScore } from './ai/suspicion';
import type { Rule, RuleScope, SpamCategory } from './rules/types';
import type { Settings, BlockAction, HistoryItem } from './settings/types';

/** 单条处理结果 */
export interface ProcessOutcome {
  blocked: boolean;
  ruleIds: string[];
  category?: SpamCategory;
  /** 可疑分（未命中但可疑时记录，用于 AI 层） */
  suspicion?: number;
}

export interface PipelineCallbacks {
  /** 命中时记录（用于统计/历史） */
  onBlocked?: (item: Omit<HistoryItem, 'time'>) => void;
  /** 可疑样本入池（用于 AI 规则挖掘） */
  onSuspicious?: (data: { text: string; handle: string; suspicion: number }) => void;
  /** 日志 */
  log?: (...args: unknown[]) => void;
}

export interface PipelineDeps {
  /** 当前 URL（默认 window.location.href） */
  getUrl?: () => string;
  /** 获取 pathname（默认 window.location.pathname） */
  getPathname?: () => string;
  /** 可疑分阈值（测试/调参用），默认 0.5 */
  aiSuspicionThreshold?: number;
}

export class FilterPipeline {
  private engine = new RuleEngine();
  private cache = new CacheManager();
  private observer: ObserverManager | null = null;
  private currentUrl = '';
  private currentPath = '';
  /** 可疑分阈值，达标才送 AI 待复核池。可通过 deps 注入覆盖（测试用）。 */
  private aiSuspicionThreshold = 0.5;

  constructor(
    private settings: Settings,
    private callbacks: PipelineCallbacks = {},
    private deps: PipelineDeps = {},
  ) {
    this.refreshUrl();
    if (deps.aiSuspicionThreshold !== undefined) {
      this.aiSuspicionThreshold = deps.aiSuspicionThreshold;
    }
  }

  /** 更新设置 */
  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  /** 更新规则集（会自动 bump 缓存版本，强制重算） */
  updateRules(rules: Rule[]): void {
    this.engine.update(rules);
    this.cache.bumpVersion();
    this.log(`[TCFilter] 规则已更新，生效 ${this.engine.size()} 条，问题 ${this.engine.getIssues().length} 条`);
  }

  /** 启动观察 */
  start(): void {
    if (this.observer) return;
    this.observer = new ObserverManager({
      onBatch: (cells) => this.processBatch(cells),
      onUrlChange: () => this.onUrlChange(),
    });
    this.observer.start();
    this.log('[TCFilter] 已启动');
  }

  stop(): void {
    this.observer?.stop();
    this.observer = null;
  }

  /** 当前 URL 刷新（路由变化时调用） */
  refreshUrl(): void {
    const getUrl = this.deps.getUrl ?? (() => window.location.href);
    const getPath = this.deps.getPathname ?? (() => window.location.pathname);
    this.currentUrl = getUrl();
    this.currentPath = getPath();
  }

  private onUrlChange(): void {
    this.refreshUrl();
    // 清缓存，让新页面的节点重新判定（旧页面的缓存已无意义）
    this.cache.clearAll();
  }

  /** 处理一批 cell（来自 observer） */
  processBatch(cells: HTMLElement[]): void {
    if (!this.settings.enabled) return;
    for (const cell of cells) {
      this.processCell(cell);
    }
  }

  /** 处理单个 cell。暴露为 public 便于单测和手动触发。 */
  processCell(cell: HTMLElement): ProcessOutcome {
    const outcome: ProcessOutcome = { blocked: false, ruleIds: [] };

    // 1. 提取
    const data = extractTweet(cell);
    if (!data) return outcome;

    // 2. 全局白名单用户：直接放行
    if (this.isWhitelisted(data.handle)) {
      return outcome;
    }

    // 3. 场景与主推文判定
    const pageStatusId = extractStatusId(this.currentPath);
    const pageCtx: PageContext = getPageContext(this.currentPath);
    const isMain = isMainTweet(cell, pageStatusId);
    if (!shouldProcess(pageCtx, isMain, this.settings.scope)) {
      return outcome;
    }

    // 4. 缓存判定（指纹未变则跳过）
    if (!this.cache.shouldReprocess(cell, data.text, data.handle)) {
      return outcome;
    }

    // 5. 规则匹配
    const scope: RuleScope = pageCtx === 'feed' ? 'feed' : 'comment';
    const hits = this.engine.match(data.text, data.handle, scope);

    if (hits.length > 0) {
      // 6a. 命中：执行动作
      const category = hits[0]?.category;
      const action = this.settings.action;
      this.apply(cell, action, category, hits);
      outcome.blocked = true;
      outcome.ruleIds = hits.map((r) => r.id);
      outcome.category = category;

      this.callbacks.onBlocked?.({
        user: data.username,
        handle: data.handle,
        text: data.text.slice(0, 200),
        reason: hits.map((h) => h.value).join(', '),
        category,
        ruleIds: outcome.ruleIds,
      });

      // 去重计数
      const dedupKey = `${data.handle}|${data.text.slice(0, 100)}`;
      void this.cache.recordDedup(dedupKey);
    } else {
      // 6b. 未命中：算可疑分，可能入 AI 待复核池
      const suspicion = suspicionScore(data.text);
      if (suspicion >= this.aiSuspicionThreshold) {
        outcome.suspicion = suspicion;
        this.callbacks.onSuspicious?.({
          text: data.text.slice(0, 200),
          handle: data.handle,
          suspicion,
        });
      }
    }

    return outcome;
  }

  /** 紧急还原所有动作（关闭扩展时调用） */
  revertAll(cells: Iterable<HTMLElement>): void {
    for (const cell of cells) {
      revert(cell);
      this.cache.clearNode(cell);
    }
  }

  private isWhitelisted(handle: string): boolean {
    if (!handle) return false;
    return this.settings.whitelistUsers.some(
      (w) => w.toLowerCase() === handle.toLowerCase(),
    );
  }

  private apply(
    cell: HTMLElement,
    action: BlockAction,
    category: SpamCategory | undefined,
    hits: { value: string }[],
  ): void {
    if (this.settings.dryRun) {
      this.log(`[TCFilter][dry-run] 命中：${hits.map((h) => h.value).join(', ')}`);
      return;
    }
    applyAction(cell, action, category, hits.map((h) => h.value).join(', '));
  }

  private log(...args: unknown[]): void {
    if (this.settings.debug) this.callbacks.log?.(...args);
  }
}
