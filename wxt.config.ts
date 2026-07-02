import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

// WXT 扩展配置：MV3，注入 x.com/twitter.com
// 参考 docs/02-技术方案.md §二技术栈选型
export default defineConfig({
  // 统一 @ 别名指向 src（让 entrypoints 和 src 都用 @/... 导入）
  // 通过 vite.resolve.alias 注入，WXT 与 Vite 都能解析
  vite: () => ({
    resolve: {
      alias: {
        '@': srcDir,
      },
    },
  }),
  manifest: {
    name: 'Twitter Comment Filter',
    short_name: 'TCFilter',
    description: '过滤推特/X 评论区色情 bot、博彩广告、引流垃圾信息，折叠占位、多维规则、可选 AI 规则挖掘。',
    version: '0.1.0',
    default_locale: 'zh_CN',
    permissions: ['storage', 'contextMenus', 'alarms'],
    // 不申请 twitter/x 的 host_permissions：content_scripts.matches 自动注入即可。
    // Mode 3 云端 AI 调用在 service worker / offscreen 里发起，host 由用户配置的 API 决定。
  },
  // 默认开发时校验更严格
  dev: {
    reloadCommand: false,
  },
});
