import { describe, it, expect } from 'vitest';
import {
  suggestedToRule,
  toCandidates,
  pickBatch,
  processedFingerprints,
  MIN_CONFIDENCE,
  type ConvertOptions,
} from './miner';
import type { MiningResult, SuggestedRule } from './cloud-client';
import type { SuspiciousSample } from '../settings/types';

function sample(fp: string, text = 'x', suspicion = 0.7): SuspiciousSample {
  return { fingerprint: fp, text, handle: 'h', suspicion, time: 1 };
}

function miningResult(over: Partial<MiningResult> = {}): MiningResult {
  return {
    isNewPattern: true,
    confidence: 0.8,
    summary: '色情引流',
    suggestedRules: [],
    ...over,
  };
}

describe('suggestedToRule', () => {
  it('keyword 转换', () => {
    const r = suggestedToRule({ type: 'keyword', value: '约炮', category: 'porn' });
    expect(r).not.toBeNull();
    expect(r!.value).toBe('约炮');
    expect(r!.category).toBe('porn');
    expect(r!.source).toBe('ai-mined');
    expect(r!.enabled).toBe(false); // 候选阶段不生效
  });

  it('合法正则转换', () => {
    const r = suggestedToRule({ type: 'regex', value: '\\bvx\\b' });
    expect(r).not.toBeNull();
    expect(r!.type).toBe('regex');
  });

  it('非法正则返回 null', () => {
    expect(suggestedToRule({ type: 'regex', value: '[' })).toBeNull();
  });

  it('空 value 返回 null', () => {
    expect(suggestedToRule({ type: 'keyword', value: '' })).toBeNull();
    expect(suggestedToRule({ type: 'keyword', value: '   ' })).toBeNull();
  });
});

describe('toCandidates', () => {
  const samples = [sample('fp1', '约炮加vx'), sample('fp2', '澳门赌场')];

  it('置信度达标 → 产生候选', () => {
    const result = miningResult({
      suggestedRules: [
        { type: 'keyword', value: '约炮', category: 'porn' },
        { type: 'keyword', value: '赌场', category: 'gambling' },
      ],
    });
    const cands = toCandidates(result, samples);
    expect(cands).toHaveLength(2);
    expect(cands[0]!.rule.value).toBe('约炮');
    expect(cands[0]!.status).toBe('pending');
    expect(cands[0]!.evidenceCount).toBe(2);
  });

  it(`置信度低于 ${MIN_CONFIDENCE} 不产生候选`, () => {
    const result = miningResult({ confidence: 0.3, suggestedRules: [{ type: 'keyword', value: '约炮' }] });
    expect(toCandidates(result, samples)).toHaveLength(0);
  });

  it('isNotSpam 不产生候选', () => {
    const result = miningResult({ isNotSpam: true, suggestedRules: [{ type: 'keyword', value: 'x' }] });
    expect(toCandidates(result, samples)).toHaveLength(0);
  });

  it('isNewPattern=false 不产生候选', () => {
    const result = miningResult({ isNewPattern: false, suggestedRules: [{ type: 'keyword', value: 'x' }] });
    expect(toCandidates(result, samples)).toHaveLength(0);
  });

  it('与现有规则重复跳过', () => {
    const existing: ConvertOptions['existing'] = new Set(['约炮']);
    const result = miningResult({ suggestedRules: [{ type: 'keyword', value: '约炮' }] });
    expect(toCandidates(result, samples, { existing })).toHaveLength(0);
  });

  it('太短的单字关键词跳过（防误伤）', () => {
    const result = miningResult({ suggestedRules: [{ type: 'keyword', value: '约' }] });
    expect(toCandidates(result, samples)).toHaveLength(0);
  });

  it('本次挖掘内部去重', () => {
    const result = miningResult({
      suggestedRules: [
        { type: 'keyword', value: '约炮' },
        { type: 'keyword', value: '约炮' }, // 重复
      ],
    });
    expect(toCandidates(result, samples)).toHaveLength(1);
  });

  it('非法正则规则被过滤', () => {
    const result = miningResult({
      suggestedRules: [
        { type: 'regex', value: '[' },
        { type: 'keyword', value: '约炮' },
      ],
    });
    expect(toCandidates(result, samples)).toHaveLength(1);
  });
});

describe('pickBatch', () => {
  it('按 suspicion 降序取前 N 条', () => {
    const pool = [
      sample('a', '内容a', 0.5),
      sample('b', '内容b', 0.9),
      sample('c', '内容c', 0.7),
    ];
    const batch = pickBatch(pool, [], 2);
    expect(batch.map((s) => s.fingerprint)).toEqual(['b', 'c']); // 0.9, 0.7
  });

  it('过滤负反馈指纹', () => {
    const pool = [sample('good', '内容', 0.9), sample('bad', '内容', 0.8)];
    const batch = pickBatch(pool, ['bad'], 5);
    expect(batch.map((s) => s.fingerprint)).toEqual(['good']);
  });

  it('过滤太短的文本', () => {
    const pool = [sample('short', 'a', 0.9), sample('ok', '正常长度', 0.8)];
    const batch = pickBatch(pool, [], 5);
    expect(batch.map((s) => s.fingerprint)).toEqual(['ok']);
  });

  it('池不足 batchSize 返回全部', () => {
    const pool = [sample('a', '内容', 0.9)];
    expect(pickBatch(pool, [], 10)).toHaveLength(1);
  });
});

describe('processedFingerprints', () => {
  it('返回批次所有指纹', () => {
    const batch = [sample('a'), sample('b')];
    expect(processedFingerprints(batch)).toEqual(['a', 'b']);
  });
});
