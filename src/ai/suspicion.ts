/**
 * 可疑度评分。
 *
 * 作用（docs/03-AI集成方案.md §3.2）：决定哪些"未被规则命中"的评论值得
 * 送大模型做规则挖掘。大模型贵/慢，不能每条都送，用廉价启发式先筛可疑样本。
 *
 * 这是纯函数，输入文本+账号元信息，输出 0~1 的可疑分。阈值由用户设置。
 */

/** 账号元信息（来自 DOM 提取，部分可能拿不到） */
export interface AccountMeta {
  /** 账号注册天数（拿不到则 undefined） */
  accountAgeDays?: number;
  /** 粉丝数（拿不到则 undefined） */
  followers?: number;
  /** 是否默认头像 */
  hasDefaultAvatar?: boolean;
}

/** 联系方式引导：vx/微信/qq/telegram/line/电话号码等导流 */
const CONTACT_RE =
  /(加\s*)?(微[信念信]|v[x信]|w[x信]|q[q扣]|t[ge]|telegram|tg|line|飞机)\s*[:：]?\s*[a-z0-9_]{4,}/i;

/** 导流话术：约/私/主页/链接引导 */
const LURE_RE = /(约|私我|私聊|看主页|进主页|主页有|点[我击]链接?|主?页|找我|滴滴|私信)/i;

/** 表情与色情暗示 emoji */
const SEXY_EMOJI = /[\u{1F346}\u{1F36D}\u{1F4A6}\u{1F51D}\u{1F35F}\u{1F361}\u{1F449}]/u;

/** 重复字符（如 "啊啊啊啊啊"） */
const REPEAT_CHAR = /(.)\1{3,}/;

/** 短文本阈值 */
const SHORT_TEXT = 30;

/**
 * 计算可疑度分数（0~1，越高越可疑）。
 * 多个特征叠加，封顶 1。
 */
export function suspicionScore(text: string, meta: AccountMeta = {}): number {
  if (!text || !text.trim()) return 0;

  let score = 0;

  // 1. 联系方式引导（强信号）
  if (CONTACT_RE.test(text)) score += 0.4;

  // 2. 导流话术
  if (LURE_RE.test(text)) score += 0.3;

  // 3. 短文 + emoji（典型垃圾结构）
  const hasEmoji = SEXY_EMOJI.test(text) || /\p{Extended_Pictographic}/u.test(text);
  if (text.length < SHORT_TEXT && hasEmoji) score += 0.2;

  // 4. 重复字符
  if (REPEAT_CHAR.test(text)) score += 0.15;

  // 5. 账号特征：新号 / 低粉 / 默认头像（账号层面强信号）
  if (meta.accountAgeDays !== undefined && meta.accountAgeDays < 30) score += 0.25;
  if (meta.followers !== undefined && meta.followers < 10) score += 0.2;
  if (meta.hasDefaultAvatar) score += 0.2;

  return Math.min(score, 1);
}
