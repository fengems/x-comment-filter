/**
 * Popup 逻辑：双卡统计、当前页面状态条、快捷设置、同步时间。
 * 全程自动保存（改任何项立即写 storage），content script 靠 onChanged 实时响应。
 */
import { Storage } from '../../src/storage';
import { categoryLabel } from '../../src/dom/action';

const storage = new Storage();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enabled = $<HTMLInputElement>('enabled');
const scope = $<HTMLSelectElement>('scope');
const action = $<HTMLSelectElement>('action');
const checkUsername = $<HTMLInputElement>('checkUsername');
const dryRun = $<HTMLInputElement>('dryRun');
const debug = $<HTMLInputElement>('debug');
const totalBlocked = $<HTMLElement>('totalBlocked');
const todayBlocked = $<HTMLElement>('todayBlocked');
const statusDot = $<HTMLElement>('statusDot');
const statusText = $<HTMLElement>('statusText');
const statusBar = $<HTMLElement>('statusBar');
const syncBtn = $<HTMLButtonElement>('syncBtn');
const openOptions = $<HTMLButtonElement>('openOptions');
const syncStatus = $<HTMLElement>('syncStatus');

async function init(): Promise<void> {
  const [settings, stats, pageStats, cloud] = await Promise.all([
    storage.getSettings(),
    storage.getStats(),
    storage.getPageStats(),
    storage.getCloudKeywords(),
  ]);

  enabled.checked = settings.enabled;
  scope.value = settings.scope;
  action.value = settings.action;
  checkUsername.checked = settings.checkUsername;
  dryRun.checked = settings.dryRun;
  debug.checked = settings.debug;

  totalBlocked.textContent = String(stats.totalBlocked);
  todayBlocked.textContent = String(stats.todayBlocked);

  renderPageStatus(pageStats);
  renderSyncTime(cloud.lastSync, cloud.status);

  bindAutoSave();
}

/** 渲染当前页面状态条 */
function renderPageStatus(pageStats: { count: number; byCategory: Record<string, number> }): void {
  if (pageStats.count === 0) {
    statusBar.classList.add('inactive');
    statusText.textContent = '当前页面暂无屏蔽';
    return;
  }
  statusBar.classList.remove('inactive');
  const cats = Object.entries(pageStats.byCategory)
    .filter(([, n]) => n > 0)
    .map(([cat, n]) => `${n} ${categoryLabel(cat as never)}`)
    .join(' · ');
  statusText.textContent = `正在保护 · 本页过滤 ${pageStats.count} 条${cats ? '（' + cats + '）' : ''}`;
}

/** 渲染同步时间 */
function renderSyncTime(lastSync: number, status: string): void {
  if (status && status.includes('限流')) {
    syncStatus.textContent = '⚠ ' + status;
    return;
  }
  if (!lastSync) {
    syncStatus.textContent = status || '未同步';
    return;
  }
  const diff = Date.now() - lastSync;
  const updated = status.includes('更新');
  syncStatus.textContent = `云端规则：${formatTimeAgo(diff)}${updated ? ' ✓' : ''}`;
}

function formatTimeAgo(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.floor(hr / 24)} 天前`;
}

function bindAutoSave(): void {
  enabled.addEventListener('change', () => save({ enabled: enabled.checked }));
  scope.addEventListener('change', () => save({ scope: scope.value as 'comments' | 'all' }));
  action.addEventListener('change', () => save({ action: action.value as 'fold' | 'hide' | 'blur' }));
  checkUsername.addEventListener('change', () => save({ checkUsername: checkUsername.checked }));
  dryRun.addEventListener('change', () => save({ dryRun: dryRun.checked }));
  debug.addEventListener('change', () => save({ debug: debug.checked }));

  syncBtn.addEventListener('click', async () => {
    syncStatus.textContent = '同步中…';
    await chrome.runtime.sendMessage({ action: 'sync-now' });
    const cloud = await storage.getCloudKeywords();
    renderSyncTime(cloud.lastSync, cloud.status);
  });

  openOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

async function save(patch: Record<string, unknown>): Promise<void> {
  await storage.setSettings(patch as Parameters<Storage['setSettings']>[0]);
}

// statusDot 占位引用避免未使用告警（视觉元素由 CSS 控制）
void statusDot;

void init();
