# Twitter Comment Filter (TCFilter)

过滤推特/X 评论区垃圾信息（色情 bot、博彩广告、引流话术）的浏览器扩展。

**核心特色（调研市面 6 个同类产品后填补的空白）：**
- 🛡️ **折叠占位卡**：命中后不直接删除，显示"已屏蔽 N 条 [展开]"，可一键还原，永不破坏性删除
- 🎯 **多维规则引擎**：每条规则独立配置类型/匹配精度/作用域/白名单，避免"所有词共享全局开关"的扁平模型
- ✨ **词边界默认**：拉丁词用 `\b` 词边界（`sex` 不误伤 `Sussex`），根治同类扩展的子串误伤
- 🧹 **反绕过清洗**：去零宽字符、花体字归一化、全角转半角，对抗 `免\u200b费` 这类绕过
- 🔒 **本地优先**：默认零网络、零隐私顾虑；AI 智能规则挖掘为可选 opt-in
- ☁️ **GitHub 词库热更新**：零后端，改 `keywords.txt` 推送即热更新（ETag 增量同步）

## 快速开始

```bash
pnpm install          # 安装依赖
pnpm test             # 运行全部单测（149 个）
pnpm test:coverage    # 覆盖率报告
pnpm typecheck        # 类型检查
pnpm build            # 构建扩展到 .output/chrome-mv3/
pnpm dev              # 开发模式（HMR）
```

**加载到 Chrome**：`chrome://extensions` → 开启开发者模式 → 加载已解压扩展 → 选 `.output/chrome-mv3/` 目录。

## 架构

```
Content Script (注入 x.com)
  ObserverManager → DomExtractor → ContextDetector
       → RuleEngine (词边界/CJK/白名单) → ActionExecutor (折叠/隐藏/模糊)
       → CacheManager (指纹缓存防重复判定)
Background (service worker)
  词库定时同步(GitHub ETag) / 右键菜单加词 / 统计历史
Popup / Options (原生 DOM)
  设置/规则管理/白名单/导入导出/统计
```

**判定分层（详见 docs/03-AI集成方案.md）：**
- 实时层：规则引擎逐条判定（零成本）
- 智能层（可选）：可疑样本送大模型挖掘新规则 → 用户确认 → 回流规则库

## 核心模块（均有单测）

| 模块 | 职责 | 覆盖率 |
|---|---|---|
| `src/rules/sanitize.ts` | 反绕过文本清洗（零宽/花体/全角） | 100% |
| `src/rules/engine.ts` | 规则匹配（词边界/CJK/白名单/正则） | 100% |
| `src/rules/keywords.ts` | 词库解析（注释/标注/去重） | 100% |
| `src/dom/context.ts` | 评论区/Feed 判定、主推文豁免 | 100% |
| `src/dom/extractor.ts` | DOM 文本/用户名提取（多 selector 兜底） | 100% |
| `src/dom/action.ts` | 折叠占位卡（Shadow DOM）/隐藏/模糊 | 100% |
| `src/ai/suspicion.ts` | 可疑度评分（筛 AI 待复核样本） | 100% |
| `src/ai/backend.ts` | 挖掘后端统一接口 + 共享 prompt/解析 | 100% |
| `src/ai/cloud-client.ts` | 云端 LLM 后端（DeepSeek/OpenAI 兼容） | 100% |
| `src/ai/chrome-ai.ts` | Chrome 内置 AI 后端（Gemini Nano） | 98.5% |
| `src/ai/webllm.ts` | WebLLM 本地后端（WebGPU 开源模型） | 95.4% |
| `src/ai/miner.ts` | 规则挖掘器（样本→候选规则） | 100% |
| `src/ai/selector.ts` | 后端选择器 + 可用性检测 + 降级 | 97.9% |
| `src/storage.ts` | chrome.storage 封装（双通道/规则合并/候选池） | 85% |
| `src/sync.ts` | GitHub 词库同步（ETag 增量） | 100% |
| `src/pipeline.ts` | 编排：observer→cache→判定→动作 | 80% |

## 设计决策说明

**为什么 CJK 关键词不做词边界？** 中文没有空格分词，`\b` 对 CJK 无效，纯正则无法可靠分词。
单字"约"在"来约啊"该命中、在"约见"不该命中，正则无法区分。所以 CJK 退化为子串，
误伤防护靠 `whitelist` 例外词兜底（如规则"约"+`whitelist["约见","约束"]`）。
拉丁词保留真正的 `\b` 词边界（这是相比 xModerator 纯子串匹配的核心进步）。

**三种 AI 模式如何协作？** 大模型（本地或云端）不参与实时逐条判断（慢/卡/贵/隐私），
只做"规则挖掘"：后台采样可疑评论 → LLM 归纳新垃圾模式 → 提炼候选规则 → 用户确认 →
回流规则库 → 实时规则引擎立刻能过滤该类垃圾。三模式通过统一 `MiningBackend` 接口实现：
- 云端（DeepSeek/OpenAI）：最准，但上传文本
- Chrome 内置 AI（Gemini Nano）：零下载，但模型不可选、可用性受限
- WebLLM（Qwen 等）：本地隐私，但需下载模型 + WebGPU

详见 `docs/02-技术方案.md`、`docs/03-AI集成方案.md`。

## 文档

- [`docs/01-调研报告.md`](docs/01-调研报告.md) — 市面 6 个同类扩展的源码级分析
- [`docs/02-技术方案.md`](docs/02-技术方案.md) — 本项目技术方案（含抗改版策略）
- [`docs/03-AI集成方案.md`](docs/03-AI集成方案.md) — 三模式架构（规则/本地大模型/云端 AI）

## Roadmap

- ✅ Phase 1 MVP：纯规则过滤（已完成）
- ✅ Phase 2：云端 AI 规则挖掘闭环（DeepSeek/OpenAI opt-in，已完成）
- ✅ Phase 3：本地大模型（WebLLM offscreen + Chrome 内置 AI，已完成）

## License

MIT
