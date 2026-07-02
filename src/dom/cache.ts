/**
 * 节点缓存管理。
 *
 * 性能关键（docs/02-技术方案.md §4.6）：X 虚拟列表会复用 DOM 节点，
 * MutationObserver 会反复触发回调。若每次都重跑规则匹配会卡。
 *
 * 策略（x-comment-blocker 的 __cbxQuickHash 思路）：
 *  - 在 DOM 节点上挂 data-* 缓存当前文本+handle+规则版本的指纹，
 *    指纹不变就跳过重算。
 *  - filterVersion：规则/设置一变就自增，让所有旧指纹失效，强制重算。
 *  - 另维护一个去重计数 Set（按归一化文本+handle），带 TTL 和容量上限，
 *    防内存膨胀。
 */

const HASH_ATTR = 'data-tfc-hash';

/** 去重 Set 的容量与 TTL */
const MAX_HASHES = 5000;
const HASH_TTL_MS = 30 * 60 * 1000; // 30 分钟
/** 每多少次调用清理一次过期项 */
const PRUNE_EVERY = 100;

interface CountEntry {
  time: number;
}

export class CacheManager {
  private filterVersion = 0;
  /** 去重计数 Map：归一化 key → 写入时间戳 */
  private dedup = new Map<string, CountEntry>();
  private callCount = 0;

  /** 规则/设置变更时调用，让所有节点缓存失效 */
  bumpVersion(): void {
    this.filterVersion++;
    // 注意：不清 dedup，因为去重是按内容语义的，与规则版本无关
  }

  /** 当前 filterVersion（测试用） */
  getVersion(): number {
    return this.filterVersion;
  }

  /**
   * 判断某节点是否需要重新处理。
   * @returns true 表示需要处理（指纹变了），false 表示可跳过（指纹相同）
   */
  shouldReprocess(cell: HTMLElement, text: string, handle: string): boolean {
    const hash = `${this.filterVersion}|${text}|${handle}`;
    if (cell.getAttribute(HASH_ATTR) === hash) {
      return false; // 未变
    }
    cell.setAttribute(HASH_ATTR, hash);
    return true;
  }

  /** 清除某节点的缓存（节点被还原/展开时调用） */
  clearNode(cell: HTMLElement): void {
    cell.removeAttribute(HASH_ATTR);
  }

  /** 清除所有节点缓存（SPA 切页时调用）——DOM 上的缓存由 GC 自然失效，这里只清 dedup */
  clearAll(): void {
    this.dedup.clear();
  }

  /**
   * 记录一次命中，用于去重计数。
   * @param normalizedKey 归一化键（文本片段 + handle）
   * @returns 是否是首次记录（true=新命中，false=重复，不应再计数）
   */
  recordDedup(normalizedKey: string): boolean {
    this.maybePrune();
    if (this.dedup.has(normalizedKey)) {
      // 刷新时间，延长 TTL
      const entry = this.dedup.get(normalizedKey)!;
      entry.time = Date.now();
      return false; // 重复
    }
    this.dedup.set(normalizedKey, { time: Date.now() });
    return true; // 新
  }

  /** 去重 Map 当前大小（测试用） */
  dedupSize(): number {
    return this.dedup.size;
  }

  /** 定期清理过期项 + 超容量删最旧 1/4 */
  private maybePrune(): void {
    this.callCount++;
    if (this.callCount % PRUNE_EVERY !== 0) return;

    const now = Date.now();
    // 清过期
    for (const [key, entry] of this.dedup) {
      if (now - entry.time > HASH_TTL_MS) {
        this.dedup.delete(key);
      }
    }
    // 超容量：删最旧 1/4
    if (this.dedup.size > MAX_HASHES) {
      const sorted = [...this.dedup.entries()].sort((a, b) => a[1].time - b[1].time);
      const removeCount = Math.floor(this.dedup.size / 4);
      for (let i = 0; i < removeCount; i++) {
        const entry = sorted[i];
        if (entry) this.dedup.delete(entry[0]);
      }
    }
  }
}
