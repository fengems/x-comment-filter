import { describe, it, expect, beforeEach } from 'vitest';
import { FilterPipeline, type PipelineCallbacks } from './pipeline';
import type { Settings } from './settings/types';
import { createRule } from './rules/types';
import type { Rule } from './rules/types';

/** 模拟 X 推文 DOM */
function makeCell(opts: {
  text?: string;
  handle?: string;
  username?: string;
  emoji?: string;
  mainTweetId?: string; // 设为当前页 status id 模拟主推文
}): HTMLElement {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');

  const nameArea = document.createElement('div');
  nameArea.setAttribute('data-testid', 'User-Name');
  const nameSpan = document.createElement('span');
  nameSpan.textContent = opts.username ?? '用户';
  const handleLink = document.createElement('a');
  handleLink.setAttribute('href', `/${opts.handle ?? 'user'}`);
  handleLink.textContent = `@${opts.handle ?? 'user'}`;

  // 主推文：time 父级 a 含 status id
  if (opts.mainTweetId) {
    const timeA = document.createElement('a');
    timeA.setAttribute('href', `/u/status/${opts.mainTweetId}`);
    timeA.appendChild(document.createElement('time'));
    nameArea.append(nameSpan, handleLink, timeA);
  } else {
    const timeA = document.createElement('a');
    timeA.setAttribute('href', `/u/status/other`);
    timeA.appendChild(document.createElement('time'));
    nameArea.append(nameSpan, handleLink, timeA);
  }
  article.appendChild(nameArea);

  const tweetText = document.createElement('div');
  tweetText.setAttribute('data-testid', 'tweetText');
  tweetText.setAttribute('lang', 'zh');
  if (opts.text) tweetText.textContent = opts.text;
  if (opts.emoji) {
    const img = document.createElement('img');
    img.setAttribute('alt', opts.emoji);
    tweetText.appendChild(img);
  }
  article.appendChild(tweetText);
  cell.appendChild(article);
  return cell;
}

function makePipeline(
  pathname: string,
  rules: Rule[],
  settingsOver: Partial<Settings> = {},
  callbacks: PipelineCallbacks = {},
): FilterPipeline {
  const settings: Settings = {
    enabled: true,
    scope: 'comments',
    action: 'fold',
    checkUsername: true,
    blockSpecialChars: true,
    blockEmojiShort: false,
    whitelistUsers: [],
    dryRun: false,
    debug: false,
    ...settingsOver,
  };
  const pipeline = new FilterPipeline(settings, callbacks, {
    getUrl: () => `https://x.com${pathname}`,
    getPathname: () => pathname,
  });
  pipeline.updateRules(rules);
  return pipeline;
}

describe('FilterPipeline', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('评论区基本过滤', () => {
    it('评论区命中关键词 → 折叠', () => {
      const cell = makeCell({ text: '加vx：abc123', handle: 'bot' });
      const pipeline = makePipeline(
        '/someone/status/999',
        [createRule({ id: 'r1', value: 'vx', category: 'spam', match: 'substring' })],
      );
      const out = pipeline.processCell(cell);
      expect(out.blocked).toBe(true);
      expect(out.ruleIds).toEqual(['r1']);
      // 折叠动作生效
      expect(cell.hasAttribute('data-tfc-folded')).toBe(true);
    });

    it('评论区未命中 → 不折叠', () => {
      const cell = makeCell({ text: '这篇文章写得真好', handle: 'good' });
      const pipeline = makePipeline(
        '/someone/status/999',
        [createRule({ value: 'vx', match: 'substring' })],
      );
      const out = pipeline.processCell(cell);
      expect(out.blocked).toBe(false);
      expect(cell.hasAttribute('data-tfc-folded')).toBe(false);
    });
  });

  describe('主推文豁免', () => {
    it('主推文即使命中也不处理', () => {
      // 当前页 status=999，cell 的时间 href 也是 999 → 主推文
      const cell = makeCell({ text: '加vx：abc', handle: 'author', mainTweetId: '999' });
      const pipeline = makePipeline(
        '/someone/status/999',
        [createRule({ value: 'vx', match: 'substring' })],
      );
      const out = pipeline.processCell(cell);
      expect(out.blocked).toBe(false);
      expect(cell.hasAttribute('data-tfc-folded')).toBe(false);
    });
  });

  describe('scope 过滤', () => {
    it('comments 模式：feed 页不处理', () => {
      const cell = makeCell({ text: '加vx：abc', handle: 'bot' });
      const pipeline = makePipeline(
        '/home', // feed 页
        [createRule({ value: 'vx', match: 'substring' })],
        { scope: 'comments' },
      );
      expect(pipeline.processCell(cell).blocked).toBe(false);
    });

    it('all 模式：feed 页也处理', () => {
      const cell = makeCell({ text: '加vx：abc', handle: 'bot' });
      const pipeline = makePipeline(
        '/home',
        [createRule({ value: 'vx', match: 'substring' })],
        { scope: 'all' },
      );
      expect(pipeline.processCell(cell).blocked).toBe(true);
    });
  });

  describe('白名单用户', () => {
    it('白名单 handle 永不处理', () => {
      const cell = makeCell({ text: '加vx：abc', handle: 'vip' });
      const pipeline = makePipeline(
        '/u/status/1',
        [createRule({ value: 'vx', match: 'substring' })],
        { whitelistUsers: ['vip'] },
      );
      expect(pipeline.processCell(cell).blocked).toBe(false);
    });
  });

  describe('缓存', () => {
    it('重复处理同一 cell 第二次跳过（不重复折叠，但已折叠状态保持）', () => {
      const cell = makeCell({ text: '加vx：abc', handle: 'bot' });
      const pipeline = makePipeline(
        '/u/status/1',
        [createRule({ value: 'vx', match: 'substring' })],
      );
      const o1 = pipeline.processCell(cell);
      const o2 = pipeline.processCell(cell);
      expect(o1.blocked).toBe(true);
      // 第二次因缓存命中，outcome.blocked=false（但 DOM 折叠状态保留）
      expect(o2.blocked).toBe(false);
      expect(cell.hasAttribute('data-tfc-folded')).toBe(true);
    });

    it('规则更新后强制重新判定', () => {
      const cell = makeCell({ text: '加vx：abc', handle: 'bot' });
      const pipeline = makePipeline('/u/status/1', []);
      expect(pipeline.processCell(cell).blocked).toBe(false);
      // 加规则
      pipeline.updateRules([createRule({ value: 'vx', match: 'substring' })]);
      // 先还原（模拟重新判定）
      pipeline.processCell(cell); // 缓存已被 bump 失效，重新判定
      // 但 cell 已折叠/未折叠状态需重置——这里再处理一次
      expect(cell.hasAttribute('data-tfc-folded')).toBe(true);
    });
  });

  describe('dryRun', () => {
    it('dryRun 只记录不实际折叠', () => {
      const cell = makeCell({ text: '加vx：abc', handle: 'bot' });
      const pipeline = makePipeline(
        '/u/status/1',
        [createRule({ value: 'vx', match: 'substring' })],
        { dryRun: true },
      );
      const out = pipeline.processCell(cell);
      expect(out.blocked).toBe(true);
      expect(cell.hasAttribute('data-tfc-folded')).toBe(false); // 未实际折叠
    });
  });

  describe('回调', () => {
    it('命中触发 onBlocked', () => {
      const cell = makeCell({ text: '加vx：abc', handle: 'bot', username: '机器人' });
      const blocked: string[] = [];
      const pipeline = makePipeline(
        '/u/status/1',
        [createRule({ value: 'vx', match: 'substring', category: 'spam' })],
        {},
        { onBlocked: (item) => blocked.push(item.handle) },
      );
      pipeline.processCell(cell);
      expect(blocked).toEqual(['bot']);
    });

    it('未命中但可疑触发 onSuspicious', () => {
      // 含联系方式引导但没规则
      const cell = makeCell({ text: '加wx：12345678 看主页', handle: 'newbot' });
      const suspicious: number[] = [];
      const pipeline = makePipeline(
        '/u/status/1',
        [],
        {},
        { onSuspicious: (d) => suspicious.push(d.suspicion) },
      );
      pipeline.processCell(cell);
      expect(suspicious.length).toBeGreaterThan(0);
      expect(suspicious[0]).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('动作类型', () => {
    it('hide 动作直接隐藏', () => {
      const cell = makeCell({ text: '加vx：abc', handle: 'bot' });
      const pipeline = makePipeline(
        '/u/status/1',
        [createRule({ value: 'vx', match: 'substring' })],
        { action: 'hide' },
      );
      pipeline.processCell(cell);
      expect(cell.style.display).toBe('none');
    });

    it('blur 动作模糊', () => {
      const cell = makeCell({ text: '加vx：abc', handle: 'bot' });
      const pipeline = makePipeline(
        '/u/status/1',
        [createRule({ value: 'vx', match: 'substring' })],
        { action: 'blur' },
      );
      pipeline.processCell(cell);
      expect(cell.style.filter).toContain('blur');
    });
  });

  describe('扩展禁用', () => {
    it('enabled=false 时 processBatch 不处理', () => {
      const cell = makeCell({ text: '加vx：abc', handle: 'bot' });
      const pipeline = makePipeline(
        '/u/status/1',
        [createRule({ value: 'vx', match: 'substring' })],
        { enabled: false },
      );
      pipeline.processBatch([cell]);
      expect(cell.hasAttribute('data-tfc-folded')).toBe(false);
    });
  });
});
