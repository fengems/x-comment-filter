/**
 * Background service worker。
 *
 * 职责（docs/02-技术方案.md、docs/03-AI集成方案.md）：
 *  - 定时同步云端词库（chrome.alarms + ETag 增量）
 *  - 定时 AI 规则挖掘（可选，opt-in）：可疑样本 → LLM → 候选规则
 *  - 右键菜单"添加到屏蔽词"
 *  - 接收 content script 消息：统计、历史、可疑样本入池、候选确认
 *  - 通知 content script 规则更新
 *
 * 核心逻辑（同步、挖掘、解析）都抽到 src/ 下做了单测，这里只做编排。
 */
import { syncCloudKeywords, DEFAULT_KEYWORDS_URL } from '../src/sync';
import { Storage } from '../src/storage';
import { STORAGE_KEYS } from '../src/settings/types';
import type { AiSettings } from '../src/settings/types';
import { parseKeywords } from '../src/rules/keywords';
import { createRule } from '../src/rules/types';
import { selectBackend, checkOrFallback } from '../src/ai/selector';
import { emptyResult, type MiningResult } from '../src/ai/backend';
import { toCandidates, pickBatch, processedFingerprints } from '../src/ai/miner';

const SYNC_ALARM = 'tfc-sync-keywords';
const MINE_ALARM = 'tfc-mine-rules';
const SYNC_INTERVAL_MIN = 360; // 6 小时

const storage = new Storage();

export default defineBackground(() => {
  // 安装：注册定时器
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_INTERVAL_MIN });
    scheduleMiningAlarm();
    void syncOnce();
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void syncOnce();
    else if (alarm.name === MINE_ALARM) void mineOnce();
  });

  // 右键菜单：选中文字 → 添加屏蔽词
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'tfc-add-keyword',
      title: '添加「%s」到 TCFilter 屏蔽词',
      contexts: ['selection'],
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId !== 'tfc-add-keyword') return;
    const text = info.selectionText?.trim();
    if (!text) return;
    const rs = await storage.getRuleSet();
    if (rs.user.some((r) => r.value === text)) return;
    rs.user.push(createRule({ type: 'keyword', value: text, source: 'user' }));
    await storage.setRuleSet(rs);
    notifyRulesUpdated();
  });

  // 消息路由
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    void handleMessage(msg).then(sendResponse);
    return true; // 异步响应
  });

  async function handleMessage(msg: { action: string; [k: string]: unknown }): Promise<Record<string, unknown>> {
    try {
      switch (msg.action) {
        case 'increment-stats':
          await storage.incrementStats(msg.category as string | undefined);
          return { ok: true };
        case 'add-history':
          await storage.addHistory(msg.item as Parameters<Storage['addHistory']>[0]);
          return { ok: true };
        case 'add-suspicious': {
          // content script 上报可疑样本
          const s = msg.sample as Parameters<Storage['addSuspicious']>[0];
          if (s) await storage.addSuspicious(s);
          return { ok: true };
        }
        case 'sync-now':
          await syncOnce();
          return { ok: true };
        case 'mine-now': {
          await mineOnce();
          return { ok: true };
        }
        case 'accept-candidate': {
          await storage.acceptCandidate(msg.value as string);
          notifyRulesUpdated();
          return { ok: true };
        }
        case 'reject-candidate': {
          await storage.rejectCandidate(msg.value as string, msg.fingerprint as string | undefined);
          return { ok: true };
        }
        case 'get-candidates': {
          // 直接返回候选，让 options 展示
          const candidates = await storage.getPendingCandidates();
          return { ok: true, candidates } as { ok: boolean; candidates: unknown };
        }
        case 'check-local': {
          // 检测本地后端可用性，给 options 展示
          const backend = msg.backend as string;
          const modelId = msg.modelId as string;
          if (backend === 'local-chrome') {
            const { ChromeAiBackend } = await import('../src/ai/chrome-ai');
            const ai = new ChromeAiBackend(globalThis);
            const avail = await ai.availability();
            return { available: avail.available, reason: avail.reason, needsDownload: avail.needsDownload };
          }
          if (backend === 'local-webllm') {
            await ensureOffscreen();
            const res = (await chrome.runtime.sendMessage({
              action: 'webllm-availability',
              modelId,
            })) as { availability?: { available: boolean; reason?: string; needsDownload?: boolean } };
            return res.availability ?? { available: false, reason: '检测失败' };
          }
          return { available: false, reason: '未知后端' };
        }
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    return { ok: false };
  }

  /** 根据用户 AI 设置调度挖掘定时器 */
  async function scheduleMiningAlarm(): Promise<void> {
    const ai = await storage.getAiSettings();
    if (ai.backend === 'none') {
      await chrome.alarms.clear(MINE_ALARM);
      return;
    }
    await chrome.alarms.clear(MINE_ALARM);
    chrome.alarms.create(MINE_ALARM, { periodInMinutes: ai.miningIntervalMin });
  }

  /** 执行一次云端词库同步 */
  async function syncOnce(): Promise<void> {
    try {
      const cloud = await storage.getCloudKeywords();
      const res = await syncCloudKeywords(
        fetch.bind(globalThis),
        DEFAULT_KEYWORDS_URL,
        cloud.etag,
      );
      if (res.updated && res.rules) {
        const rs = await storage.getRuleSet();
        rs.cloud = res.rules;
        await storage.setRuleSet(rs);
        await storage.setCloudKeywords('', res.etag ?? cloud.etag, `已更新 ${res.rules.length} 条`);
        notifyRulesUpdated();
      } else if (res.error) {
        await storage.setCloudKeywords(cloud.text, cloud.etag, res.error);
      } else {
        await storage.setCloudKeywords(cloud.text, cloud.etag, '最新');
      }
    } catch (e) {
      console.error('[TCFilter] 同步失败', e);
    }
  }

  /** 执行一次 AI 规则挖掘（统一路由：云/本地/Chrome 内置） */
  async function mineOnce(): Promise<void> {
    try {
      const ai = await storage.getAiSettings();
      if (ai.backend === 'none') return;

      const pool = await storage.getSuspiciousPool();
      if (pool.length === 0) return;
      const negatives = await storage.getNegatives();
      const batch = pickBatch(pool, negatives, ai.miningBatchSize);
      if (batch.length === 0) return;

      const inputs = batch.map((s) => ({ text: s.text, handle: s.handle }));

      // 根据后端类型路由：本地 webllm 走 offscreen，其余在 background 直接跑
      let result;
      if (ai.backend === 'local-webllm') {
        result = await mineViaOffscreen(ai, inputs);
      } else {
        const backend = selectBackend(ai, { fetcher: fetch.bind(globalThis) });
        const check = await checkOrFallback(backend);
        if (!check.ok) {
          console.warn('[TCFilter] 后端不可用，跳过挖掘：', check.reason);
          return;
        }
        result = await backend!.mine(inputs);
      }

      const existing = await storage.existingRuleIndex();
      const candidates = toCandidates(result, batch, { existing });

      // 入候选池待用户确认
      if (candidates.length > 0) {
        await storage.addCandidates(candidates);
      }

      // LLM 判定不是垃圾的样本 → 加负反馈，避免重复送检
      if (result.isNotSpam) {
        for (const s of batch) await storage.addNegative(s.fingerprint);
      }

      // 无论是否产生候选，已送检的批次从可疑池移除
      await storage.removeSuspicious(processedFingerprints(batch));
    } catch (e) {
      console.error('[TCFilter] 挖掘失败', e);
    }
  }

  /** 通过 offscreen document 跑 WebLLM 推理 */
  async function mineViaOffscreen(
    ai: AiSettings,
    inputs: { text: string; handle: string }[],
  ): Promise<MiningResult> {
    await ensureOffscreen();
    const res = (await chrome.runtime.sendMessage({
      action: 'webllm-mine',
      modelId: ai.localModel,
      samples: inputs,
    })) as { result?: MiningResult; error?: string };
    if (res.error) {
      console.warn('[TCFilter] offscreen 推理失败：', res.error);
      return emptyResult();
    }
    return res.result ?? emptyResult();
  }

  /** 确保 offscreen document 存在（WebLLM 推理环境） */
  async function ensureOffscreen(): Promise<void> {
    const existing = await chrome.offscreen
      .hasDocument()
      .catch(() => false);
    if (existing) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['WEBGPU' as chrome.offscreen.Reason],
      justification: '本地大模型推理（WebLLM 规则挖掘）',
    });
  }

  /** 通知所有 x.com 标签页重新加载规则 */
  function notifyRulesUpdated(): void {
    chrome.tabs.query({ url: ['*://*.twitter.com/*', '*://*.x.com/*'] }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { action: 'rules-updated' }).catch(() => {});
      }
    });
  }
});

export { STORAGE_KEYS, parseKeywords };
