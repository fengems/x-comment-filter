/**
 * 后端选择器：根据 AiSettings 构造对应的 MiningBackend。
 *
 * 设计：把"选哪个后端"的逻辑集中一处，background 和单测都复用。
 * 后端实例本身依赖外部资源（fetch/LanguageModel/WebLLM 引擎），通过 deps 注入。
 */
import type { AiSettings } from '../settings/types';
import type { MiningBackend } from './backend';
import { CloudBackend, PROVIDER_ENDPOINTS, modelForProvider, type FetchLike } from './cloud-client';
import { ChromeAiBackend, type LanguageModelLike } from './chrome-ai';
import { WebllmBackend, type WebllmEngineLike, type WebgpuDetector } from './webllm';

/** 选择器需要的依赖（按需注入，未注入的后端不可用） */
export interface BackendDeps {
  fetcher?: FetchLike;
  languageModel?: LanguageModelLike;
  webllmEngine?: WebllmEngineLike;
  detectWebgpu?: WebgpuDetector;
  /** scope（Chrome AI 全局检测用，测试注入） */
  scope?: typeof globalThis;
}

/**
 * 根据设置构造后端。返回 null 表示关闭（backend === 'none'）。
 */
export function selectBackend(settings: AiSettings, deps: BackendDeps): MiningBackend | null {
  switch (settings.backend) {
    case 'none':
      return null;

    case 'cloud': {
      const endpoint =
        settings.cloudProvider === 'custom' && settings.cloudEndpoint
          ? settings.cloudEndpoint
          : PROVIDER_ENDPOINTS[settings.cloudProvider] ?? PROVIDER_ENDPOINTS.openai!;
      return new CloudBackend(
        {
          endpoint,
          apiKey: settings.cloudApiKey,
          model: modelForProvider(settings.cloudProvider),
          fetcher: deps.fetcher,
        },
        `cloud-${settings.cloudProvider}`,
      );
    }

    case 'local-chrome': {
      // 如果注入了 LanguageModel，构造带它的 scope；否则用全局
      if (deps.languageModel) {
        const scope = { LanguageModel: deps.languageModel } as unknown as typeof globalThis;
        return new ChromeAiBackend(scope);
      }
      return new ChromeAiBackend(deps.scope ?? globalThis);
    }

    case 'local-webllm': {
      const backend = new WebllmBackend({
        modelId: settings.localModel,
        detectWebgpu: deps.detectWebgpu,
      });
      if (deps.webllmEngine) backend.setEngine(deps.webllmEngine);
      return backend;
    }

    default:
      return null;
  }
}

/**
 * 尝试获取后端可用性，失败时返回降级建议。
 * 给 background 在挖掘前做检查，不可用则跳过并记录原因。
 */
export async function checkOrFallback(
  backend: MiningBackend | null,
): Promise<{ ok: boolean; reason?: string; needsDownload?: boolean }> {
  if (!backend) return { ok: false, reason: '未启用 AI 后端' };
  const avail = await backend.availability();
  if (avail.available) return { ok: true };
  return { ok: false, reason: avail.reason, needsDownload: avail.needsDownload };
}
