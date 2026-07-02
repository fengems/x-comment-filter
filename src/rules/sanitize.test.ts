import { describe, it, expect } from 'vitest';
import { sanitize, sanitizeUsername } from './sanitize';

describe('sanitize', () => {
  it('空输入返回空字符串', () => {
    expect(sanitize('')).toBe('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(sanitize(undefined as any)).toBe('');
  });

  it('普通文本原样保留', () => {
    expect(sanitize('这是一条正常评论 hello world 123')).toBe(
      '这是一条正常评论 hello world 123',
    );
  });

  it('去除零宽字符：免\\u200b费 → 免费', () => {
    // 垃圾信息常用零宽空格拆分关键词
    expect(sanitize('免\u200b费')).toBe('免费');
    expect(sanitize('约\u200b约\u200b')).toBe('约约');
  });

  it('去除软连字符和 BOM', () => {
    expect(sanitize('免\u00AD费')).toBe('免费');
    expect(sanitize('\uFEFF免费')).toBe('免费');
  });

  it('去除双向控制符（RTL/LTR override，常被用于伪装）', () => {
    expect(sanitize('免\u202E费')).toBe('免费');
    expect(sanitize('abc\u202Cdef')).toBe('abcdef');
  });

  it('去除组合附加符号（花体字装饰）', () => {
    // 在 a 上叠加组合重音
    expect(sanitize('a\u0301')).toBe('a');
  });

  it('全角字符转半角：１２３ａｂｃ → 123abc', () => {
    expect(sanitize('１２３ａｂｃ')).toBe('123abc');
  });

  it('数学花体字母归一化：𝕗𝕣𝕖𝕖 → free', () => {
    // NFKC 把 Mathematical Alphanumeric Symbols 映射回基本字母
    expect(sanitize('𝕗𝕣𝕖𝕖')).toBe('free');
  });

  it('各类空格统一为普通空格并压缩', () => {
    // 不间断空格 \u00A0、全角空格 \u3000、en space \u2002
    expect(sanitize('a\u00A0b\u3000c\u2002d')).toBe('a b c d');
    expect(sanitize('a    b\t\tc')).toBe('a b c');
  });

  it('组合多种绕过手法', () => {
    // 零宽 + 全角 + 花体字母混合
    expect(sanitize('１２３\u200b免\u200b费')).toBe('123免费');
    expect(sanitize('𝕗𝕣𝕖𝕖\u200b约')).toBe('free约');
  });
});

describe('sanitizeUsername', () => {
  it('去掉分隔符：免.费 → 免费', () => {
    expect(sanitizeUsername('免.费')).toBe('免费');
    expect(sanitizeUsername('免_费')).toBe('免费');
    expect(sanitizeUsername('免-费')).toBe('免费');
    expect(sanitizeUsername('免 费')).toBe('免费');
  });

  it('组合分隔符与零宽：免._费\\u200b → 免费', () => {
    expect(sanitizeUsername('免._费\u200b')).toBe('免费');
  });

  it('handle 中的 @ 前缀保留（@ 在 username 里有语义，handle 提取由调用方处理）', () => {
    // sanitizeUsername 不应吃掉 @（它可能是合法的 handle 一部分用于匹配）
    expect(sanitizeUsername('spambot')).toBe('spambot');
  });

  it('全角归一化同样生效', () => {
    expect(sanitizeUsername('ｓｐａｍ')).toBe('spam');
  });
});
