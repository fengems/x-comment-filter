/**
 * 用户设置与存储键定义。
 *
 * 存储分两通道（参考 docs/01-调研报告.md §2.7）：
 *  - sync：小配置跨设备同步（注意 100KB 配额）
 *  - local：大数据、统计、设备本地
 * 统一 key 命名前缀 tfc:，杜绝 xModerator 那种前后端 key 不一致 bug。
 *
 * 详见 docs/02-技术方案.md §4.9。
 */
import type { Rule } from '../rules/types';

/** chrome.storage 的命名空间 key 前缀 */
export const STORAGE_KEYS = {
  /** 用户设置（sync，跨设备） */
  SETTINGS: 'tfc:settings',
  /** AI 设置（local：含 API key，不随 sync 跨设备以免泄露） */
  AI_SETTINGS: 'tfc:aiSettings',
  /** 全部规则合并集（local：内置 + 用户 + 云端 + AI 挖掘） */
  RULES: 'tfc:rules',
  /** 云端词库原始文本（local） */
  CLOUD_KEYWORDS: 'tfc:cloudKeywords',
  /** 云端词库 ETag，做增量同步（local） */
  CLOUD_ETAG: 'tfc:cloudEtag',
  /** 上次同步时间戳（local） */
  LAST_SYNC: 'tfc:lastSync',
  /** 同步状态文案 / 错误（local） */
  SYNC_STATUS: 'tfc:syncStatus',
  /** 统计计数（local） */
  STATS: 'tfc:stats',
  /** 命中历史记录，最近 N 条（local） */
  HISTORY: 'tfc:history',
  /** 可疑样本待复核池（local，滚动截断） */
  SUSPICIOUS_POOL: 'tfc:suspiciousPool',
  /** AI 挖掘出的候选规则（待用户确认，local） */
  CANDIDATE_RULES: 'tfc:candidateRules',
  /** 负反馈：用户判定为非垃圾的样本指纹，避免重复送检（local） */
  NEGATIVE_SAMPLES: 'tfc:negativeSamples',
  /** 当前页面过滤计数（session：content 写、popup 读，浏览器关闭即清） */
  PAGE_STATS: 'tfc:pageStats',
} as const;

/** 作用范围：只过滤评论，还是评论+Feed 都过滤 */
export type FilterScope = 'comments' | 'all';

/** 智能层后端选择（见 docs/03-AI集成方案.md） */
export type AiBackend = 'none' | 'local-chrome' | 'local-webllm' | 'cloud';

/** 屏蔽动作类型：命中后怎么处理 */
export type BlockAction = 'fold' | 'hide' | 'blur';

interface SettingsShape {
  /** 总开关 */
  enabled: boolean;
  /** 过滤范围 */
  scope: FilterScope;
  /** 命中动作：折叠占位卡 / 直接隐藏 / 模糊 */
  action: BlockAction;
  /** 同时过滤用户名（全局开关） */
  checkUsername: boolean;
  /** 屏蔽花体字/异常 Unicode */
  blockSpecialChars: boolean;
  /** 屏蔽带 emoji 的短文（误伤较高，默认关） */
  blockEmojiShort: boolean;
  /** 全局白名单 handle，永不过滤 */
  whitelistUsers: string[];
  /** dry-run：只标记不实际折叠，观察期使用 */
  dryRun: boolean;
  /** 开启调试日志 */
  debug: boolean;
}

/** 默认设置：开箱即用、零隐私、保守防误伤 */
export const DEFAULT_SETTINGS: SettingsShape = {
  enabled: true,
  scope: 'comments',
  action: 'fold',
  checkUsername: true,
  blockSpecialChars: true,
  blockEmojiShort: false,
  whitelistUsers: [],
  dryRun: false,
  debug: false,
};

export type Settings = SettingsShape;

interface AiSettingsShape {
  /** 智能层后端 */
  backend: AiBackend;
  /** 本地模型选择 */
  localModel: 'qwen2.5-0.5b' | 'qwen3-0.6b' | 'gemma-270m' | 'chrome-nano';
  /** 云端 provider */
  cloudProvider: 'deepseek' | 'openai' | 'custom';
  /** 云端 API key（仅本地存，永不随规则上传） */
  cloudApiKey: string;
  /** 自定义云端 endpoint（custom 用） */
  cloudEndpoint: string;
  /** 规则挖掘间隔（分钟） */
  miningIntervalMin: number;
  /** 每批送检样本数 */
  miningBatchSize: number;
  /** 可疑分阈值，达标才进待复核池 */
  suspicionThreshold: number;
}

/** AI 设置默认：纯规则，零网络 */
export const DEFAULT_AI_SETTINGS: AiSettingsShape = {
  backend: 'none',
  localModel: 'qwen2.5-0.5b',
  cloudProvider: 'deepseek',
  cloudApiKey: '',
  cloudEndpoint: '',
  miningIntervalMin: 30,
  miningBatchSize: 20,
  suspicionThreshold: 0.5,
};

export type AiSettings = AiSettingsShape;

/** 命中历史单条记录 */
export interface HistoryItem {
  user: string;
  handle: string;
  text: string;
  reason: string;
  category?: string;
  ruleIds: string[];
  time: number;
}

interface StatsShape {
  totalBlocked: number;
  /** 今日屏蔽数（按日期重置） */
  todayBlocked: number;
  /** 上次重置 todayBlocked 的日期（YYYY-MM-DD） */
  todayDate: string;
  byCategory: Record<string, number>;
}

export const DEFAULT_STATS: StatsShape = {
  totalBlocked: 0,
  todayBlocked: 0,
  todayDate: '',
  byCategory: {},
};

export type Stats = StatsShape;

/** 规则集（存储容器，含来源分组以便设置页展示） */
export interface RuleSet {
  /** 用户自定义规则 */
  user: Rule[];
  /** 内置规则（随版本） */
  builtin: Rule[];
  /** 云端词库规则 */
  cloud: Rule[];
  /** AI 挖掘规则（用户已采纳） */
  aiMined: Rule[];
}

export const EMPTY_RULE_SET: RuleSet = {
  user: [],
  builtin: [],
  cloud: [],
  aiMined: [],
};

/**
 * 可疑样本：规则未命中但可疑分达标，待送大模型挖掘。
 * 进入 suspiciousPool，被挖掘后移除。
 */
export interface SuspiciousSample {
  /** 归一化指纹（去空白/小写后的文本片段），用于去重 */
  fingerprint: string;
  text: string;
  handle: string;
  suspicion: number;
  time: number;
}

/**
 * AI 挖掘出的候选规则（待用户确认）。
 * 来自大模型对一批可疑样本的归纳，不自动生效。
 */
export interface CandidateRule {
  /** 规则内容（与 Rule 同构，但 source 固定为 'ai-mined'，enabled 待确认） */
  rule: Rule;
  /** 大模型给的置信度 0~1 */
  confidence: number;
  /** 大模型给的理由/摘要 */
  reason: string;
  /** 这条候选规则能命中的样本数（来自挖掘批） */
  evidenceCount: number;
  /** 命中的样本示例（最多 N 条，供用户参考） */
  examples: string[];
  /** 创建时间 */
  createdAt: number;
  /** 状态：pending 待确认 / accepted 已采纳 / rejected 已拒绝 */
  status: 'pending' | 'accepted' | 'rejected';
}

/** 可疑样本池滚动上限（防内存膨胀） */
export const MAX_SUSPICIOUS_POOL = 500;
/** 候选规则滚动上限 */
export const MAX_CANDIDATES = 100;
/** 负反馈样本指纹滚动上限 */
export const MAX_NEGATIVES = 1000;

/**
 * 当前页面过滤计数（session 存储）。
 * content script 过滤时累加，SPA 切页清零；popup 打开时读取展示"正在保护"。
 */
export interface PageStats {
  /** 当前页面 URL（切换时由 content 重置） */
  url: string;
  /** 本页过滤总数 */
  count: number;
  /** 按类别的本页计数 */
  byCategory: Record<string, number>;
}

export const EMPTY_PAGE_STATS: PageStats = {
  url: '',
  count: 0,
  byCategory: {},
};
