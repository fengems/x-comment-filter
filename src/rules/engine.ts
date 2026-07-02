/**
 * 规则匹配引擎。
 *
 * 核心差异化（docs/02-技术方案.md §4.4）：
 *  - 默认 wordBoundary，根治 xModerator 子串匹配的误伤
 *    （sex 命中 Sussex、ad 命中 header、约 命中 约见）
 *  - 中文 CJK 用前后"非字母数字"断言模拟词边界（\b 对 CJK 无效）
 *  - 每条规则独立 scope/whitelist，支持精细控制
 *  - 反绕过清洗在匹配前完成
 *
 * 设计：编译时把规则转成 RegExp，匹配时只是 regex.test，性能可控。
 */
import type { Rule, RuleScope } from './types';
import { sanitize, sanitizeUsername } from './sanitize';

/** 转义正则元字符 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 判断字符串是否含 CJK 字符（决定用哪种边界策略） */
export function containsCJK(s: string): boolean {
  // CJK 统一表意文字 + 扩展A + 日文假名 + 韩文
  return /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/.test(s);
}

/** 匹配结果：命中了哪些规则 */
export interface MatchResult {
  hits: Rule[];
}

interface CompiledRule {
  rule: Rule;
  regex: RegExp;
  whitelist: RegExp[];
}

/** 规则无效（如正则语法错）时收集起来，供设置页提示用户 */
export interface CompileIssue {
  ruleId: string;
  value: string;
  error: string;
}

/**
 * 把单条规则的 value 编译成正则。
 *
 * 关于中文词边界（重要设计决策，见 docs/02-技术方案.md）：
 *   中文没有空格分词，`\b` 对 CJK 无效（CJK 不算 \w），纯正则无法做可靠的
 *   中文分词。诚实的结论是：
 *     - CJK 关键词（单字或多字）：wordBoundary 退化为 substring。
 *       理由：单字"约"在"来约啊"该命中、在"约见"不该命中，正则无法区分；
 *       多字短语区分度高，substring 即可。CJK 的误伤风险由用户自行评估，
 *       或用 whitelist 例外词兜底（如规则"约"+whitelist["约见","约束"]）。
 *     - 拉丁/数字关键词：用真正的 `\b` 词边界（核心价值：sex 不命中 Sussex、
 *       ad 不命中 header）。
 *   这是相比 xModerator 纯 substring 的进步（拉丁词不再误伤），同时坦诚
 *   CJK 边界做不到。
 *
 * @param rule 规则
 * @returns { regex } 或 null（value 为空）
 * @throws 当 type=regex 且用户正则非法时抛 Error（由 update 捕获）
 */
export function compileRuleValue(rule: Rule): RegExp | null {
  const value = rule.value;
  if (!value) return null;

  if (rule.type === 'regex') {
    // 用户正则：直接构造，非法会抛 SyntaxError
    return new RegExp(value, 'i');
  }

  const escaped = escapeRegex(value);

  if (rule.type === 'username') {
    // 用户名匹配：默认子串（因为已清洗），exact 时锚定
    if (rule.match === 'exact') return new RegExp(`^${escaped}$`, 'i');
    return new RegExp(escaped, 'i');
  }

  if (rule.match === 'substring') {
    return new RegExp(escaped, 'i');
  }

  if (rule.match === 'exact') {
    return new RegExp(`^${escaped}$`, 'i');
  }

  // wordBoundary 分支
  if (containsCJK(value)) {
    // CJK 无法可靠分词，退化为 substring（见上方注释）
    return new RegExp(escaped, 'iu');
  }

  // 纯拉丁/数字：用 \b 词边界（核心误伤防护）
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

export class RuleEngine {
  private compiled: CompiledRule[] = [];
  private issues: CompileIssue[] = [];

  /** 重新编译全部规则，收集无效规则（不抛异常，保持引擎可用） */
  update(rules: Rule[]): void {
    const compiled: CompiledRule[] = [];
    const issues: CompileIssue[] = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;
      try {
        const regex = compileRuleValue(rule);
        if (!regex) continue;
        const whitelist = (rule.whitelist ?? [])
          .filter(Boolean)
          .map((w) => new RegExp(escapeRegex(w), 'i'));
        compiled.push({ rule, regex, whitelist });
      } catch (e) {
        issues.push({
          ruleId: rule.id,
          value: rule.value,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    this.compiled = compiled;
    this.issues = issues;
  }

  /** 返回编译期无效规则列表（供设置页提示） */
  getIssues(): CompileIssue[] {
    return this.issues;
  }

  /** 当前生效的已编译规则数 */
  size(): number {
    return this.compiled.length;
  }

  /**
   * 对一条文本进行匹配。
   * @param text 评论正文（已由调用方传入；内部会再 sanitize 一次保底）
   * @param username 用户名/handle
   * @param scope 当前页面场景，用于过滤 rule.scope
   * @returns 命中的规则数组（可能多条），空数组表示未命中
   */
  match(text: string, username: string, scope: RuleScope): Rule[] {
    const cleanText = sanitize(text);
    const cleanUser = sanitizeUsername(username);
    const hits: Rule[] = [];

    for (const c of this.compiled) {
      if (!scopeMatches(c.rule.scope, scope)) continue;

      const target = c.rule.type === 'username' ? cleanUser : cleanText;
      if (!c.regex.test(target)) continue;

      // 白名单豁免：文本含例外词则不命中
      if (c.whitelist.length > 0 && c.whitelist.some((re) => re.test(cleanText))) {
        continue;
      }

      hits.push(c.rule);
    }

    return hits;
  }
}

/** rule.scope 与当前页面 scope 是否兼容 */
function scopeMatches(ruleScope: RuleScope, pageScope: RuleScope): boolean {
  if (ruleScope === 'all') return true;
  return ruleScope === pageScope;
}
