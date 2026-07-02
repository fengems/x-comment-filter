/**
 * 云端词库同步（GitHub Contents API + ETag 增量）。
 *
 * 设计（docs/02-技术方案.md §4.7，x-comment-blocker 的聪明方案）：
 *  - 词库存 GitHub 仓库 keywords.txt，扩展定时拉取
 *  - 用 ETag 做 If-None-Match，304 跳过，省 GitHub API 配额
 *  - 限流（403/429）标记错误，不崩溃
 *  - 零后端：作者改 keywords.txt 推 GitHub，用户自动更新
 *
 * fetch 抽象成可注入，便于单测。
 */
import { parseKeywords } from './rules/keywords';
import type { Rule } from './rules/types';

/** 同步结果 */
export interface SyncResult {
  /** 是否有更新（true=拉到新词库，false=304 未变或出错） */
  updated: boolean;
  /** 新规则数组（updated=true 时有效） */
  rules?: Rule[];
  /** 新 ETag */
  etag?: string;
  /** 错误信息（限流/网络错误等） */
  error?: string;
}

/** fetch 接口（注入用） */
export type Fetcher = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  status: number;
  text: () => Promise<string>;
  headers: { get(name: string): string | null };
}>;

/** 默认词库 URL（可被配置覆盖）。指向仓库根 keywords.txt */
export const DEFAULT_KEYWORDS_URL =
  'https://api.github.com/repos/fengems/x-comment-filter/contents/keywords.txt';

/**
 * 执行一次同步。
 * @param fetcher fetch 实现（单测注入假实现）
 * @param url 词库 URL
 * @param prevEtag 上次的 ETag（用于 If-None-Match）
 */
export async function syncCloudKeywords(
  fetcher: Fetcher,
  url: string,
  prevEtag: string,
): Promise<SyncResult> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3.raw',
  };
  if (prevEtag) headers['If-None-Match'] = prevEtag;

  let res;
  try {
    res = await fetcher(url, { headers });
  } catch (e) {
    return { updated: false, error: `网络错误：${e instanceof Error ? e.message : String(e)}` };
  }

  // 304：未变
  if (res.status === 304) {
    return { updated: false, etag: prevEtag };
  }

  // 限流
  if (res.status === 403 || res.status === 429) {
    return { updated: false, error: 'GitHub API 限流，稍后重试' };
  }

  if (res.status !== 200) {
    return { updated: false, error: `HTTP ${res.status}` };
  }

  const text = await res.text();
  const etag = res.headers.get('ETag') ?? prevEtag;
  const rules = parseKeywords(text, 'cloud');

  return { updated: true, rules, etag };
}
