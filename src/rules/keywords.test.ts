import { describe, it, expect } from 'vitest';
import { parseLine, parseKeywords } from './keywords';

describe('parseLine', () => {
  it('普通关键词', () => {
    expect(parseLine('免费领')).toEqual({ value: '免费领', category: undefined });
  });

  it('空白行返回 null', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    expect(parseLine('\t')).toBeNull();
  });

  it('注释行返回 null', () => {
    expect(parseLine('# 这是注释')).toBeNull();
    expect(parseLine('  #缩进注释')).toBeNull();
  });

  it('行内 category 标注', () => {
    expect(parseLine('约炮 #category=porn')).toEqual({
      value: '约炮',
      category: 'porn',
    });
    expect(parseLine('澳门赌场 #category=gambling')).toEqual({
      value: '澳门赌场',
      category: 'gambling',
    });
  });
});

describe('parseKeywords', () => {
  it('解析多行词库', () => {
    const text = `# 色情类
约炮 #category=porn
同城约 #category=porn

# 博彩类
澳门赌场 #category=gambling
外围彩票 #category=gambling`;
    const rules = parseKeywords(text, 'builtin');
    expect(rules).toHaveLength(4);
    expect(rules[0].value).toBe('约炮');
    expect(rules[0].category).toBe('porn');
    expect(rules[0].source).toBe('builtin');
    expect(rules[0].type).toBe('keyword');
  });

  it('去重', () => {
    const text = `免费\n免费\n免费`;
    const rules = parseKeywords(text);
    expect(rules).toHaveLength(1);
  });

  it('空文本返回空数组', () => {
    expect(parseKeywords('')).toEqual([]);
    expect(parseKeywords('# 全注释\n\n')).toEqual([]);
  });

  it('兼容 CRLF', () => {
    const text = '免费\r\n约炮';
    const rules = parseKeywords(text);
    expect(rules).toHaveLength(2);
  });

  it('默认 scope=all', () => {
    const rules = parseKeywords('免费');
    expect(rules[0].scope).toBe('all');
  });

  it('自定义 scope', () => {
    const rules = parseKeywords('免费', 'builtin', 'comment');
    expect(rules[0].scope).toBe('comment');
  });
});
