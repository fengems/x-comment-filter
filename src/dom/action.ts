/**
 * 命中动作执行器：折叠占位卡 / 隐藏 / 模糊。
 *
 * 核心差异化（docs/02-技术方案.md §4.5）：命中后不直接删除，
 * 替换为可展开的占位卡，用 Shadow DOM 隔离样式，不被 X 的 CSS 污染。
 * 用户可一键展开还原，永不破坏性删除。
 *
 * 三种动作：
 *  - fold（默认）：占位卡 + 展开按钮，可还原
 *  - hide：直接 display:none
 *  - blur：模糊 + 蒙层
 */

import type { SpamCategory } from '../rules/types';
import type { BlockAction } from '../settings/types';

const FOLD_HOST_ATTR = 'data-tfc-folded';
const FOLD_HOST_CLASS = 'tfc-fold-host';

/** 类别 → 中文标签 */
const CATEGORY_LABEL: Record<SpamCategory | 'unknown', string> = {
  porn: '色情',
  gambling: '博彩',
  promo: '推广',
  spam: '垃圾',
  custom: '可疑',
  unknown: '可疑',
};

export function categoryLabel(cat?: SpamCategory): string {
  return CATEGORY_LABEL[cat ?? 'unknown'] ?? CATEGORY_LABEL.unknown;
}

/** 占位卡 CSS（注入 Shadow DOM 内，:host 隔离） */
const PLACEHOLDER_CSS = `
  :host {
    all: initial;
    display: block;
  }
  .tfc-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    margin: 4px 0;
    border-radius: 12px;
    background: rgba(29, 155, 240, 0.08);
    border: 1px solid rgba(29, 155, 240, 0.2);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    color: inherit;
  }
  .tfc-icon { font-size: 16px; }
  .tfc-text { flex: 1; opacity: 0.8; }
  .tfc-btn {
    cursor: pointer;
    border: none;
    background: transparent;
    color: rgb(29, 155, 240);
    font-size: 13px;
    padding: 4px 8px;
    border-radius: 8px;
  }
  .tfc-btn:hover { background: rgba(29, 155, 240, 0.1); }
`;

/**
 * 折叠一条推文：隐藏原内容，插入 Shadow DOM 占位卡。
 * 幂等：已折叠则不重复操作。
 *
 * @param cell 推文 cellInnerDiv
 * @param category 命中类别（用于占位卡文案）
 * @param reason 命中原因（可选，hover/展开时展示）
 * @returns 是否实际执行了折叠（false=已折叠过）
 */
export function fold(cell: HTMLElement, category?: SpamCategory, reason?: string): boolean {
  if (cell.hasAttribute(FOLD_HOST_ATTR)) return false; // 已折叠
  cell.setAttribute(FOLD_HOST_ATTR, '1');

  // 隐藏原有内容（保留引用以便还原）
  const children = Array.from(cell.children) as HTMLElement[];
  children.forEach((c) => (c.style.display = 'none'));

  // 插入 Shadow DOM 占位卡
  const host = document.createElement('div');
  host.className = FOLD_HOST_CLASS;
  const sr = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PLACEHOLDER_CSS;
  const card = document.createElement('div');
  card.className = 'tfc-card';
  card.setAttribute('role', 'note');
  if (reason) card.title = reason;

  const icon = document.createElement('span');
  icon.className = 'tfc-icon';
  icon.textContent = '🛡️';

  const text = document.createElement('span');
  text.className = 'tfc-text';
  text.textContent = `已屏蔽内容（疑似${categoryLabel(category)}）`;

  const btn = document.createElement('button');
  btn.className = 'tfc-btn';
  btn.type = 'button';
  btn.textContent = '展开查看';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    unfold(cell);
  });

  card.append(icon, text, btn);
  sr.append(style, card);
  cell.insertBefore(host, cell.firstChild);

  return true;
}

/** 展开还原：移除占位卡，恢复原内容显示。幂等。 */
export function unfold(cell: HTMLElement): boolean {
  if (!cell.hasAttribute(FOLD_HOST_ATTR)) return false;
  cell.removeAttribute(FOLD_HOST_ATTR);

  const host = cell.querySelector(`.${FOLD_HOST_CLASS}`);
  host?.remove();

  // 恢复所有子节点显示
  Array.from(cell.children).forEach((c) => {
    (c as HTMLElement).style.display = '';
  });

  return true;
}

/** 直接隐藏（display:none）。幂等。 */
export function hide(cell: HTMLElement): boolean {
  if (cell.style.display === 'none') return false;
  cell.style.display = 'none';
  return true;
}

/** 恢复隐藏的内容。 */
export function show(cell: HTMLElement): boolean {
  if (cell.style.display !== 'none') return false;
  cell.style.display = '';
  return true;
}

/** 模糊 + 蒙层。幂等。 */
export function blur(cell: HTMLElement, category?: SpamCategory): boolean {
  if (cell.hasAttribute('data-tfc-blurred')) return false;
  cell.setAttribute('data-tfc-blurred', '1');
  cell.style.filter = 'blur(6px)';
  cell.style.position = 'relative';

  const overlay = document.createElement('div');
  overlay.className = 'tfc-blur-overlay';
  overlay.setAttribute('data-tfc-overlay', '1');
  overlay.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.4);border-radius:12px;cursor:pointer;color:#fff;font-size:13px;';
  overlay.textContent = `已屏蔽（疑似${categoryLabel(category)}）· 点击查看`;
  overlay.addEventListener('click', () => unblur(cell));
  cell.appendChild(overlay);
  return true;
}

/** 取消模糊。 */
export function unblur(cell: HTMLElement): boolean {
  if (!cell.hasAttribute('data-tfc-blurred')) return false;
  cell.removeAttribute('data-tfc-blurred');
  cell.style.filter = '';
  cell.querySelector('[data-tfc-overlay]')?.remove();
  return true;
}

/**
 * 统一执行动作。根据 action 类型派发。
 * @returns 是否实际执行了动作
 */
export function applyAction(
  cell: HTMLElement,
  action: BlockAction,
  category?: SpamCategory,
  reason?: string,
): boolean {
  switch (action) {
    case 'fold':
      return fold(cell, category, reason);
    case 'hide':
      return hide(cell);
    case 'blur':
      return blur(cell, category);
  }
}

/**
 * 还原任意动作（折叠/隐藏/模糊都还原）。
 * 用于：用户关闭扩展、规则变更后重新判定、紧急全展开。
 */
export function revert(cell: HTMLElement): void {
  unfold(cell);
  show(cell);
  unblur(cell);
}
