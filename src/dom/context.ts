/**
 * 页面场景与主推文判定。
 *
 * 核心语义（docs/02-技术方案.md §4.3）：
 *  - 只过滤"评论"，不误伤主推文本身。
 *  - 靠 URL 里的 status id 判断当前是否在推文详情页（评论区场景）。
 *  - 靠推文内 <time> 父级 <a> 的 href 里的 status id 与 URL 比对，
 *    判断这条是不是"主推文本身"（永远放行）。
 *
 * 这些纯函数不依赖真实 DOM，把 location 和节点作为参数传入，便于单测。
 */

/** 页面场景类型 */
export type PageContext = 'feed' | 'status' | 'profile' | 'other';

/**
 * X 的非用户、单段保留路径：这些虽然形如 /<seg> 但不是个人主页。
 * 判断 profile 时要先把它们排除，否则 /explore /messages 等会被误判。
 * （随 X 改版可能变化，集中在这一处维护。）
 */
const RESERVED_PATHS = new Set([
  'home', 'explore', 'search', 'messages', 'notifications', 'compose',
  'settings', 'login', 'signup', 'logout', 'i', 'tos', 'privacy',
  'bookmarks', 'communities', 'grok', 'lists', 'connect',
]);

/** 判断单段路径是否是个人主页（非保留词、且像 handle） */
function isProfilePath(pathname: string): boolean {
  // /<handle> 或 /<handle>/ 或 /<handle>/(with_replies|likes|media)
  const m = pathname.match(/^\/([^/]+)(?:\/(with_replies|likes|media|with_replies\/?)|\/?)?$/i);
  if (!m) return false;
  const seg = m[1]!;
  if (RESERVED_PATHS.has(seg.toLowerCase())) return false;
  // handle 规则：字母数字下划线，1-15 字符
  if (!/^[A-Za-z0-9_]{1,15}$/.test(seg)) return false;
  return true;
}

/** 从 URL pathname 判断页面场景。纯函数，便于测试。 */
export function getPageContext(pathname: string): PageContext {
  // 推文详情页：/<user>/status/<id>
  if (/\/status\/\d+/i.test(pathname)) return 'status';
  // 首页 / 探索 / 搜索 等 feed 场景（先于 profile 判定，避免 /home 被当 profile）
  if (pathname === '/' || pathname === '/home' || /^\/search\b/.test(pathname)) {
    return 'feed';
  }
  // 个人主页
  if (isProfilePath(pathname)) return 'profile';
  return 'other';
}

/** 从 URL pathname 提取推文 status id，不是详情页返回 null */
export function extractStatusId(pathname: string): string | null {
  const m = pathname.match(/\/status\/(\d+)/i);
  return m?.[1] ?? null;
}

/**
 * 判断某条推文节点是否是"主推文本身"（在评论区里需要永远放行）。
 *
 * 实现（x-comment-blocker 的精华）：在推文节点里找 <time>，其父级 <a> 的
 * href 含 /status/<id>，若该 id 与当前页面 status id 相同，则它是主推文。
 * 这比靠 DOM 位置/层级判断鲁棒得多（X 改版不会改这个数据）。
 *
 * @param cell 推文节点
 * @param pageStatusId 当前页面的 status id（extractStatusId 的结果）
 */
export function isMainTweet(cell: HTMLElement, pageStatusId: string | null): boolean {
  if (!pageStatusId) return false; // 不在详情页，无所谓主推文
  const timeNodes = cell.querySelectorAll('time');
  for (const timeEl of timeNodes) {
    const link = timeEl.closest('a');
    const href = link?.getAttribute('href') ?? '';
    const m = href.match(/\/status\/(\d+)/i);
    if (m && m[1] === pageStatusId) return true;
  }
  return false;
}

/**
 * 综合判断：给定节点 + 当前页面 + 用户设置，是否应该对它执行过滤。
 *
 * @param ctx 当前页面场景
 * @param isMain 这条是否主推文
 * @param filterScope 用户设置的作用范围（comments 只评论 / all 全站）
 */
export function shouldProcess(
  ctx: PageContext,
  isMain: boolean,
  filterScope: 'comments' | 'all',
): boolean {
  // 主推文永远放行
  if (isMain) return false;
  // 只过滤评论模式：仅 status 页（评论区）处理
  if (filterScope === 'comments') {
    return ctx === 'status';
  }
  // all 模式：feed / status / profile 都处理（主推文已在上面放行）
  return ctx === 'feed' || ctx === 'status' || ctx === 'profile';
}
