/**
 * Chrome 内置 AI 后端：通过 LanguageModel API 调用 Gemini Nano。
 *
 * 设计（docs/03-AI集成方案.md §二路线 A）：
 *  - 零下载（前提：用户已开启该功能并下载过模型）
 *  - 模型不可选（只有 Gemini Nano）
 *  - 不能假设可用：需 Chrome 新版 + 硬件达标 + 用户已下载模型 + 不在黑名单机型
 *  - 必须 availability() 检测 + 降级
 *
 * 实现要点：
 *  - LanguageModel 全局通过 ChromeAiGlobal 接口注入，便于单测（不依赖真实 chrome）
 *  - 流式生成：promptStreaming 返回 ReadableStream，逐块拼接
 *  - 'downloadable' 状态：提示用户需先下载模型（数百 MB），不自动触发
 *
 * 注意：此 API 仍在演进（前身 window.ai，现 LanguageModel），且仅在 Chrome 桌面稳定版
 * 逐步铺开。生产环境务必 availability() 检测，失败优雅降级到纯规则或云端。
 */
import type {
  MiningBackend,
  MiningInput,
  MiningResult,
  BackendAvailability,
} from './backend';
import { buildSystemPrompt, buildUserPrompt, parseMiningResult, emptyResult } from './backend';

/** availability() 的可能返回值 */
export type LanguageModelAvailability =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

/**
 * LanguageModel 全局的最小抽象（注入用，单测传假实现）。
 * 只定义我们用到的部分，避免和真实 TS DOM lib 类型耦合。
 */
export interface LanguageModelLike {
  availability(): Promise<LanguageModelAvailability>;
  create(options?: { initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[] }): Promise<LanguageModelSessionLike>;
}

export interface LanguageModelSessionLike {
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): ReadableStream<string>;
  destroy(): void;
}

/** 从 globalThis 取 LanguageModel（可能在 window 上，也可能在其它全局） */
export function getLanguageModelGlobal(scope: typeof globalThis): LanguageModelLike | undefined {
  // 真实环境：chrome 内置 AI 暴露为全局 LanguageModel
  return (scope as unknown as { LanguageModel?: LanguageModelLike }).LanguageModel;
}

/** Chrome 内置 AI 后端 */
export class ChromeAiBackend implements MiningBackend {
  readonly name = 'local-chrome';
  private lm: LanguageModelLike | undefined;

  constructor(private scope: typeof globalThis = globalThis) {
    this.lm = getLanguageModelGlobal(scope);
  }

  async availability(): Promise<BackendAvailability> {
    if (!this.lm) {
      return {
        available: false,
        reason: '当前浏览器不支持 Chrome 内置 AI（需 Chrome 138+ 桌面稳定版，且硬件达标）',
      };
    }
    const avail = await this.lm.availability().catch(() => 'unavailable' as LanguageModelAvailability);
    if (avail === 'available') return { available: true };
    if (avail === 'downloadable') {
      return {
        available: false,
        reason: '模型未下载，需先下载 Gemini Nano 模型（约数百 MB）',
        needsDownload: true,
      };
    }
    if (avail === 'downloading') {
      return { available: false, reason: '模型正在下载中，请稍候' };
    }
    return {
      available: false,
      reason: 'Chrome 内置 AI 在当前环境不可用（可能硬件不达标或机型不兼容）',
    };
  }

  async mine(samples: MiningInput[]): Promise<MiningResult> {
    if (!this.lm) return emptyResult();
    if (samples.length === 0) return emptyResult();

    const avail = await this.lm.availability().catch(() => 'unavailable' as LanguageModelAvailability);
    if (avail !== 'available') return emptyResult();

    let session: LanguageModelSessionLike | undefined;
    try {
      session = await this.lm.create({
        initialPrompts: [{ role: 'system', content: buildSystemPrompt() }],
      });
      const userMsg = buildUserPrompt(samples);
      const raw = await this.collectStreaming(session, userMsg);
      return parseMiningResult(raw);
    } catch (e) {
      console.warn('[TCFilter] Chrome AI 推理失败，降级返回空结果', e);
      return emptyResult();
    } finally {
      try {
        session?.destroy();
      } catch {
        /* ignore */
      }
    }
  }

  /** 收集流式输出为完整字符串 */
  private async collectStreaming(session: LanguageModelSessionLike, input: string): Promise<string> {
    const stream = session.promptStreaming(input);
    let result = '';
    // 兼容 ReadableStream<string> 的逐 chunk 拼接
    const reader = (stream as unknown as ReadableStream<unknown>).getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (typeof value === 'string') result += value;
    }
    return result;
  }
}
