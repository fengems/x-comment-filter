/**
 * Options 页：侧边 5 tab 导航 + 各 tab 逻辑。
 * Tab：规则 / 白名单 / AI 挖掘 / 统计 / 数据。
 */
import { Storage } from '../../src/storage';
import { createRule } from '../../src/rules/types';
import { parseKeywords } from '../../src/rules/keywords';
import { categoryLabel } from '../../src/dom/action';
import type { Rule, SpamCategory } from '../../src/rules/types';
import type { CandidateRule, HistoryItem } from '../../src/settings/types';

const storage = new Storage();
let activeCategoryFilter = 'all';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function init(): Promise<void> {
  bindNav();
  bindRules();
  bindWhitelist();
  bindAi();
  bindStats();
  bindData();
  await renderAll();
  await renderAiSettings();
}

/** 渲染所有 tab（首次加载） */
async function renderAll(): Promise<void> {
  await Promise.all([
    renderKeywords(),
    renderWhitelist(),
    renderCandidates(),
    renderStats(),
    renderHistory(),
    renderSidebarInfo(),
  ]);
}

// ---- 侧边导航 ----
function bindNav(): void {
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      $<HTMLElement>(`tab-${tab}`).classList.add('active');
    });
  });
}

async function renderSidebarInfo(): Promise<void> {
  const rs = await storage.getRuleSet();
  const total = rs.user.length + rs.builtin.length + rs.cloud.length + rs.aiMined.length;
  $<HTMLElement>('ruleCountInfo').textContent = `规则 ${total} 条`;
}

// ---- Tab 1: 规则 ----
function bindRules(): void {
  $<HTMLButtonElement>('addBtn').addEventListener('click', addKeyword);
  $<HTMLInputElement>('newKeyword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addKeyword();
  });
  document.querySelectorAll<HTMLButtonElement>('.filter-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategoryFilter = btn.dataset.cat ?? 'all';
      document.querySelectorAll('.filter-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      void renderKeywords();
    });
  });
}

async function renderKeywords(): Promise<void> {
  const rs = await storage.getRuleSet();
  const allRules = [
    ...rs.user.map((r) => ({ ...r, _src: 'user' })),
    ...rs.builtin.map((r) => ({ ...r, _src: '内置' })),
    ...rs.cloud.map((r) => ({ ...r, _src: '云端' })),
    ...rs.aiMined.map((r) => ({ ...r, _src: 'AI' })),
  ];

  // 来源统计
  $<HTMLElement>('sourceDist').textContent =
    `来源分布：内置 ${rs.builtin.length} · 用户 ${rs.user.length} · 云端 ${rs.cloud.length} · AI ${rs.aiMined.length}`;

  // 分类筛选
  const filtered = activeCategoryFilter === 'all'
    ? allRules
    : allRules.filter((r) => (r.category ?? 'custom') === activeCategoryFilter);

  $<HTMLElement>('ruleCount').textContent = String(filtered.length);

  const list = $<HTMLElement>('keywordList');
  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = '<div class="hint">暂无规则</div>';
    return;
  }
  for (const rule of filtered) {
    const item = document.createElement('div');
    item.className = 'rule-item';
    const value = document.createElement('span');
    value.className = 'rule-value';
    value.textContent = rule.value;
    const cat = document.createElement('span');
    cat.className = 'rule-cat';
    cat.textContent = categoryLabel(rule.category);
    const src = document.createElement('span');
    src.className = 'rule-source';
    src.textContent = rule._src;
    item.append(value, cat, src);
    // 只有 user 规则可删
    if (rule._src === 'user') {
      const del = document.createElement('button');
      del.className = 'rule-del';
      del.textContent = '✕';
      del.title = '删除';
      del.addEventListener('click', () => removeKeyword(rule.id));
      item.appendChild(del);
    }
    list.appendChild(item);
  }
}

async function addKeyword(): Promise<void> {
  const input = $<HTMLInputElement>('newKeyword');
  const value = input.value.trim();
  if (!value) return;
  const category = $<HTMLSelectElement>('newCategory').value as SpamCategory;
  const rs = await storage.getRuleSet();
  if (rs.user.some((r) => r.value === value)) {
    input.value = '';
    return;
  }
  rs.user.push(createRule({ type: 'keyword', value, category, source: 'user' }));
  await storage.setRuleSet(rs);
  input.value = '';
  await renderKeywords();
  await renderSidebarInfo();
}

async function removeKeyword(id: string): Promise<void> {
  const rs = await storage.getRuleSet();
  rs.user = rs.user.filter((r) => r.id !== id);
  await storage.setRuleSet(rs);
  await renderKeywords();
  await renderSidebarInfo();
}

// ---- Tab 2: 白名单 ----
function bindWhitelist(): void {
  $<HTMLButtonElement>('addWhitelistBtn').addEventListener('click', addWhitelist);
  $<HTMLInputElement>('newWhitelist').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addWhitelist();
  });
}

async function renderWhitelist(): Promise<void> {
  const settings = await storage.getSettings();
  const list = $<HTMLElement>('whitelistList');
  list.innerHTML = '';
  if (settings.whitelistUsers.length === 0) {
    list.innerHTML = '<div class="hint">暂无白名单</div>';
    return;
  }
  for (const handle of settings.whitelistUsers) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    const text = document.createElement('span');
    text.textContent = `@${handle}`;
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '✕';
    x.addEventListener('click', () => removeWhitelist(handle));
    tag.append(text, x);
    list.appendChild(tag);
  }
}

async function addWhitelist(): Promise<void> {
  const input = $<HTMLInputElement>('newWhitelist');
  const handle = input.value.trim().replace(/^@/, '');
  if (!handle) return;
  const settings = await storage.getSettings();
  if (!settings.whitelistUsers.includes(handle)) {
    settings.whitelistUsers.push(handle);
    await storage.setSettings({ whitelistUsers: settings.whitelistUsers });
  }
  input.value = '';
  await renderWhitelist();
}

async function removeWhitelist(handle: string): Promise<void> {
  const settings = await storage.getSettings();
  settings.whitelistUsers = settings.whitelistUsers.filter((h) => h !== handle);
  await storage.setSettings({ whitelistUsers: settings.whitelistUsers });
  await renderWhitelist();
}

// ---- Tab 3: AI 挖掘 ----
function bindAi(): void {
  $<HTMLSelectElement>('aiBackend').addEventListener('change', toggleCloudConfig);
  $<HTMLSelectElement>('cloudProvider').addEventListener('change', toggleCustomEndpoint);
  $<HTMLButtonElement>('saveAiBtn').addEventListener('click', saveAiSettings);
  $<HTMLButtonElement>('mineBtn').addEventListener('click', mineNow);
  $<HTMLButtonElement>('checkBtn').addEventListener('click', checkLocal);
}

async function renderAiSettings(): Promise<void> {
  const ai = await storage.getAiSettings();
  $<HTMLSelectElement>('aiBackend').value = ai.backend;
  $<HTMLSelectElement>('cloudProvider').value = ai.cloudProvider;
  $<HTMLInputElement>('cloudEndpoint').value = ai.cloudEndpoint;
  $<HTMLInputElement>('cloudApiKey').value = ai.cloudApiKey;
  $<HTMLSelectElement>('localModel').value = ai.localModel;
  $<HTMLInputElement>('miningInterval').value = String(ai.miningIntervalMin);
  toggleCloudConfig();
  toggleCustomEndpoint();
}

function toggleCloudConfig(): void {
  const backend = $<HTMLSelectElement>('aiBackend').value;
  const isCloud = backend === 'cloud';
  const isLocal = backend === 'local-chrome' || backend === 'local-webllm';
  $<HTMLElement>('cloudConfig').hidden = !isCloud;
  $<HTMLElement>('apiKeyRow').hidden = !isCloud;
  $<HTMLElement>('intervalRow').hidden = backend === 'none';
  $<HTMLElement>('localModelRow').hidden = backend !== 'local-webllm';
  $<HTMLElement>('checkRow').hidden = !isLocal;
  toggleCustomEndpoint();
}

function toggleCustomEndpoint(): void {
  $<HTMLElement>('endpointRow').hidden = $<HTMLSelectElement>('cloudProvider').value !== 'custom';
}

async function saveAiSettings(): Promise<void> {
  const status = $<HTMLElement>('aiStatus');
  const backend = $<HTMLSelectElement>('aiBackend').value as 'none' | 'cloud' | 'local-chrome' | 'local-webllm';
  if (backend === 'cloud' && !$<HTMLInputElement>('cloudApiKey').value.trim()) {
    status.textContent = '⚠️ 云端模式需要填写 API key';
    return;
  }
  await storage.setAiSettings({
    backend,
    cloudProvider: $<HTMLSelectElement>('cloudProvider').value as 'deepseek' | 'openai' | 'custom',
    cloudEndpoint: $<HTMLInputElement>('cloudEndpoint').value.trim(),
    cloudApiKey: $<HTMLInputElement>('cloudApiKey').value.trim(),
    localModel: $<HTMLSelectElement>('localModel').value as 'qwen2.5-0.5b' | 'qwen3-0.6b' | 'gemma-270m',
    miningIntervalMin: Math.max(5, Number($<HTMLInputElement>('miningInterval').value) || 30),
  });
  status.textContent = '✓ 已保存';
  setTimeout(() => (status.textContent = ''), 2000);
}

async function renderCandidates(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({ action: 'get-candidates' })) as {
    candidates?: CandidateRule[];
  };
  const candidates = res.candidates ?? [];
  $<HTMLElement>('candidateCount').textContent = String(candidates.length);

  // 侧边栏红点
  const badge = $<HTMLElement>('aiBadge');
  if (candidates.length > 0) {
    badge.textContent = String(candidates.length);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  const list = $<HTMLElement>('candidatesList');
  list.innerHTML = '';
  if (candidates.length === 0) {
    list.innerHTML = '<div class="hint">暂无候选规则。可疑评论积累后点击"立即挖掘"。</div>';
    return;
  }
  for (const c of candidates) {
    const card = document.createElement('div');
    card.className = 'candidate';
    const value = document.createElement('div');
    value.className = 'candidate-value';
    value.textContent = c.rule.value;
    const meta = document.createElement('div');
    meta.className = 'candidate-meta';
    meta.textContent = `[${categoryLabel(c.rule.category)}] 置信度 ${(c.confidence * 100).toFixed(0)}% · 命中 ${c.evidenceCount} 条样本`;
    card.append(value, meta);
    if (c.examples.length > 0) {
      const ex = document.createElement('div');
      ex.className = 'candidate-example';
      ex.textContent = `例：${c.examples[0]}`;
      card.appendChild(ex);
    }
    const btns = document.createElement('div');
    btns.className = 'candidate-actions';
    const accept = document.createElement('button');
    accept.className = 'btn';
    accept.textContent = '✓ 采纳';
    accept.addEventListener('click', () => acceptCandidate(c.rule.value));
    const reject = document.createElement('button');
    reject.className = 'btn ghost';
    reject.textContent = '✗ 拒绝';
    reject.addEventListener('click', () => rejectCandidate(c.rule.value));
    btns.append(accept, reject);
    card.appendChild(btns);
    list.appendChild(card);
  }
}

async function acceptCandidate(value: string): Promise<void> {
  await chrome.runtime.sendMessage({ action: 'accept-candidate', value });
  await renderCandidates();
  await renderKeywords();
  await renderSidebarInfo();
}

async function rejectCandidate(value: string): Promise<void> {
  await chrome.runtime.sendMessage({ action: 'reject-candidate', value });
  await renderCandidates();
}

async function mineNow(): Promise<void> {
  const list = $<HTMLElement>('candidatesList');
  list.innerHTML = '<div class="hint">挖掘中…</div>';
  await chrome.runtime.sendMessage({ action: 'mine-now' });
  await renderCandidates();
}

async function checkLocal(): Promise<void> {
  const status = $<HTMLElement>('localStatus');
  const backend = $<HTMLSelectElement>('aiBackend').value;
  const modelId = $<HTMLSelectElement>('localModel').value;
  status.textContent = '检测中…';
  try {
    const res = (await chrome.runtime.sendMessage({ action: 'check-local', backend, modelId })) as {
      available?: boolean;
      reason?: string;
      needsDownload?: boolean;
    };
    if (res.available) status.textContent = '✓ 可用';
    else if (res.needsDownload) status.textContent = `⚠ ${res.reason ?? '需下载模型'}`;
    else status.textContent = `✗ ${res.reason ?? '不可用'}`;
  } catch (e) {
    status.textContent = `检测失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

// ---- Tab 4: 统计 ----
function bindStats(): void {
  $<HTMLButtonElement>('resetStatsBtn').addEventListener('click', resetStats);
}

async function renderStats(): Promise<void> {
  const stats = await storage.getStats();
  // 统计卡片
  const grid = $<HTMLElement>('statGrid');
  grid.innerHTML = '';
  const cards: Array<[string, string]> = [
    [String(stats.totalBlocked), '总屏蔽'],
    [String(stats.todayBlocked), '今日'],
    ...Object.entries(stats.byCategory).map(([cat, n]) => [String(n), categoryLabel(cat as SpamCategory)] as [string, string]),
  ];
  for (const [num, label] of cards) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `<div class="num">${escapeHtml(num)}</div><div class="label">${escapeHtml(label)}</div>`;
    grid.appendChild(card);
  }

  // 进度条分布
  const distBars = $<HTMLElement>('distBars');
  distBars.innerHTML = '';
  const total = stats.totalBlocked || 1;
  const sorted = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    distBars.innerHTML = '<div class="hint">暂无数据</div>';
    return;
  }
  for (const [cat, n] of sorted) {
    const pct = (n / total) * 100;
    const bar = document.createElement('div');
    bar.className = 'dist-bar';
    bar.innerHTML = `
      <span class="name">${escapeHtml(categoryLabel(cat as SpamCategory))}</span>
      <span class="track"><span class="fill" style="width:${pct}%"></span></span>
      <span class="val">${n} (${pct.toFixed(0)}%)</span>`;
    distBars.appendChild(bar);
  }
}

async function resetStats(): Promise<void> {
  if (!confirm('确定重置所有统计？')) return;
  await storage.resetStats();
  await renderStats();
}

// ---- Tab 5: 数据 ----
function bindData(): void {
  $<HTMLButtonElement>('exportBtn').addEventListener('click', exportJson);
  $<HTMLButtonElement>('exportTxtBtn').addEventListener('click', exportTxt);
  $<HTMLButtonElement>('importBtn').addEventListener('click', () => $<HTMLInputElement>('importFile').click());
  $<HTMLInputElement>('importFile').addEventListener('change', importRules);
  $<HTMLButtonElement>('clearHistoryBtn').addEventListener('click', clearHistory);
}

async function renderHistory(): Promise<void> {
  const history = await storage.getHistory();
  const table = $<HTMLElement>('historyTable');
  table.innerHTML = '';
  if (history.length === 0) {
    table.innerHTML = '<div class="hint">暂无历史记录</div>';
    return;
  }
  for (const h of history) {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <span class="h-handle">@${escapeHtml(h.handle)}</span>
      <span class="h-text" title="${escapeHtml(h.text)}">${escapeHtml(h.text.slice(0, 80))}</span>
      <span class="h-cat">${escapeHtml(categoryLabel(h.category as SpamCategory))}</span>
      <span class="h-time">${escapeHtml(formatTime(h.time))}</span>`;
    table.appendChild(row);
  }
}

function formatTime(t: number): string {
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  return `${Math.floor(hr / 24)}天前`;
}

async function exportJson(): Promise<void> {
  const rs = await storage.getRuleSet();
  const data = JSON.stringify({ user: rs.user, exportedAt: Date.now() }, null, 2);
  download(data, `tcfilter-rules-${new Date().toISOString().slice(0, 10)}.json`);
}

async function exportTxt(): Promise<void> {
  const rs = await storage.getRuleSet();
  const lines = [...rs.user, ...rs.builtin]
    .map((r) => (r.category ? `${r.value} #category=${r.category}` : r.value));
  download(lines.join('\n'), 'tcfilter-keywords.txt');
}

function download(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function importRules(): Promise<void> {
  const file = $<HTMLInputElement>('importFile').files?.[0];
  if (!file) return;
  const text = await file.text();
  const rs = await storage.getRuleSet();
  try {
    const parsed = JSON.parse(text) as { user?: Rule[] };
    if (parsed.user && Array.isArray(parsed.user)) {
      const existing = new Set(rs.user.map((r) => r.value));
      for (const r of parsed.user) {
        if (r.value && !existing.has(r.value)) {
          rs.user.push({ ...createRule({ value: r.value }), ...r, id: createRule({ value: '' }).id });
        }
      }
    }
  } catch {
    // 纯文本词库
    const rules = parseKeywords(text, 'user');
    const existing = new Set(rs.user.map((r) => r.value));
    for (const r of rules) {
      if (!existing.has(r.value)) rs.user.push(r);
    }
  }
  await storage.setRuleSet(rs);
  await renderKeywords();
  await renderSidebarInfo();
}

async function clearHistory(): Promise<void> {
  if (!confirm('清空所有历史记录？')) return;
  await chrome.storage.local.set({ 'tfc:history': [] });
  await renderHistory();
}

// ---- 工具 ----
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

void init();
