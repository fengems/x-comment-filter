import { describe, it, expect } from 'vitest';
import { extractTweet, extractText, collectCells } from './extractor';

/** 构造一个模拟 X 推文 DOM 的 cellInnerDiv */
function makeCell(opts: {
  text?: string;
  handle?: string;
  username?: string;
  emoji?: string;
  hasPhoto?: boolean;
  promoted?: boolean;
}): HTMLElement {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');

  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');

  // 用户名区
  const nameArea = document.createElement('div');
  nameArea.setAttribute('data-testid', 'User-Name');
  const nameSpan = document.createElement('span');
  nameSpan.textContent = opts.username ?? '正常用户';
  const handleLink = document.createElement('a');
  handleLink.setAttribute('href', `/${opts.handle ?? 'normal'}`);
  handleLink.textContent = `@${opts.handle ?? 'normal'}`;
  nameArea.append(nameSpan, handleLink);
  article.appendChild(nameArea);

  // 正文
  const tweetText = document.createElement('div');
  tweetText.setAttribute('data-testid', 'tweetText');
  tweetText.setAttribute('lang', 'zh');
  if (opts.text) tweetText.textContent = opts.text;
  if (opts.emoji) {
    const img = document.createElement('img');
    img.setAttribute('alt', opts.emoji);
    img.setAttribute('src', 'https://twemoji/emoji.png');
    tweetText.appendChild(img);
  }
  article.appendChild(tweetText);

  // 图片
  if (opts.hasPhoto) {
    const photo = document.createElement('img');
    photo.setAttribute('data-testid', 'tweetPhoto');
    article.appendChild(photo);
  }

  cell.appendChild(article);

  // 推广容器
  if (opts.promoted) {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-testid', 'placementTracking');
    wrap.appendChild(cell);
    return wrap; // 返回外层，里面的 cell 才是推文
  }

  return cell;
}

describe('extractText', () => {
  it('提取普通文本', () => {
    const div = document.createElement('div');
    div.innerHTML = '<span>免费</span>领取';
    // span 与文本节点直接拼接，无空白
    expect(extractText(div)).toBe('免费领取');
  });

  it('把 img alt（emoji）算进文本', () => {
    const div = document.createElement('div');
    div.innerHTML = '约<img alt="🍑">吗';
    expect(extractText(div)).toBe('约🍑吗');
  });

  it('压缩空白', () => {
    const div = document.createElement('div');
    div.innerHTML = '<div>a   </div><div>  b</div>';
    expect(extractText(div)).toBe('a b');
  });
});

describe('extractTweet', () => {
  it('提取文本和身份', () => {
    const cell = makeCell({ text: '正常评论内容', handle: 'gooduser', username: '好人' });
    const data = extractTweet(cell)!;
    expect(data).not.toBeNull();
    expect(data.text).toBe('正常评论内容');
    expect(data.handle).toBe('gooduser');
    expect(data.username).toBe('好人');
    expect(data.hasMedia).toBe(false);
    expect(data.isPromoted).toBe(false);
  });

  it('提取 emoji 图片型评论', () => {
    const cell = makeCell({ text: '约', handle: 'bot1', emoji: '🍑' });
    const data = extractTweet(cell)!;
    expect(data.text).toBe('约🍑');
  });

  it('识别含图片推文', () => {
    const cell = makeCell({ text: '看图', handle: 'u', hasPhoto: true });
    const data = extractTweet(cell)!;
    expect(data.hasMedia).toBe(true);
  });

  it('识别推广推文', () => {
    const wrap = makeCell({ text: '广告内容', handle: 'advertiser', promoted: true });
    const innerCell = wrap.querySelector('[data-testid="cellInnerDiv"]') as HTMLElement;
    const data = extractTweet(innerCell)!;
    expect(data.isPromoted).toBe(true);
  });

  it('无文本无 handle 返回 null', () => {
    const cell = document.createElement('div');
    cell.setAttribute('data-testid', 'cellInnerDiv');
    expect(extractTweet(cell)).toBeNull();
  });

  it('handle 从 href 第一段提取并校验', () => {
    const cell = makeCell({ text: 'x', handle: 'test_user123' });
    expect(extractTweet(cell)!.handle).toBe('test_user123');
  });
});

describe('collectCells', () => {
  it('节点自身是 cell 直接收集', () => {
    const cell = document.createElement('div');
    cell.setAttribute('data-testid', 'cellInnerDiv');
    expect(collectCells(cell)).toHaveLength(1);
  });

  it('从子树收集所有 cell', () => {
    const parent = document.createElement('div');
    for (let i = 0; i < 3; i++) {
      const c = document.createElement('div');
      c.setAttribute('data-testid', 'cellInnerDiv');
      parent.appendChild(c);
    }
    expect(collectCells(parent)).toHaveLength(3);
  });

  it('非 cell 且无子 cell 返回空', () => {
    const div = document.createElement('div');
    expect(collectCells(div)).toHaveLength(0);
  });
});
