import { describe, it, expect } from 'vitest';
import {
  getPageContext,
  extractStatusId,
  isMainTweet,
  shouldProcess,
} from './context';

describe('getPageContext', () => {
  it('推文详情页识别为 status', () => {
    expect(getPageContext('/elonmusk/status/123456789')).toBe('status');
    expect(getPageContext('/a/b/status/999/photo/1')).toBe('status');
  });
  it('首页/feed 识别为 feed', () => {
    expect(getPageContext('/')).toBe('feed');
    expect(getPageContext('/home')).toBe('feed');
    expect(getPageContext('/search')).toBe('feed');
    expect(getPageContext('/search?q=test')).toBe('feed');
  });
  it('个人主页识别为 profile', () => {
    expect(getPageContext('/elonmusk')).toBe('profile');
    expect(getPageContext('/elonmusk/')).toBe('profile');
    expect(getPageContext('/elonmusk/with_replies')).toBe('profile');
    expect(getPageContext('/elonmusk/likes')).toBe('profile');
    expect(getPageContext('/elonmusk/media')).toBe('profile');
  });
  it('其它页面为 other', () => {
    expect(getPageContext('/messages')).toBe('other');
    expect(getPageContext('/explore')).toBe('other');
    expect(getPageContext('/settings')).toBe('other');
  });
});

describe('extractStatusId', () => {
  it('从详情页提取 id', () => {
    expect(extractStatusId('/user/status/12345')).toBe('12345');
    expect(extractStatusId('/user/status/12345/photo/1')).toBe('12345');
  });
  it('非详情页返回 null', () => {
    expect(extractStatusId('/home')).toBeNull();
    expect(extractStatusId('/user')).toBeNull();
  });
});

describe('isMainTweet', () => {
  function makeTweet(href?: string): HTMLElement {
    const cell = document.createElement('div');
    const time = document.createElement('time');
    if (href) {
      const a = document.createElement('a');
      a.setAttribute('href', href);
      a.appendChild(time);
      cell.appendChild(a);
    } else {
      cell.appendChild(time);
    }
    return cell;
  }

  it('time 父级 a 的 href id 与页面 id 相同 → 主推文', () => {
    const cell = makeTweet('/user/status/999');
    expect(isMainTweet(cell, '999')).toBe(true);
  });
  it('id 不同 → 非主推文（是回复）', () => {
    const cell = makeTweet('/user/status/888');
    expect(isMainTweet(cell, '999')).toBe(false);
  });
  it('页面不在详情页（pageStatusId=null）→ false', () => {
    const cell = makeTweet('/user/status/999');
    expect(isMainTweet(cell, null)).toBe(false);
  });
  it('无 time 节点 → false', () => {
    const cell = document.createElement('div');
    expect(isMainTweet(cell, '999')).toBe(false);
  });
  it('多个 time，任一匹配即为主推文', () => {
    const cell = document.createElement('div');
    const a1 = document.createElement('a');
    a1.setAttribute('href', '/user/status/111');
    a1.appendChild(document.createElement('time'));
    const a2 = document.createElement('a');
    a2.setAttribute('href', '/user/status/999');
    a2.appendChild(document.createElement('time'));
    cell.append(a1, a2);
    expect(isMainTweet(cell, '999')).toBe(true);
  });
});

describe('shouldProcess', () => {
  it('主推文永远不处理', () => {
    expect(shouldProcess('status', true, 'comments')).toBe(false);
    expect(shouldProcess('status', true, 'all')).toBe(false);
  });
  it('comments 模式：仅 status 页且非主推文才处理', () => {
    expect(shouldProcess('status', false, 'comments')).toBe(true);
    expect(shouldProcess('feed', false, 'comments')).toBe(false);
    expect(shouldProcess('profile', false, 'comments')).toBe(false);
    expect(shouldProcess('other', false, 'comments')).toBe(false);
  });
  it('all 模式：feed/status/profile 的非主推文都处理', () => {
    expect(shouldProcess('status', false, 'all')).toBe(true);
    expect(shouldProcess('feed', false, 'all')).toBe(true);
    expect(shouldProcess('profile', false, 'all')).toBe(true);
    expect(shouldProcess('other', false, 'all')).toBe(false);
  });
});
