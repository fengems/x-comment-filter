/**
 * Offscreen document：WebLLM 推理环境。
 *
 * 为什么需要 offscreen：MV3 service worker 不能用 WebGPU，且生命周期受限。
 * 本地大模型推理必须在持久 DOM document 里跑，background 通过消息触发。
 *
 * WebLLM 引擎通过动态 import 加载（web-llm 是大依赖，避免打进主包）。
 * 引擎适配 WebllmEngineLike 接口，复用 src/ai/webllm.ts 的 WebllmBackend。
 */
import { WebllmBackend, type WebllmEngineLike, type ChatMessage } from '../../src/ai/webllm';
import { buildSystemPrompt, buildUserPrompt, parseMiningResult } from '../../src/ai/backend';
import type { MiningInput, MiningResult } from '../../src/ai/backend';

let enginePromise: Promise<WebllmEngineLike | null> | null = null;
let currentModel: string | null = null;

/** 动态加载 web-llm 引擎（首次调用时） */
async function getEngine(): Promise<WebllmEngineLike | null> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    try {
      // 动态 import，避免 web-llm 打进主 background 包
      const webllm = await import('@mlc-ai/web-llm');
      // 懒创建引擎：load 时才用 CreateMLCEngine(modelId)（web-llm 要求首参即 modelId）
      let mlcEngine: Awaited<ReturnType<typeof webllm.CreateMLCEngine>> | null = null;
      const engine: WebllmEngineLike = {
        async load(modelId, onProgress) {
          try {
            // 模型变更时先卸载旧引擎
            if (mlcEngine) {
              await mlcEngine.unload().catch(() => {});
              mlcEngine = null;
            }
            mlcEngine = await webllm.CreateMLCEngine(
              mapModelId(modelId),
              {
                initProgressCallback: (report: { progress: number }) =>
                  onProgress?.(report.progress),
              },
            );
            currentModel = modelId;
            return true;
          } catch {
            return false;
          }
        },
        loadedModel: () => currentModel,
        async chat(messages: ChatMessage[]) {
          if (!mlcEngine) throw new Error('引擎未加载');
          const reply = await mlcEngine.chat.completions.create({
            messages,
            temperature: 0,
          });
          return reply.choices[0]?.message?.content ?? '';
        },
        async unload() {
          if (mlcEngine) {
            await mlcEngine.unload();
            mlcEngine = null;
          }
          currentModel = null;
        },
      };
      return engine;
    } catch (e) {
      console.warn('[TCFilter] web-llm 加载失败', e);
      return null;
    }
  })();
  return enginePromise;
}

/** 我们的 modelId → web-llm 的模型标识 */
function mapModelId(id: string): string {
  const map: Record<string, string> = {
    'qwen2.5-0.5b': 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    'qwen3-0.6b': 'Qwen3-0.6B-q4f16_1-MLC',
    'gemma-270m': 'gemma-2-2b-it-q4f16_1-MLC',
  };
  return map[id] ?? id;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  void handle(msg).then(sendResponse);
  return true;
});

async function handle(msg: { action: string; [k: string]: unknown }): Promise<{
  result?: MiningResult;
  availability?: { available: boolean; reason?: string; needsDownload?: boolean };
  error?: string;
}> {
  if (msg.action === 'webllm-availability') {
    const engine = await getEngine();
    const backend = new WebllmBackend({
      modelId: msg.modelId as string,
      engine: engine ?? undefined,
    });
    const avail = await backend.availability();
    return { availability: avail };
  }

  if (msg.action === 'webllm-mine') {
    const engine = await getEngine();
    if (!engine) return { error: 'web-llm 加载失败' };
    const backend = new WebllmBackend({ modelId: msg.modelId as string, engine });
    const samples = msg.samples as MiningInput[];
    try {
      const result = await backend.mine(samples);
      return { result };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return {};
}

// 保持 parseMiningResult/buildSystemPrompt 引用避免 tree-shake 误删（offscreen 也可直接用）
void parseMiningResult;
void buildSystemPrompt;
void buildUserPrompt;
