/**
 * MutationObserver 封装 + 批处理 + 防抖 + 虚拟列表复用回捞。
 *
 * 设计（docs/02-技术方案.md §4.1，综合 x-comment-blocker 批处理 + MXGA 防抖）：
 *  - childList + subtree，不配 characterData（避免文本抖动）
 *  - pending Set 在每轮回调末尾批量收集，防抖合并
 *  - 处理 X 虚拟列表复用：对 mutation.target 也做 cellInnerDiv 回捞
 *  - chrome.runtime?.id 卸载保护，防扩展更新后 observer 抛错
 *  - SPA 路由切换：通过 onUrlChange 回调通知外部清缓存
 *  - 定时兜底重扫（防边缘情况）
 */

/** 收集到的待处理 cell 回调 */
export type BatchHandler = (cells: HTMLElement[]) => void;
/** SPA URL 变化回调 */
export type UrlChangeHandler = (url: string) => void;

interface ObserverOptions {
  /** 批处理回调 */
  onBatch: BatchHandler;
  /** URL 变化回调（可选） */
  onUrlChange?: UrlChangeHandler;
  /** 防抖延迟 ms，默认 100 */
  debounceMs?: number;
  /** 定时兜底间隔 ms，默认 4000 */
  fallbackIntervalMs?: number;
}

export class ObserverManager {
  private observer: MutationObserver | null = null;
  private pending = new Set<HTMLElement>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private lastUrl = '';
  private started = false;

  constructor(private opts: ObserverOptions) {
    // 取当前 URL（测试环境下 location 可能未初始化）
    this.lastUrl = typeof location !== 'undefined' ? location.href : '';
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.observer = new MutationObserver(this.handle);
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // 定时兜底：即便不滚动，也定期 flush
    const interval = this.opts.fallbackIntervalMs ?? 4000;
    this.fallbackTimer = setInterval(() => this.flush(), interval);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    this.pending.clear();
    this.started = false;
  }

  /** 手动触发一次完整扫描（外部可调用，如规则变更后） */
  flush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pending.size === 0) return;
    const batch = Array.from(this.pending);
    this.pending.clear();
    this.opts.onBatch(batch);
  }

  private handle = (mutations: MutationRecord[]): void => {
    // 扩展卸载保护
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runtime: any = (globalThis as any).chrome?.runtime;
    if (runtime && typeof runtime.id === 'string' && !runtime.id) {
      this.stop();
      return;
    }

    // SPA 路由切换检测
    const currentUrl = typeof location !== 'undefined' ? location.href : '';
    if (currentUrl !== this.lastUrl) {
      this.lastUrl = currentUrl;
      this.opts.onUrlChange?.(currentUrl);
    }

    for (const m of mutations) {
      // 新增节点里收集 cell
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        this.collect(node as HTMLElement);
      }
      // 虚拟列表复用：target 自身或祖先可能是被复用的 cell
      if (m.target.nodeType === Node.ELEMENT_NODE) {
        const reused = (m.target as HTMLElement).closest?.(
          '[data-testid="cellInnerDiv"]',
        );
        if (reused) this.pending.add(reused as HTMLElement);
      }
    }

    this.scheduleFlush();
  };

  private collect(node: HTMLElement): void {
    if (node.getAttribute('data-testid') === 'cellInnerDiv') {
      this.pending.add(node);
    } else {
      node
        .querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]')
        .forEach((c) => this.pending.add(c));
    }
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) return;
    const ms = this.opts.debounceMs ?? 100;
    this.debounceTimer = setTimeout(() => this.flush(), ms);
  }
}
