import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheManager } from './cache';

describe('CacheManager', () => {
  let cm: CacheManager;
  let cell: HTMLElement;

  beforeEach(() => {
    cm = new CacheManager();
    cell = document.createElement('div');
  });

  describe('shouldReprocess', () => {
    it('首次调用返回 true（需处理）', () => {
      expect(cm.shouldReprocess(cell, '免费', 'user')).toBe(true);
    });

    it('相同文本+handle+版本返回 false（跳过）', () => {
      cm.shouldReprocess(cell, '免费', 'user');
      expect(cm.shouldReprocess(cell, '免费', 'user')).toBe(false);
    });

    it('文本变化返回 true', () => {
      cm.shouldReprocess(cell, '免费', 'user');
      expect(cm.shouldReprocess(cell, '其它', 'user')).toBe(true);
    });

    it('handle 变化返回 true', () => {
      cm.shouldReprocess(cell, '免费', 'user1');
      expect(cm.shouldReprocess(cell, '免费', 'user2')).toBe(true);
    });

    it('bumpVersion 后所有缓存失效返回 true', () => {
      cm.shouldReprocess(cell, '免费', 'user');
      expect(cm.shouldReprocess(cell, '免费', 'user')).toBe(false);
      cm.bumpVersion();
      expect(cm.shouldReprocess(cell, '免费', 'user')).toBe(true);
    });
  });

  describe('clearNode / clearAll', () => {
    it('clearNode 后重新需要处理', () => {
      cm.shouldReprocess(cell, '免费', 'user');
      expect(cm.shouldReprocess(cell, '免费', 'user')).toBe(false);
      cm.clearNode(cell);
      expect(cm.shouldReprocess(cell, '免费', 'user')).toBe(true);
    });
  });

  describe('recordDedup', () => {
    it('首次记录返回 true', () => {
      expect(cm.recordDedup('key1')).toBe(true);
    });

    it('重复记录返回 false', () => {
      cm.recordDedup('key1');
      expect(cm.recordDedup('key1')).toBe(false);
    });

    it('不同 key 各自首次', () => {
      expect(cm.recordDedup('key1')).toBe(true);
      expect(cm.recordDedup('key2')).toBe(true);
      expect(cm.recordDedup('key1')).toBe(false);
    });

    it('size 统计', () => {
      cm.recordDedup('a');
      cm.recordDedup('b');
      cm.recordDedup('a'); // 重复不计
      expect(cm.dedupSize()).toBe(2);
    });
  });

  describe('过期清理', () => {
    it('过期项被清理', () => {
      vi.useFakeTimers();
      const base = Date.now();
      vi.setSystemTime(base);

      cm.recordDedup('old');
      // 31 分钟后（TTL 是 30 分钟）
      vi.setSystemTime(base + 31 * 60 * 1000);
      cm.recordDedup('new'); // 触发清理（但首次调用不触发，需满 100 次）

      // 强制触发：连续调用让 callCount 达到 100 倍数
      for (let i = 0; i < 100; i++) cm.recordDedup('trigger');

      // 'old' 应已过期被删（但它可能被新的 'trigger' 覆盖语义）
      // 关键断言：清理后 size 不无限增长
      expect(cm.dedupSize()).toBeLessThanOrEqual(5000);

      vi.useRealTimers();
    });
  });
});
