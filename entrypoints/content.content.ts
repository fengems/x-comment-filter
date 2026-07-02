/**
 * Content script：注入到 x.com / twitter.com 页面。
 *
 * 编排（docs/02-技术方案.md §五）：
 *  1. 加载内置词库 + 用户/云端规则
 *  2. 构造 FilterPipeline
 *  3. 启动 ObserverManager 监听 DOM
 *  4. 监听 background 消息（规则更新）→ 重新加载规则
 *  5. 命中时上报统计/历史到 background
 *
 * 核心逻辑全在 src/ 下做了单测，这里只做依赖注入和编排。
 */
import { FilterPipeline } from '../src/pipeline';
import { Storage } from '../src/storage';
import { parseKeywords } from '../src/rules/keywords';

const BUILTIN_KEYWORDS_URL = chrome.runtime.getURL('/keywords.txt');

export default defineContentScript({
  matches: ['*://*.twitter.com/*', '*://*.x.com/*'],
  runAt: 'document_idle',
  async main() {
    const storage = new Storage();

    // 1. 加载设置和规则
    const settings = await storage.getSettings();
    const rules = await loadAllRules(storage);

    // 2. 构造管线
    const pipeline = new FilterPipeline(settings, {
      onBlocked: (item) => {
        // 上报统计和历史到 background（fire-and-forget）
        void chrome.runtime.sendMessage({
          action: 'increment-stats',
          category: item.category,
        });
        void chrome.runtime.sendMessage({
          action: 'add-history',
          item: { ...item, time: Date.now() },
        });
        // 本页过滤计数（session 存储，popup 读取展示"正在保护"）
        void storage.incrementPageStats(location.href, item.category).catch(() => {});
      },
      onSuspicious: (data) => {
        // 上报可疑样本到 background，入待复核池（供 AI 规则挖掘）
        const fingerprint = data.text.replace(/\s+/g, '').toLowerCase().slice(0, 100);
        void chrome.runtime.sendMessage({
          action: 'add-suspicious',
          sample: {
            fingerprint,
            text: data.text,
            handle: data.handle,
            suspicion: data.suspicion,
            time: Date.now(),
          },
        });
      },
      log: (...args) => console.log('[TCFilter]', ...args),
    });
    pipeline.updateRules(rules);

    // 3. 启动观察
    pipeline.start();

    // 4. 监听规则更新消息
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.action === 'rules-updated') {
        void reloadRules();
        sendResponse({ ok: true });
      }
      return true;
    });

    // 5. 监听设置变化（实时响应设置页改动）
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[STORAGE_KEY_SETTINGS]) {
        pipeline.updateSettings(changes[STORAGE_KEY_SETTINGS].newValue);
      }
      if (area === 'local' && changes[STORAGE_KEY_RULES]) {
        void reloadRules();
      }
    });

    async function reloadRules(): Promise<void> {
      const newRules = await loadAllRules(storage);
      pipeline.updateRules(newRules);
    }
  },
});

/** 聚合加载所有来源规则：内置 + 用户 + 云端 + AI挖掘 */
async function loadAllRules(storage: Storage) {
  const [builtinText, rs] = await Promise.all([
    fetch(BUILTIN_KEYWORDS_URL).then((r) => r.text()).catch(() => ''),
    storage.getRuleSet(),
  ]);
  const builtin = parseKeywords(builtinText, 'builtin');
  return [...builtin, ...rs.user, ...rs.cloud, ...rs.aiMined];
}

// storage key 常量（避免循环导入直接内联）
const STORAGE_KEY_SETTINGS = 'tfc:settings';
const STORAGE_KEY_RULES = 'tfc:rules';
