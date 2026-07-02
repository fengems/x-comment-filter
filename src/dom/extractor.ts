/**
 * DOM 提取：从 X 的推文节点中提取文本、用户名、handle 等。
 *
 * 抗改版策略（docs/02-技术方案.md §4.2、§七）：
 *  - 优先用 data-testid（X 测试锚点，比随机 className 稳定）
 *  - 多 selector 兜底链（主锚点失效时降级）
 *  - 把 <img alt>（emoji）也算进文本，对抗图片型垃圾
 */

/** 滚动列表项容器（隐藏整条用这个，最稳定） */
export const TWEET_CELL = '[data-testid="cellInnerDiv"]';

/** 推文根节点候选（按优先级，逐个兜底） */
export const TWEET_ROOTS = [
  '[data-testid="tweet"]',
  'article[data-testid="tweet"]',
  'article',
  '[role="article"]',
];

/** 正文文本候选锚点（data-testid=tweetText 当前最稳） */
export const TEXT_SELECTORS = [
  '[data-testid="tweetText"]',
  'div[dir="auto"] [data-testid="tweetText"]',
  '[lang] [data-testid="tweetText"]',
  'div[lang]',
  'span[dir="auto"]',
];

/** 推文头用户名区 */
const USERNAME_AREA = '[data-testid="User-Name"]';

/** 提取结果 */
export interface TweetData {
  cell: HTMLElement;
  root: HTMLElement;
  text: string;
  /** 显示名（昵称） */
  username: string;
  /** @handle，无 @ */
  handle: string;
  hasMedia: boolean;
  isPromoted: boolean;
}

/**
 * 从一个 cellInnerDiv（或其内层）提取推文数据。
 * @returns 提取失败（无文本且无 handle）返回 null
 */
export function extractTweet(cell: HTMLElement): TweetData | null {
  // 找推文根
  let root: HTMLElement | null = null;
  for (const sel of TWEET_ROOTS) {
    const found = cell.querySelector(sel);
    if (found) {
      root = found as HTMLElement;
      break;
    }
  }
  // cell 自身可能就是根（fallback）
  root = root ?? cell;

  // 正文只从正文锚点提取，避免把用户名区/时间等也算进文本
  const text = extractBodyText(root);
  const { username, handle } = extractIdentity(cell, root);

  if (!text && !handle) return null;

  return {
    cell,
    root,
    text,
    username,
    handle,
    hasMedia: !!cell.querySelector(
      '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], video',
    ),
    isPromoted: !!cell.closest('[data-testid="placementTracking"]'),
  };
}

/**
 * 递归提取节点文本，把 <img alt>（emoji）也纳入。
 * 对抗图片型垃圾评论（emoji 拼成的广告）。
 *
 * 这是通用文本提取，作用于"确定的正文容器"上，不要直接传整个推文节点
 * （否则会把用户名区也提取出来）。推文正文提取请用 extractBodyText。
 */
export function extractText(node: Element): string {
  let text = '';
  const walk = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      text += n.textContent ?? '';
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    // emoji 在 X 里是 <img alt="🍑">，把 alt 当文本
    if (el.tagName === 'IMG') {
      const alt = (el as HTMLImageElement).alt;
      if (alt) {
        text += alt;
        return;
      }
    }
    el.childNodes.forEach(walk);
  };
  walk(node);
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 从推文根节点提取正文：按 TEXT_SELECTORS 兜底链找正文容器，
 * 找到后用 extractText 提取（含 emoji）；都找不到才退化用 root 全文。
 */
export function extractBodyText(root: Element): string {
  for (const sel of TEXT_SELECTORS) {
    const body = root.querySelector(sel);
    if (body) return extractText(body);
  }
  // 全部锚点失效：退化用 root，但剥掉用户名区减少污染
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll('[data-testid="User-Name"]').forEach((n) => n.remove());
  return extractText(clone);
}

/** 提取显示名和 @handle */
function extractIdentity(cell: HTMLElement, root: HTMLElement): { username: string; handle: string } {
  // 优先在用户名区找
  const area = (cell.querySelector(USERNAME_AREA) ?? root.querySelector(USERNAME_AREA)) as HTMLElement | null;
  const scope = area ?? root;

  // handle：找 a[href^="/"]，href 形如 /<handle>，剥掉后续路径
  let handle = '';
  const links = scope.querySelectorAll('a[href^="/"]');
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    // 取第一段路径，校验像 handle（字母数字下划线 1-15）
    const seg = href.split('/')[1] ?? '';
    if (/^[A-Za-z0-9_]{1,15}$/.test(seg)) {
      handle = seg;
      break;
    }
  }

  // 显示名：用户名区里第一个有文本的 span/a（非 handle 链接）
  let username = '';
  const candidates = scope.querySelectorAll('span, a');
  for (const c of candidates) {
    const t = (c.textContent ?? '').trim();
    if (!t) continue;
    // 跳过 handle（@xxx）和时间
    if (t.startsWith('@')) continue;
    if (/^\d+[smhd]$/.test(t)) continue; // 相对时间
    username = t;
    break;
  }

  return { username, handle };
}

/**
 * 收集新增/复用节点中的 cellInnerDiv。
 * 用于 ObserverManager 批量收集待处理节点。
 */
export function collectCells(node: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (node.getAttribute('data-testid') === 'cellInnerDiv') {
    out.push(node);
  } else {
    node.querySelectorAll<HTMLElement>(TWEET_CELL).forEach((c) => out.push(c));
  }
  return out;
}
