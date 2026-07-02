/**
 * 规则引擎类型定义。
 *
 * 设计目标：每个规则可独立配置类型/匹配精度/作用域/白名单，
 * 避免现有扩展"所有关键词共享全局开关"的扁平模型。
 *
 * 详见 docs/02-技术方案.md §4.4。
 */

/** 规则类型：决定 value 字段的语义和匹配对象 */
export type RuleType =
  | 'keyword' // 关键词（字面量，会转义）
  | 'regex' // 正则表达式（用户原始字符串）
  | 'username' // 用户名/handle 匹配
  | 'specialChars' // 花体字/异常 Unicode 结构特征
  | 'emoji' // emoji 特征
  | 'link'; // 外链/可疑域名

/** 匹配精度：决定关键词如何构造正则边界，影响误伤率 */
export type RuleMatch =
  | 'exact' // 精确相等（整条文本/用户名等于 value）
  | 'wordBoundary' // 词边界（拉丁字母用 \b，CJK 用前后非字母数字断言）
  | 'substring'; // 子串（任意位置包含，误伤率最高，谨慎用）

/** 作用域：规则在哪个页面场景生效 */
export type RuleScope = 'comment' | 'feed' | 'all';

/** 规则来源：用于设置页区分展示和导出 */
export type RuleSource = 'builtin' | 'user' | 'cloud' | 'ai-mined';

/** 垃圾类别：用于折叠卡的"疑似 XX"提示和统计 */
export type SpamCategory = 'porn' | 'gambling' | 'promo' | 'spam' | 'custom';

/**
 * 单条过滤规则。
 * 序列化进 chrome.storage，所以字段都用 JSON 友好的基本类型。
 */
export interface Rule {
  /** 稳定唯一 id（uuid 或 nanoid 风格字符串） */
  id: string;
  type: RuleType;
  /** 关键词 / 正则源 / 用户名 / 域名，语义随 type 变化 */
  value: string;
  /** 匹配精度，默认 wordBoundary。regex 类型忽略此字段 */
  match: RuleMatch;
  scope: RuleScope;
  enabled: boolean;
  source: RuleSource;
  /** 命中主规则但文本含例外词则放行（白名单豁免） */
  whitelist?: string[];
  category?: SpamCategory;
  createdAt: number;
  /** 可选：rule 上挂的启用/禁用开关已由 enabled 表达，extra 留作扩展字段 */
  note?: string;
}

/** 默认新规则的字段工厂 */
export function createRule(partial: Partial<Rule> & Pick<Rule, 'value'>): Rule {
  const now = Date.now();
  return {
    id: `rule_${now}_${Math.random().toString(36).slice(2, 9)}`,
    type: 'keyword',
    match: 'wordBoundary',
    scope: 'all',
    enabled: true,
    source: 'user',
    category: 'custom',
    createdAt: now,
    ...partial,
  };
}
