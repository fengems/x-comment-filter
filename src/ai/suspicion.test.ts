import { describe, it, expect } from 'vitest';
import { suspicionScore } from './suspicion';

describe('suspicionScore', () => {
  it('空文本分数为 0', () => {
    expect(suspicionScore('')).toBe(0);
    expect(suspicionScore('   ')).toBe(0);
  });

  it('正常评论分数为 0', () => {
    const normal = '这篇文章写得很有深度，作者的观点我很认同，期待更多内容。';
    expect(suspicionScore(normal)).toBe(0);
  });

  it('含联系方式引导 → 高分', () => {
    const spam = '加vx：abc123 免费领';
    expect(suspicionScore(spam)).toBeGreaterThanOrEqual(0.4);
  });

  it('含导流话术 → 加分', () => {
    expect(suspicionScore('看主页有惊喜')).toBeGreaterThan(0);
    expect(suspicionScore('私我详情')).toBeGreaterThan(0);
  });

  it('短文+emoji → 加分', () => {
    const s = '约🍑'; // 短 + emoji
    const score = suspicionScore(s);
    expect(score).toBeGreaterThan(0); // 约命中导流 + emoji
  });

  it('正常长文不加 emoji 分', () => {
    const long = '这是一段很长很正常的评论，讨论技术细节，没有任何垃圾信息特征，长度超过三十个字符就不会触发短文加分。';
    expect(suspicionScore(long)).toBe(0);
  });

  it('新号加分', () => {
    const text = '看看'; // 短但不命中导流/联系方式
    // 新号 +0.25
    expect(suspicionScore(text, { accountAgeDays: 5 })).toBeGreaterThanOrEqual(0.25);
  });

  it('低粉加分', () => {
    expect(suspicionScore('ok', { followers: 3 })).toBeGreaterThanOrEqual(0.2);
  });

  it('默认头像加分', () => {
    expect(suspicionScore('ok', { hasDefaultAvatar: true })).toBeGreaterThanOrEqual(0.2);
  });

  it('多个特征叠加，封顶 1', () => {
    const superSpam = '加vx：abc123 看主页约啊啊啊🍑'; // 联系方式+导流+短emoji+重复
    const score = suspicionScore(superSpam, {
      accountAgeDays: 1,
      followers: 0,
      hasDefaultAvatar: true,
    });
    expect(score).toBe(1); // 封顶
  });

  it('达到默认阈值 0.5 的典型垃圾样本', () => {
    // 联系方式(0.4) + 新号(0.25) = 0.65，超阈值
    expect(
      suspicionScore('加wx：12345678', { accountAgeDays: 10 }),
    ).toBeGreaterThanOrEqual(0.5);
  });
});
