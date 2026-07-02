/**
 * 反绕过文本清洗。
 *
 * 垃圾评论常用各种 Unicode 技巧绕过关键词匹配：
 *  - 零宽字符插入："免\u200b费" 让 "免费" 关键词失配
 *  - 花体字/组合附加符号：用拉丁扩展字符伪装敏感词
 *  - 全角字符伪装："１２３" "ｆｒｅｅ"
 *  - 混淆标点/空格：用户名 "免.费" "免 费"
 *
 * 这些技巧来自 docs/01-调研报告.md §2.5 对 x-comment-blocker 的分析。
 * 清洗要在规则匹配之前进行，让关键词命中变得可靠。
 */

/**
 * 零宽/不可见字符：软连字符、零宽空格、双向控制符、BOM 等。
 * 来源：x-comment-blocker 的 invisibleCharsRegex
 */
export const INVISIBLE_CHARS = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

/**
 * 组合附加符号（combining marks）：花体字、变音符号叠加。
 * 垃圾信息用它在普通字母上叠加装饰伪装。
 */
export const COMBINING_MARKS = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g;

/**
 * 数学字母符号区（Mathematical Alphanumeric Symbols）：
 * 花体/哥特/双线字母等，用于伪装敏感词（如 𝕗𝕣𝕖𝕖）。
 * NFKC 归一化可把它们映射回基本拉丁字母。
 */
// 注：NFKC 通过 String.prototype.normalize 处理，这里不放正则

/** 普通空格与各类不间断空格、窄空格等，统一压成普通空格 */
export const FANCY_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * 通用文本清洗：去零宽/花体/全角归一化/压缩空白。
 * 用于评论正文、用户名等所有要过规则匹配的文本。
 */
export function sanitize(input: string): string {
  if (!input) return '';
  return input
    .replace(INVISIBLE_CHARS, '') // 去零宽字符（防 "免\u200b费"）
    .replace(COMBINING_MARKS, '') // 去组合附加符号
    .normalize('NFKC') // 全角→半角、花体字母→基本字母
    .replace(FANCY_SPACES, ' ') // 各类空格统一为普通空格
    .replace(/\s+/g, ' ') // 连续空白压缩
    .trim();
}

/**
 * 用户名/handle 专用清洗。
 * 比正文更激进：去掉分隔点/下划线/连字符/空格，
 * 防 "免.费" "免_费" "免-费" 这类用户名伪装。
 */
export function sanitizeUsername(input: string): string {
  return sanitize(input).replace(/[\s._-]+/g, '');
}
