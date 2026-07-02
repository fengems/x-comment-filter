/**
 * WebLLM 后端：用 WebGPU 在浏览器内跑开源小模型（Qwen/Gemma 等）做规则挖掘。
 *
 * 设计（docs/03-AI集成方案.md §二路线 B）：
 *  - 模型可选（推荐 Qwen2.5-0.5B，中英好、体积小）
 *  - 完全本地、零云、零 API key
 *  - 需下载模型（几百 MB）、占内存、需 WebGPU
 *  - 真实推理在 offscreen document 里跑（MV3 service worker 不能用 WebGPU），
 *    background 通过消息与 offscreen 通信；本类封装"对 WebLLM 引擎的调用编排"
 *
 * 可测性：把 WebLLM 引擎抽象成 WebllmEngineLike 接口注入，单测不依赖真实 web-llm 包。
 * 真实 WebllmEngine 实现装在 offscreen document 里。
 */
import type {
  MiningBackend,
  MiningInput,
  MiningResult,
  BackendAvailability,
} from './backend';
import { buildSystemPrompt, buildUserPrompt, parseMiningResult, emptyResult } from './backend';

/** 模型 ID → 中文名（给 UI 展示） */
export const LOCAL_MODELS: Record<string, { name: string; sizeMb: number }> = {
  'qwen2.5-0.5b': { name: 'Qwen2.5 0.5B（推荐，中英）', sizeMb: 500 },
  'qwen3-0.6b': { name: 'Qwen3 0.6B', sizeMb: 600 },
  'gemma-270m': { name: 'Gemma 270M（最轻量）', sizeMb: 240 },
};

/** 默认模型 */
export const DEFAULT_LOCAL_MODEL = 'qwen2.5-0.5b';

/** chat completion 消息（对齐 OpenAI/web-llm 格式） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** WebLLM 引擎最小抽象（注入用，单测传假实现） */
export interface WebllmEngineLike {
  /** 加载模型，返回是否成功 */
  load(modelId: string, onProgress?: (ratio: number) => void): Promise<boolean>;
  /** 已加载的模型 id（未加载为 null） */
  loadedModel(): string | null;
  /** 跑一次 chat completion */
  chat(messages: ChatMessage[]): Promise<string>;
  /** 释放 */
  unload(): Promise<void>;
}

/** WebGPU 检测函数类型（注入用） */
export type WebgpuDetector = () => Promise<boolean>;

/** 默认 WebGPU 检测：检查 navigator.gpu */
export const defaultWebgpuDetector: WebgpuDetector = async () => {
  if (typeof navigator === 'undefined') return false;
  return 'gpu' in navigator;
};

/** WebLLM 后端配置 */
export interface WebllmConfig {
  /** 模型 id（LOCAL_MODELS 的 key） */
  modelId: string;
  /** 引擎实现（注入；真实环境由 offscreen 提供） */
  engine?: WebllmEngineLike;
  /** WebGPU 检测（注入） */
  detectWebgpu?: WebgpuDetector;
}

export class WebllmBackend implements MiningBackend {
  readonly name = 'local-webllm';
  private cfg: WebllmConfig;

  constructor(cfg: WebllmConfig) {
    this.cfg = cfg;
  }

  /** 注入新引擎（offscreen 加载后由 background 注入） */
  setEngine(engine: WebllmEngineLike): void {
    this.cfg.engine = engine;
  }

  async availability(): Promise<BackendAvailability> {
    if (!this.cfg.engine) {
      return { available: false, reason: '本地推理引擎未就绪（offscreen 未加载）' };
    }
    if (!LOCAL_MODELS[this.cfg.modelId]) {
      return { available: false, reason: `未知模型：${this.cfg.modelId}` };
    }
    const detect = this.cfg.detectWebgpu ?? defaultWebgpuDetector;
    const hasWebgpu = await detect();
    if (!hasWebgpu) {
      return { available: false, reason: '当前浏览器不支持 WebGPU（需 Chrome 113+ 或兼容浏览器）' };
    }
    // 引擎已加载该模型才算就绪
    if (this.cfg.engine.loadedModel() === this.cfg.modelId) {
      return { available: true };
    }
    const meta = LOCAL_MODELS[this.cfg.modelId]!;
    return {
      available: false,
      reason: `模型未加载（${meta.name}，约 ${meta.sizeMb}MB，需下载）`,
      needsDownload: true,
    };
  }

  async mine(samples: MiningInput[]): Promise<MiningResult> {
    if (!this.cfg.engine) return emptyResult();
    if (samples.length === 0) return emptyResult();

    const engine = this.cfg.engine;
    // 确保模型已加载
    if (engine.loadedModel() !== this.cfg.modelId) {
      const ok = await engine.load(this.cfg.modelId).catch(() => false);
      if (!ok) {
        console.warn('[TCFilter] WebLLM 模型加载失败，降级返回空结果');
        return emptyResult();
      }
    }

    try {
      const reply = await engine.chat([
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(samples) },
      ]);
      return parseMiningResult(reply);
    } catch (e) {
      console.warn('[TCFilter] WebLLM 推理失败，降级返回空结果', e);
      return emptyResult();
    }
  }
}
