import { describe, it, expect } from 'vitest';
import { RuleEngine, compileRuleValue, escapeRegex, containsCJK } from './engine';
import { createRule, type Rule } from './types';

/** 构造规则的简写 */
function rule(partial: Partial<Rule> & Pick<Rule, 'value'>): Rule {
  return createRule(partial);
}

describe('escapeRegex', () => {
  it('转义正则元字符', () => {
    expect(escapeRegex('a.b*c+')).toBe('a\\.b\\*c\\+');
    expect(escapeRegex('[test]')).toBe('\\[test\\]');
    expect(escapeRegex('价格$100')).toBe('价格\\$100');
  });

  it('普通文本原样', () => {
    expect(escapeRegex('免费约')).toBe('免费约');
  });
});

describe('containsCJK', () => {
  it('识别中文', () => {
    expect(containsCJK('免费')).toBe(true);
    expect(containsCJK('约')).toBe(true);
  });
  it('识别日韩', () => {
    expect(containsCJK('こんにちは')).toBe(true);
    expect(containsCJK('안녕')).toBe(true);
  });
  it('纯拉丁为 false', () => {
    expect(containsCJK('free')).toBe(false);
    expect(containsCJK('123')).toBe(false);
  });
});

describe('compileRuleValue - 词边界', () => {
  it('CJK 关键词 wordBoundary 退化为 substring（中文无法可靠分词）', () => {
    // 设计决策：CJK \b 无效，wordBoundary 退化为 substring。
    // 多字短语命中（垃圾话术多为连续短语）
    const re = compileRuleValue(rule({ value: '免费领' }))!;
    expect(re.test('点击免费领取')).toBe(true);
    expect(re.test('qq免费领取')).toBe(true);

    // 单字 CJK 也会子串命中（"约"出现在"来约啊"里）
    const reSingle = compileRuleValue(rule({ value: '约' }))!;
    expect(reSingle.test('来约啊')).toBe(true);
    // 注：单字"约"同样会命中"约见面"——这是中文分词固有问题，
    // 用 whitelist 例外词兜底（见下方白名单测试），而非正则边界。
  });

  it('拉丁关键词用 \\b 词边界，不误伤', () => {
    const re = compileRuleValue(rule({ value: 'sex' }))!;
    expect(re.test('sex chat')).toBe(true);
    // xModerator 的经典误伤：sex 命中 Sussex
    expect(re.test('I live in Sussex')).toBe(false);
    expect(re.test('Middlesex')).toBe(false);
  });

  it('ad 不命中 header/read（xModerator 误伤）', () => {
    const re = compileRuleValue(rule({ value: 'ad', match: 'wordBoundary' }))!;
    expect(re.test('click my ad')).toBe(true);
    expect(re.test('read this')).toBe(false);
    expect(re.test('header line')).toBe(false);
  });

  it('substring 模式允许子串命中', () => {
    const re = compileRuleValue(rule({ value: '约', match: 'substring' }))!;
    expect(re.test('约见')).toBe(true);
    expect(re.test('约')).toBe(true);
  });

  it('exact 模式要求整串相等', () => {
    const re = compileRuleValue(rule({ value: 'spam', match: 'exact' }))!;
    expect(re.test('spam')).toBe(true);
    expect(re.test('spammer')).toBe(false);
  });

  it('空 value 返回 null', () => {
    expect(compileRuleValue(rule({ value: '' }))).toBeNull();
  });
});

describe('RuleEngine.match', () => {
  it('基本关键词命中', () => {
    const engine = new RuleEngine();
    engine.update([rule({ id: 'r1', value: '免费领' })]);
    const hits = engine.match('点击免费领取', 'user1', 'comment');
    expect(hits.map((r) => r.id)).toEqual(['r1']);
  });

  it('CJK 单字误伤用 whitelist 例外词兜底', () => {
    // 单字"约"会命中"约见面"，靠 whitelist["约见"] 放行
    const engine = new RuleEngine();
    engine.update([rule({ value: '约', whitelist: ['约见', '约束'] })]);
    expect(engine.match('约见面吗', 'u', 'comment')).toHaveLength(0);
    expect(engine.match('来约啊', 'u', 'comment')).toHaveLength(1);
  });

  it('多条规则命中多条', () => {
    const engine = new RuleEngine();
    engine.update([
      rule({ id: 'a', value: '免费', category: 'promo' }),
      rule({ id: 'b', value: '约', category: 'porn' }),
    ]);
    const hits = engine.match('免费约', 'u', 'comment');
    expect(hits.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('反绕过：零宽字符拆分关键词仍命中', () => {
    const engine = new RuleEngine();
    engine.update([rule({ value: '免费' })]);
    // 垃圾信息：免\u200b费
    expect(engine.match('点击免\u200b费领', 'u', 'comment')).toHaveLength(1);
  });

  it('反绕过：全角字符伪装仍命中', () => {
    const engine = new RuleEngine();
    engine.update([rule({ value: '免费' })]);
    // 全角：１２３免费
    expect(engine.match('１２３免费', 'u', 'comment')).toHaveLength(1);
  });

  it('白名单豁免：命中但含例外词则放行', () => {
    const engine = new RuleEngine();
    engine.update([
      rule({ value: '成人', whitelist: ['成人教育', '成人高考'] }),
    ]);
    expect(engine.match('成人教育报名', 'u', 'comment')).toHaveLength(0);
    expect(engine.match('成人视频', 'u', 'comment')).toHaveLength(1);
  });

  it('用户名匹配：type=username', () => {
    const engine = new RuleEngine();
    engine.update([
      rule({ id: 'u1', type: 'username', value: 'spambot' }),
    ]);
    expect(engine.match('正常评论', 'spambot123', 'comment')).toHaveLength(1);
    expect(engine.match('正常评论', 'gooduser', 'comment')).toHaveLength(0);
  });

  it('用户名清洗：sp_am.bot 命中 spambot', () => {
    const engine = new RuleEngine();
    engine.update([
      rule({ type: 'username', value: 'spambot', match: 'substring' }),
    ]);
    expect(engine.match('ok', 'sp_am.bot', 'comment')).toHaveLength(1);
  });

  it('scope 过滤：comment 规则在 feed 场景不生效', () => {
    const engine = new RuleEngine();
    engine.update([
      rule({ id: 'c', value: '免费', scope: 'comment' }),
    ]);
    expect(engine.match('免费', 'u', 'comment')).toHaveLength(1);
    expect(engine.match('免费', 'u', 'feed')).toHaveLength(0);
  });

  it('scope=all 在所有场景生效', () => {
    const engine = new RuleEngine();
    engine.update([rule({ value: '免费', scope: 'all' })]);
    expect(engine.match('免费', 'u', 'comment')).toHaveLength(1);
    expect(engine.match('免费', 'u', 'feed')).toHaveLength(1);
  });

  it('disabled 规则不生效', () => {
    const engine = new RuleEngine();
    engine.update([rule({ value: '免费', enabled: false })]);
    expect(engine.match('免费', 'u', 'comment')).toHaveLength(0);
  });

  it('正则规则', () => {
    const engine = new RuleEngine();
    engine.update([
      rule({ id: 're', type: 'regex', value: '\\b(vx|微信|wx)\\s*[:：]?\\s*\\w' }),
    ]);
    expect(engine.match('加vx：12345', 'u', 'comment')).toHaveLength(1);
    expect(engine.match('普通评论', 'u', 'comment')).toHaveLength(0);
  });

  it('非法正则被收集为 issue，不中断其它规则', () => {
    const engine = new RuleEngine();
    engine.update([
      rule({ id: 'bad', type: 'regex', value: '[' }), // 非法
      rule({ id: 'good', value: '免费' }),
    ]);
    expect(engine.size()).toBe(1);
    expect(engine.getIssues().map((i) => i.ruleId)).toEqual(['bad']);
    expect(engine.match('免费', 'u', 'comment')).toHaveLength(1);
  });

  it('大小写不敏感', () => {
    const engine = new RuleEngine();
    engine.update([rule({ value: 'FREE' })]);
    expect(engine.match('get it free now', 'u', 'comment')).toHaveLength(1);
    expect(engine.match('FREE FREE', 'u', 'comment')).toHaveLength(1);
  });

  it('空文本不命中', () => {
    const engine = new RuleEngine();
    engine.update([rule({ value: '免费' })]);
    expect(engine.match('', 'u', 'comment')).toHaveLength(0);
  });
});
