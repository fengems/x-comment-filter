/**
 * 关键词词库解析：把多行文本词库转成 Rule 对象数组。
 *
 * 词库格式（参考 x-comment-blocker 的 keywords.txt）：
 *   每行一个关键词，# 开头为注释，空行忽略。
 *   支持行内标注：`关键词 #category=porn` 来指定类别。
 *
 * 纯函数，便于单测。
 */
import type { Rule, RuleSource, SpamCategory } from './types';
import { createRule } from './types';

/** 行内标注解析：`关键词 #category=porn` → { value, category } */
const ANNOTATION_RE = /\s+#(\w+)=(\w+)\s*$/;

export interface ParsedKeyword {
  value: string;
  category?: SpamCategory;
}

/** 解析单行（去除注释、提取标注） */
export function parseLine(line: string): ParsedKeyword | null {
  // 去首尾空白
  let l = line.trim();
  if (!l) return null;
  // 整行注释
  if (l.startsWith('#')) return null;

  let category: SpamCategory | undefined;
  const m = l.match(ANNOTATION_RE);
  if (m) {
    const key = m[1];
    const val = m[2] as SpamCategory;
    if (key === 'category') {
      category = val;
    }
    l = l.slice(0, m.index).trim();
  }
  if (!l) return null;
  return { value: l, category };
}

/**
 * 把多行词库文本解析成 Rule 数组。
 * @param text 词库文本
 * @param source 规则来源（builtin/cloud）
 * @param scope 默认作用域
 */
export function parseKeywords(
  text: string,
  source: RuleSource = 'builtin',
  scope: Rule['scope'] = 'all',
): Rule[] {
  const rules: Rule[] = [];
  const seen = new Set<string>(); // 去重
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const key = `${parsed.value}|${parsed.category ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(
      createRule({
        type: 'keyword',
        value: parsed.value,
        match: 'wordBoundary',
        scope,
        source,
        category: parsed.category,
      }),
    );
  }
  return rules;
}
