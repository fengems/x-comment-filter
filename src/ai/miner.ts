/**
 * 规则挖掘编排器：把云客户端的 MiningResult 转成 CandidateRule，
 * 应用置信度过滤、与现有规则去重、处理负反馈。
 *
 * 这是"用户确认闭环"前的最后一道处理，决定哪些候选规则值得让用户看到。
 * 核心原则：宁缺毋滥——置信度不够、或与现有规则重复、或太宽泛的，都不入候选。
 */
import type { MiningResult, SuggestedRule } from './backend';
import { createRule, type Rule } from '../rules/types';
import type { CandidateRule, SuspiciousSample } from '../settings/types';

/** 候选规则的最低置信度门槛（低于此值丢弃） */
export const MIN_CONFIDENCE = 0.6;

/** 已生效规则的 value 集合（用于去重，避免挖掘出已有规则） */
export type ExistingRuleIndex = Set<string>;

export interface ConvertOptions {
  /** 最低置信度（默认 MIN_CONFIDENCE） */
  minConfidence?: number;
  /** 现有规则索引，命中则跳过 */
  existing?: ExistingRuleIndex;
}

/**
 * 把一条 LLM 建议规则转成 Rule（不含 candidate 包装）。
 * 做合法性校验：正则非法则丢弃。
 */
export function suggestedToRule(s: SuggestedRule): Rule | null {
  if (!s.value || !s.value.trim()) return null;
  // 正则规则：校验语法合法
  if (s.type === 'regex') {
    try {
      // eslint-disable-next-line no-new
      new RegExp(s.value, 'i');
    } catch {
      return null;
    }
  }
  return createRule({
    type: s.type,
    value: s.value,
    match: s.match ?? 'wordBoundary',
    scope: 'comment', // 挖掘出的规则默认作用于评论区
    source: 'ai-mined',
    enabled: false, // 候选阶段不生效，采纳后才置 true
    category: s.category ?? 'custom',
  });
}

/**
 * 把 MiningResult 转成候选规则列表。
 * 应用：置信度过滤、现有规则去重、语法校验。
 */
export function toCandidates(
  result: MiningResult,
  samples: SuspiciousSample[],
  opts: ConvertOptions = {},
): CandidateRule[] {
  const minConf = opts.minConfidence ?? MIN_CONFIDENCE;
  const existing = opts.existing ?? new Set<string>();

  // 置信度不够：不产生任何候选
  if (result.confidence < minConf) return [];
  // LLM 判定不是垃圾：不加候选（调用方应据此加负反馈）
  if (result.isNotSpam) return [];
  // 不是新模式：不产生候选
  if (!result.isNewPattern) return [];

  const candidates: CandidateRule[] = [];
  const seen = new Set<string>();

  for (const s of result.suggestedRules) {
    const rule = suggestedToRule(s);
    if (!rule) continue;
    // 太短的关键词（单字/单字母）容易误伤，跳过
    if (rule.type === 'keyword' && [...rule.value].length < 2) continue;
    // 与现有规则重复
    if (existing.has(rule.value)) continue;
    // 本次挖掘内部去重
    if (seen.has(rule.value)) continue;
    seen.add(rule.value);

    candidates.push({
      rule,
      confidence: result.confidence,
      reason: result.summary || (s.example ? `匹配示例：${s.example}` : 'AI 挖掘'),
      evidenceCount: samples.length,
      examples: samples.slice(0, 3).map((x) => x.text.slice(0, 100)),
      createdAt: Date.now(),
      status: 'pending',
    });
  }

  return candidates;
}

/**
 * 从可疑样本池中取一批未送检的样本。
 * 过滤掉已在负反馈列表中的、以及太短的。
 */
export function pickBatch(
  pool: SuspiciousSample[],
  negatives: string[],
  batchSize: number,
): SuspiciousSample[] {
  const negSet = new Set(negatives);
  const candidates = pool
    .filter((s) => !negSet.has(s.fingerprint))
    .filter((s) => s.text.trim().length >= 2)
    // 按 suspicion 降序，优先送可疑度高的
    .sort((a, b) => b.suspicion - a.suspicion);
  return candidates.slice(0, batchSize);
}

/**
 * 计算本次挖掘应标记为"已处理"的指纹。
 * 无论是否产生候选，被送检的这批样本都应从池中移除（避免重复送检）。
 */
export function processedFingerprints(batch: SuspiciousSample[]): string[] {
  return batch.map((s) => s.fingerprint);
}
