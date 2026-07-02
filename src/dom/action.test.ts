import { describe, it, expect } from 'vitest';
import { fold, unfold, hide, show, blur, unblur, applyAction, revert, categoryLabel } from './action';

function makeCell(): HTMLElement {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  const child = document.createElement('div');
  child.textContent = '原始内容';
  cell.appendChild(child);
  return cell;
}

describe('categoryLabel', () => {
  it('类别转中文', () => {
    expect(categoryLabel('porn')).toBe('色情');
    expect(categoryLabel('gambling')).toBe('博彩');
    expect(categoryLabel('promo')).toBe('推广');
    expect(categoryLabel()).toBe('可疑');
  });
});

describe('fold / unfold', () => {
  it('fold 隐藏原内容并插入占位卡', () => {
    const cell = makeCell();
    const result = fold(cell, 'porn');
    expect(result).toBe(true);
    expect(cell.hasAttribute('data-tfc-folded')).toBe(true);
    // 原内容被隐藏
    const original = cell.children[1] as HTMLElement;
    expect(original.style.display).toBe('none');
    // 占位卡存在（Shadow host）
    expect(cell.querySelector('.tfc-fold-host')).toBeTruthy();
  });

  it('fold 幂等：重复折叠返回 false', () => {
    const cell = makeCell();
    fold(cell);
    expect(fold(cell)).toBe(false);
    // 只有一个 host
    expect(cell.querySelectorAll('.tfc-fold-host')).toHaveLength(1);
  });

  it('unfold 恢复原内容并移除占位卡', () => {
    const cell = makeCell();
    fold(cell);
    const result = unfold(cell);
    expect(result).toBe(true);
    expect(cell.hasAttribute('data-tfc-folded')).toBe(false);
    expect(cell.querySelector('.tfc-fold-host')).toBeNull();
    // 原内容恢复显示
    const original = cell.children[0] as HTMLElement;
    expect(original.style.display).toBe('');
  });

  it('unfold 幂等：未折叠时返回 false', () => {
    const cell = makeCell();
    expect(unfold(cell)).toBe(false);
  });

  it('展开按钮点击触发 unfold', () => {
    const cell = makeCell();
    fold(cell, 'spam', '命中关键词');
    // 模拟点击展开按钮（在 shadow DOM 内）
    const host = cell.querySelector('.tfc-fold-host')!;
    const sr = host.shadowRoot!;
    const btn = sr.querySelector('button')!;
    btn.click();
    expect(cell.hasAttribute('data-tfc-folded')).toBe(false);
  });

  it('占位卡 Shadow DOM 隔离样式', () => {
    const cell = makeCell();
    fold(cell, 'gambling');
    const host = cell.querySelector('.tfc-fold-host')!;
    expect(host.shadowRoot).toBeTruthy();
    // shadow 内有 style
    expect(host.shadowRoot!.querySelector('style')).toBeTruthy();
    // 文案含类别
    expect(host.shadowRoot!.textContent).toContain('博彩');
  });
});

describe('hide / show', () => {
  it('hide 设 display:none', () => {
    const cell = makeCell();
    expect(hide(cell)).toBe(true);
    expect(cell.style.display).toBe('none');
  });
  it('hide 幂等', () => {
    const cell = makeCell();
    hide(cell);
    expect(hide(cell)).toBe(false);
  });
  it('show 恢复', () => {
    const cell = makeCell();
    hide(cell);
    expect(show(cell)).toBe(true);
    expect(cell.style.display).toBe('');
  });
});

describe('blur / unblur', () => {
  it('blur 添加蒙层', () => {
    const cell = makeCell();
    expect(blur(cell, 'porn')).toBe(true);
    expect(cell.style.filter).toContain('blur');
    expect(cell.querySelector('[data-tfc-overlay]')).toBeTruthy();
  });
  it('blur 幂等', () => {
    const cell = makeCell();
    blur(cell);
    expect(blur(cell)).toBe(false);
  });
  it('unblur 移除蒙层', () => {
    const cell = makeCell();
    blur(cell);
    expect(unblur(cell)).toBe(true);
    expect(cell.style.filter).toBe('');
    expect(cell.querySelector('[data-tfc-overlay]')).toBeNull();
  });
});

describe('applyAction', () => {
  it('fold 动作派发到 fold', () => {
    const cell = makeCell();
    expect(applyAction(cell, 'fold', 'spam')).toBe(true);
    expect(cell.hasAttribute('data-tfc-folded')).toBe(true);
  });
  it('hide 动作派发到 hide', () => {
    const cell = makeCell();
    expect(applyAction(cell, 'hide')).toBe(true);
    expect(cell.style.display).toBe('none');
  });
  it('blur 动作派发到 blur', () => {
    const cell = makeCell();
    expect(applyAction(cell, 'blur', 'porn')).toBe(true);
    expect(cell.hasAttribute('data-tfc-blurred')).toBe(true);
  });
});

describe('revert', () => {
  it('还原所有动作状态', () => {
    const cell = makeCell();
    fold(cell);
    revert(cell);
    expect(cell.hasAttribute('data-tfc-folded')).toBe(false);
    expect(cell.querySelector('.tfc-fold-host')).toBeNull();
  });
  it('还原 hidden', () => {
    const cell = makeCell();
    hide(cell);
    revert(cell);
    expect(cell.style.display).toBe('');
  });
});
