/**
 * Zustand Store — 多Agent智作中枢状态管理
 * HTTP 5s 轮询，无 WebSocket
 */

import { create } from 'zustand';
import { applyLocale, detectLocale, formatRelativeTime, persistLocale, type Locale } from './i18n';
import {
  api,
  type Task,
  type LiveStatus,
  type AgentConfig,
  type AgentsOverviewData,
  type AgentsStatusData,
  type SearchBrief,
  type SubConfig,
  type ChangeLogEntry,
  type SchedulerInfo,
} from './api';

// ── Pipeline Definition (PIPE) ──

export const PIPE = [
  { key: 'Inbox',         dept: '任务入口',   deptEn: 'Inbox',              icon: '🗂️', action: '提交', actionEn: 'Submit' },
  { key: 'ControlCenter', dept: '总控中心',   deptEn: 'Control Center',     icon: '🎛️', action: '统筹', actionEn: 'Coordinate' },
  { key: 'PlanCenter',    dept: '规划中心',   deptEn: 'Plan Center',        icon: '🧭', action: '规划', actionEn: 'Plan' },
  { key: 'ReviewCenter',  dept: '评审中心',   deptEn: 'Review Center',      icon: '🔍', action: '核验', actionEn: 'Review' },
  { key: 'Assigned',      dept: '调度中心',   deptEn: 'Dispatch Center',    icon: '📮', action: '派发', actionEn: 'Dispatch' },
  { key: 'Doing',         dept: '专业执行组', deptEn: 'Execution Team',     icon: '⚙️', action: '执行', actionEn: 'Execute' },
  { key: 'Review',        dept: '调度中心',   deptEn: 'Dispatch Center',    icon: '🧾', action: '汇总', actionEn: 'Summarize' },
  { key: 'Done',          dept: '结果归档',   deptEn: 'Result Archive',     icon: '✅', action: '归档', actionEn: 'Archive' },
] as const;

export const PIPE_STATE_IDX: Record<string, number> = {
  Inbox: 0, Pending: 0, ControlCenter: 1, PlanCenter: 2, ReviewCenter: 3,
  Assigned: 4, Doing: 5, Review: 6, Done: 7, Blocked: 5, Cancelled: 5, Next: 4,
};

export const AGENT_ARCHITECTURE = {
  control_center: {
    label: '总控中心',
    labelEn: 'Control Center',
    role: '全局统筹中心',
    roleEn: 'Global Orchestration Hub',
    rank: '核心中枢',
    rankEn: 'Core Hub',
    emoji: '🎛️',
    color: '#e8a040',
  },
  plan_center: {
    label: '规划中心',
    labelEn: 'Plan Center',
    role: '任务规划中心',
    roleEn: 'Task Planning Center',
    rank: '核心节点',
    rankEn: 'Core Node',
    emoji: '🧭',
    color: '#a07aff',
  },
  review_center: {
    label: '评审中心',
    labelEn: 'Review Center',
    role: '质量评审中心',
    roleEn: 'Quality Review Center',
    rank: '核心节点',
    rankEn: 'Core Node',
    emoji: '🔍',
    color: '#6a9eff',
  },
  dispatch_center: {
    label: '调度中心',
    labelEn: 'Dispatch Center',
    role: '调度协同中心',
    roleEn: 'Dispatch Coordination Center',
    rank: '核心节点',
    rankEn: 'Core Node',
    emoji: '📮',
    color: '#6aef9a',
  },
  docs_specialist: {
    label: '文案专家',
    labelEn: 'Docs Specialist',
    role: '内容文档专家',
    roleEn: 'Content Documentation Specialist',
    rank: '专业执行组',
    rankEn: 'Execution Team',
    emoji: '📝',
    color: '#f5c842',
  },
  data_specialist: {
    label: '数据专家',
    labelEn: 'Data Specialist',
    role: '数据分析专家',
    roleEn: 'Data Analysis Specialist',
    rank: '专业执行组',
    rankEn: 'Execution Team',
    emoji: '💰',
    color: '#ff9a6a',
  },
  code_specialist: {
    label: '代码专家',
    labelEn: 'Code Specialist',
    role: '工程实现专家',
    roleEn: 'Engineering Implementation Specialist',
    rank: '专业执行组',
    rankEn: 'Execution Team',
    emoji: '⚔️',
    color: '#44aaff',
  },
  audit_specialist: {
    label: '审计专家',
    labelEn: 'Audit Specialist',
    role: '审计审核专家',
    roleEn: 'Audit Review Specialist',
    rank: '专业执行组',
    rankEn: 'Execution Team',
    emoji: '⚖️',
    color: '#cc4444',
  },
  deploy_specialist: {
    label: '部署专家',
    labelEn: 'Deploy Specialist',
    role: '部署运维专家',
    roleEn: 'Deployment Operations Specialist',
    rank: '专业执行组',
    rankEn: 'Execution Team',
    emoji: '🔧',
    color: '#ff5270',
  },
  admin_specialist: {
    label: '管理专家',
    labelEn: 'Admin Specialist',
    role: '系统管理专家',
    roleEn: 'System Administration Specialist',
    rank: '专业执行组',
    rankEn: 'Execution Team',
    emoji: '👔',
    color: '#9b59b6',
  },
  search_specialist: {
    label: '搜索专家',
    labelEn: 'Search Specialist',
    role: '全网搜索专家',
    roleEn: 'Web Search Specialist',
    rank: '支撑能力',
    rankEn: 'Support Function',
    emoji: '🌐',
    color: '#36cfc9',
  },
} as const;

export type AgentArchitectureId = keyof typeof AGENT_ARCHITECTURE;

export const DEPT_COLOR: Record<string, string> = {
  '任务入口': '#ffd700',
  '专业执行组': '#44aaff',
  '结果归档': '#2ecc8a',
  ...Object.fromEntries(
    Object.values(AGENT_ARCHITECTURE).map((meta) => [meta.label, meta.color])
  ),
};

export const AGENT_LABEL_TO_ID: Record<string, AgentArchitectureId> = Object.fromEntries(
  Object.entries(AGENT_ARCHITECTURE).flatMap(([id, meta]) => [
    [id, id],
    [meta.label, id],
    [meta.labelEn, id],
    [meta.role, id],
    [meta.roleEn, id],
  ])
) as Record<string, AgentArchitectureId>;

export function agentMetaById(id: string) {
  return AGENT_ARCHITECTURE[id as AgentArchitectureId];
}

export function agentMetaByLabel(label: string) {
  const id = AGENT_LABEL_TO_ID[label];
  return id ? AGENT_ARCHITECTURE[id] : undefined;
}

export function normalizeAgentId(input: string): string {
  if (!input) return input;
  return AGENT_LABEL_TO_ID[input] || input;
}

export function normalizeDeptLabel(label: string): string {
  if (!label) return label;
  const meta = agentMetaByLabel(label) || agentMetaById(label);
  return meta?.label || label;
}

export function deptMeta(input: string, locale: Locale = 'zh') {
  const meta = agentMetaByLabel(input) || agentMetaById(input);
  if (!meta) {
    return {
      id: input,
      label: input,
      role: input,
      rank: '',
      emoji: '🧩',
      color: '#6a9eff',
    };
  }
  return {
    id: normalizeAgentId(input),
    label: locale === 'en' ? meta.labelEn : meta.label,
    role: locale === 'en' ? meta.roleEn : meta.role,
    rank: locale === 'en' ? meta.rankEn : meta.rank,
    emoji: meta.emoji,
    color: meta.color,
  };
}

export function deptMetaZh(id: string) {
  const meta = agentMetaById(id);
  if (!meta) return undefined;
  return { label: meta.label, role: meta.role, rank: meta.rank, emoji: meta.emoji, color: meta.color };
}

export function deptMetaEn(id: string) {
  const meta = agentMetaById(id);
  if (!meta) return undefined;
  return { label: meta.labelEn, role: meta.roleEn, rank: meta.rankEn, emoji: meta.emoji, color: meta.color };
}

export function deptColor(d: string): string {
  return deptMeta(d).color;
}

export function normalizeFlowRemark(text: string): string {
  if (!text) return text;
  return text
    .replace(/结果报告/g, '结果归档')
    .replace(/Result report/g, 'Result archive')
    .replace(/Agent管理专家/g, '管理专家')
    .replace(/全网搜索简报/g, '全网搜索简报');
}

export const DEPTS = Object.entries(AGENT_ARCHITECTURE).map(([id, meta]) => ({
  id,
  label: meta.label,
  emoji: meta.emoji,
  role: meta.role,
  rank: meta.rank,
}));

export const DEPT_ALIAS: Record<string, string> = Object.fromEntries(
  Object.entries(AGENT_ARCHITECTURE).flatMap(([id, meta]) => [
    [id, meta.label],
    [meta.label, meta.label],
    [meta.role, meta.label],
  ])
);

export function normalizeDeptLabelLegacySafe(label: string): string {
  return normalizeDeptLabel(label);
}


export const STATE_LABEL: Record<string, string> = {
  Inbox: '待受理',
  Pending: '待处理',
  ControlCenter: '总控处理中',
  PlanCenter: '规划处理中',
  ReviewCenter: '评审处理中',
  Assigned: '已派发',
  Doing: '执行中',
  Review: '汇总复核中',
  Done: '已交付',
  Blocked: '阻塞',
  Cancelled: '已取消',
  Next: '待执行',
};


export function stateLabel(t: Task, locale: Locale = 'zh'): string {
  const r = t.review_round || 0;
  if (locale === 'en') {
    if (t.state === 'ReviewCenter' && r > 1) return `Review Round ${r}`;
    if (t.state === 'PlanCenter' && r > 0) return `Plan Revision ${r}`;
    return STATE_LABEL_EN[t.state] || t.state;
  }
  if (t.state === 'ReviewCenter' && r > 1) return `评审复核（第${r}轮）`;
  if (t.state === 'PlanCenter' && r > 0) return `规划修订（第${r}轮）`;
  return STATE_LABEL[t.state] || t.state;
}

export const STATE_LABEL_EN: Record<string, string> = {
  Inbox: 'Queued',
  Pending: 'Pending',
  ControlCenter: 'Under Control Review',
  PlanCenter: 'Planning',
  ReviewCenter: 'Reviewing',
  Assigned: 'Assigned',
  Doing: 'In Progress',
  Review: 'Final Review',
  Done: 'Delivered',
  Blocked: 'Blocked',
  Cancelled: 'Cancelled',
  Next: 'Up Next',
};

export function isEdict(t: Task): boolean {
  return /^JJC-/i.test(t.id || '');
}

export function isSession(t: Task): boolean {
  return /^(OC-|MC-)/i.test(t.id || '');
}

export function isArchived(t: Task): boolean {
  return !!t.archived;
}

export type PipeStatus = { key: string; dept: string; icon: string; action: string; status: 'done' | 'active' | 'pending' };

export function getPipeStatus(t: Task, locale: Locale = 'zh'): PipeStatus[] {
  const stateIdx = PIPE_STATE_IDX[t.state] ?? 4;
  return PIPE.map((stage, i) => ({
    key: stage.key,
    icon: stage.icon,
    dept: locale === 'en' ? stage.deptEn : stage.dept,
    action: locale === 'en' ? stage.actionEn : stage.action,
    status: (i < stateIdx ? 'done' : i === stateIdx ? 'active' : 'pending') as 'done' | 'active' | 'pending',
  }));
}

export function getTaskScheduler(t: Task): SchedulerInfo | undefined {
  return (t as Task & { _scheduler?: SchedulerInfo })._scheduler;
}

export function getSchedulerSummary(t: Task, locale: Locale = 'zh'): { tone: 'ok' | 'warn' | 'danger' | 'muted'; icon: string; label: string; detail: string } {
  const sched = getTaskScheduler(t);
  if (!sched) {
    return locale === 'en'
      ? { tone: 'muted', icon: '🧭', label: 'Not Configured', detail: 'Task-level automation is not configured yet' }
      : { tone: 'muted', icon: '🧭', label: '未配置', detail: '尚未生成任务级自动化配置' };
  }
  if (sched.enabled === false) {
    return locale === 'en'
      ? { tone: 'muted', icon: '⏸', label: 'Manual Control', detail: 'Automation is disabled for this task' }
      : { tone: 'muted', icon: '⏸', label: '人工托管', detail: '已关闭自动托管' };
  }
  const escalationLevel = Number(sched.escalationLevel || 0);
  const retryCount = Number(sched.retryCount || 0);
  const maxRetry = Number(sched.maxRetry ?? 2);
  const rollbackCount = Number(sched.rollbackCount || 0);
  const maxRollback = Number(sched.maxRollback ?? 3);
  const status = String(sched.lastDispatchStatus || 'idle');

  if (rollbackCount > 0) {
    return locale === 'en'
      ? {
          tone: 'danger',
          icon: '↩️',
          label: 'Rolled Back',
          detail: `Rollback triggered ${rollbackCount}/${maxRollback} time(s)`,
        }
      : {
          tone: 'danger',
          icon: '↩️',
          label: '已回滚',
          detail: `已触发回滚 ${rollbackCount}/${maxRollback} 次`,
        };
  }
  if (escalationLevel > 0) {
    return locale === 'en'
      ? {
          tone: 'danger',
          icon: '📣',
          label: escalationLevel === 1 ? 'Escalated to Review' : 'Escalated to Dispatch',
          detail: escalationLevel === 1 ? 'Escalated to review center for coordination' : 'Escalated to dispatch center for coordination',
        }
      : {
          tone: 'danger',
          icon: '📣',
          label: escalationLevel === 1 ? '升级评审' : '升级调度',
          detail: escalationLevel === 1 ? '已升级到评审中心协调' : '已升级到调度中心协调',
        };
  }
  if (retryCount > 0) {
    return locale === 'en'
      ? {
          tone: 'warn',
          icon: '🔁',
          label: 'Retrying',
          detail: `Auto retried ${retryCount}/${maxRetry} time(s)`,
        }
      : {
          tone: 'warn',
          icon: '🔁',
          label: '自动重试中',
          detail: `已自动重试 ${retryCount}/${maxRetry} 次`,
        };
  }
  if (status && status !== 'idle') {
    return locale === 'en'
      ? {
          tone: 'ok',
          icon: '⚙️',
          label: 'Automation Active',
          detail: `Last dispatch status: ${status}`,
        }
      : {
          tone: 'ok',
          icon: '⚙️',
          label: '自动托管中',
          detail: `最近派发状态：${status}`,
        };
  }
  return locale === 'en'
    ? {
        tone: 'ok',
        icon: '🟢',
        label: 'Automation Healthy',
        detail: `Stall threshold ${Number(sched.stallThresholdSec || 600)} sec`,
      }
    : {
        tone: 'ok',
        icon: '🟢',
        label: '自动托管正常',
        detail: `停滞阈值 ${Number(sched.stallThresholdSec || 600)} 秒`,
      };
}

// ── Tabs ──

export type TabKey =
  | 'tasks' | 'monitor' | 'agents' | 'models'
  | 'skills' | 'sessions' | 'archives' | 'templates' | 'web_search' | 'court' | 'automation';

export const TAB_DEFS: { key: TabKey; label: string; labelEn: string; icon: string }[] = [
  { key: 'tasks',       label: '任务看板', icon: '📋', labelEn: 'Task Board' },
  { key: 'court',       label: '协同讨论', icon: '🏛️', labelEn: 'Collaboration' },
  { key: 'monitor',     label: '运行监控', icon: '🔌', labelEn: 'Runtime Monitor' },
  { key: 'automation',  label: '自动化中心', icon: '🧭', labelEn: 'Automation Center' },
  { key: 'agents',      label: 'Agent 总览', icon: '👔', labelEn: 'Agent Overview' },
  { key: 'models',      label: '模型配置', icon: '🤖', labelEn: 'Model Config' },
  { key: 'skills',      label: '技能配置', icon: '🎯', labelEn: 'Skills Config' },
  { key: 'sessions',    label: '快速任务', icon: '💬', labelEn: 'Quick Tasks' },
  { key: 'archives',    label: '结果归档', icon: '🗄️', labelEn: 'Archives' },
  { key: 'templates',   label: '模板中心', icon: '📋', labelEn: 'Templates' },
  { key: 'web_search',  label: '全网搜索', icon: '🌐', labelEn: 'Web Search' },
];

export function tabLabel(tab: { label: string; labelEn: string }, locale: Locale): string {
  return locale === 'en' ? tab.labelEn : tab.label;
}

// ── DEPTS for monitor ──


// ── Templates ──

export interface TemplateParam {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  default?: string;
  required?: boolean;
  options?: string[];
}

export interface Template {
  id: string;
  cat: string;
  icon: string;
  name: string;
  desc: string;
  depts: string[];
  est: string;
  cost: string;
  params: TemplateParam[];
  command: string;
}

export const TEMPLATES: Template[] = [
  {
    id: 'tpl-weekly-report', cat: '日常办公', icon: '📝', name: '周报生成',
    desc: '基于本周看板数据和各专家产出，自动生成结构化周报',
    depts: ['数据专家', '文案专家'], est: '~10分钟', cost: '¥0.5',
    params: [
      { key: 'date_range', label: '报告周期', type: 'text', default: '本周', required: true },
      { key: 'focus', label: '重点关注（逗号分隔）', type: 'text', default: '项目进展,下周计划' },
      { key: 'format', label: '输出格式', type: 'select', options: ['Markdown', '飞书文档'], default: 'Markdown' },
    ],
    command: '生成{date_range}的周报，重点覆盖{focus}，输出为{format}格式',
  },
  {
    id: 'tpl-code-review', cat: '工程开发', icon: '🔍', name: '代码审查',
    desc: '对指定代码仓库/文件进行质量审查，输出问题清单和改进建议',
    depts: ['代码专家', '审计专家'], est: '~20分钟', cost: '¥2',
    params: [
      { key: 'repo', label: '仓库/文件路径', type: 'text', required: true },
      { key: 'scope', label: '审查范围', type: 'select', options: ['全量', '增量(最近commit)', '指定文件'], default: '增量(最近commit)' },
      { key: 'focus', label: '重点关注（可选）', type: 'text', default: '安全漏洞,错误处理,性能' },
    ],
    command: '对 {repo} 进行代码审查，范围：{scope}，重点关注：{focus}',
  },
  {
    id: 'tpl-api-design', cat: '工程开发', icon: '⚡', name: 'API 设计与实现',
    desc: '从需求描述到 RESTful API 设计、实现、测试一条龙',
    depts: ['规划中心', '代码专家'], est: '~45分钟', cost: '¥3',
    params: [
      { key: 'requirement', label: '需求描述', type: 'textarea', required: true },
      { key: 'tech', label: '技术栈', type: 'select', options: ['Python/FastAPI', 'Node/Express', 'Go/Gin'], default: 'Python/FastAPI' },
      { key: 'auth', label: '鉴权方式', type: 'select', options: ['JWT', 'API Key', '无'], default: 'JWT' },
    ],
    command: '设计并实现一个 {tech} 的 RESTful API：{requirement}。鉴权方式：{auth}',
  },
  {
    id: 'tpl-competitor', cat: '数据分析', icon: '📊', name: '竞品分析',
    desc: '爬取竞品网站数据，分析对比，生成结构化报告',
    depts: ['代码专家', '数据专家', '文案专家'], est: '~60分钟', cost: '¥5',
    params: [
      { key: 'targets', label: '竞品名称/URL（每行一个）', type: 'textarea', required: true },
      { key: 'dimensions', label: '分析维度', type: 'text', default: '产品功能,定价策略,用户评价' },
      { key: 'format', label: '输出格式', type: 'select', options: ['Markdown报告', '表格对比'], default: 'Markdown报告' },
    ],
    command: '对以下竞品进行分析：\n{targets}\n\n分析维度：{dimensions}，输出格式：{format}',
  },
  {
    id: 'tpl-data-report', cat: '数据分析', icon: '📈', name: '数据报告',
    desc: '对给定数据集进行清洗、分析、可视化，输出分析报告',
    depts: ['数据专家', '文案专家'], est: '~30分钟', cost: '¥2',
    params: [
      { key: 'data_source', label: '数据源描述/路径', type: 'text', required: true },
      { key: 'questions', label: '分析问题（每行一个）', type: 'textarea' },
      { key: 'viz', label: '是否需要可视化图表', type: 'select', options: ['是', '否'], default: '是' },
    ],
    command: '对数据 {data_source} 进行分析。{questions}\n需要可视化：{viz}',
  },
  {
    id: 'tpl-blog', cat: '内容创作', icon: '✍️', name: '博客文章',
    desc: '给定主题和要求，生成高质量博客文章',
    depts: ['文案专家'], est: '~15分钟', cost: '¥1',
    params: [
      { key: 'topic', label: '文章主题', type: 'text', required: true },
      { key: 'audience', label: '目标读者', type: 'text', default: '技术人员' },
      { key: 'length', label: '期望字数', type: 'select', options: ['~1000字', '~2000字', '~3000字'], default: '~2000字' },
      { key: 'style', label: '风格', type: 'select', options: ['技术教程', '观点评论', '案例分析'], default: '技术教程' },
    ],
    command: '写一篇关于「{topic}」的博客文章，面向{audience}，{length}，风格：{style}',
  },
  {
    id: 'tpl-deploy', cat: '工程开发', icon: '🚀', name: '部署方案',
    desc: '生成完整的部署检查单、AI 部署建议与 CI/CD 流程',
    depts: ['代码专家', '部署专家'], est: '~25分钟', cost: '¥2',
    params: [
      { key: 'project', label: '项目名称/描述', type: 'text', required: true },
      { key: 'env', label: '部署环境', type: 'select', options: ['AI 部署', 'K8s', 'VPS', 'Serverless'], default: 'AI 部署' },
      { key: 'ci', label: 'CI/CD 工具', type: 'select', options: ['GitHub Actions', 'GitLab CI', '无'], default: 'GitHub Actions' },
    ],
    command: '为项目「{project}」生成{env}部署方案，CI/CD使用{ci}',
  },
  {
    id: 'tpl-email', cat: '内容创作', icon: '📧', name: '邮件/通知文案',
    desc: '根据场景和目的，生成专业邮件或通知文案',
    depts: ['文案专家'], est: '~5分钟', cost: '¥0.3',
    params: [
      { key: 'scenario', label: '使用场景', type: 'select', options: ['商务邮件', '产品发布', '客户通知', '内部公告'], default: '商务邮件' },
      { key: 'purpose', label: '目的/内容', type: 'textarea', required: true },
      { key: 'tone', label: '语调', type: 'select', options: ['正式', '友好', '简洁'], default: '正式' },
    ],
    command: '撰写一封{scenario}，{tone}语调。内容：{purpose}',
  },
  {
    id: 'tpl-standup', cat: '日常办公', icon: '🗓️', name: '每日站会摘要',
    desc: '汇总各中心与专家今日进展和明日计划，生成站会摘要',
    depts: ['调度中心'], est: '~5分钟', cost: '¥0.3',
    params: [
      { key: 'range', label: '汇总范围', type: 'select', options: ['今天', '最近24小时', '昨天+今天'], default: '今天' },
    ],
    command: '汇总{range}各中心与专家的工作进展和待办，生成站会摘要',
  },
];

export const TPL_CATS = [
  { name: '全部', icon: '📋' },
  { name: '日常办公', icon: '💼' },
  { name: '数据分析', icon: '📊' },
  { name: '工程开发', icon: '⚙️' },
  { name: '内容创作', icon: '✍️' },
];

// ── Main Store ──

interface AppStore {
  locale: Locale;
  // Data
  liveStatus: LiveStatus | null;
  agentConfig: AgentConfig | null;
  changeLog: ChangeLogEntry[];
  agentsOverviewData: AgentsOverviewData | null;
  agentsStatusData: AgentsStatusData | null;
   searchBrief: SearchBrief | null;
  subConfig: SubConfig | null;

  // UI State
  activeTab: TabKey;
  taskFilter: 'active' | 'archived' | 'all';
  sessFilter: string;
  tplCatFilter: string;
  selectedAgent: string | null;
  modalTaskId: string | null;
  countdown: number;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;

  // Toast
  toasts: { id: number; msg: string; type: 'ok' | 'err' }[];

  // Actions
  setActiveTab: (tab: TabKey) => void;
  setTaskFilter: (f: 'active' | 'archived' | 'all') => void;
  setSessFilter: (f: string) => void;
  setTplCatFilter: (f: string) => void;
  setSelectedAgent: (id: string | null) => void;
  setModalTaskId: (id: string | null) => void;
  setCountdown: (n: number) => void;
  toast: (msg: string, type?: 'ok' | 'err') => void;

  // Data fetching
  loadLive: () => Promise<void>;
  loadAgentConfig: () => Promise<void>;
  loadAgentsOverview: () => Promise<void>;
  loadAgentsStatus: () => Promise<void>;
  loadWebSearch: () => Promise<void>;
  loadSubConfig: () => Promise<void>;
  loadAll: () => Promise<void>;
}

let _toastId = 0;

export const useStore = create<AppStore>((set, get) => ({
  liveStatus: null,
  agentConfig: null,
  changeLog: [],
  agentsOverviewData: null,
  agentsStatusData: null,
  searchBrief: null,
  subConfig: null,

  activeTab: 'tasks',
  taskFilter: 'active',
  sessFilter: 'all',
  tplCatFilter: '全部',
  selectedAgent: null,
  modalTaskId: null,
  countdown: 5,
  locale: detectLocale(),

  toasts: [],

  setActiveTab: (tab) => {
    set({ activeTab: tab });
    const s = get();
    if (['models', 'skills', 'sessions'].includes(tab) && !s.agentConfig) s.loadAgentConfig();
    if (tab === 'agents' && !s.agentsOverviewData) s.loadAgentsOverview();
    if (tab === 'monitor') s.loadAgentsStatus();
    if (tab === 'web_search' && !s.searchBrief) s.loadWebSearch();
  },
  setTaskFilter: (f) => set({ taskFilter: f }),
  setSessFilter: (f) => set({ sessFilter: f }),
  setTplCatFilter: (f) => set({ tplCatFilter: f }),
  setSelectedAgent: (id) => set({ selectedAgent: id }),
  setModalTaskId: (id) => set({ modalTaskId: id }),
  setCountdown: (n) => set({ countdown: n }),
  setLocale: (locale) => {
    persistLocale(locale);
    applyLocale(locale);
    set({ locale });
  },
  toggleLocale: () => {
    const next = get().locale === 'en' ? 'zh' : 'en';
    persistLocale(next);
    applyLocale(next);
    set({ locale: next });
  },

  toast: (msg, type = 'ok') => {
    const id = ++_toastId;
    set((s) => ({ toasts: [...s.toasts, { id, msg, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },

  loadLive: async () => {
    try {
      const data = await api.liveStatus();
      set({ liveStatus: data });
      // Also preload agents overview for monitor tab
      const s = get();
      if (!s.agentsOverviewData) {
        api.agentsOverview().then((d) => set({ agentsOverviewData: d })).catch(() => {});
      }
    } catch {
      // silently fail
    }
  },

  loadAgentConfig: async () => {
    try {
      const cfg = await api.agentConfig();
      const log = await api.modelChangeLog();
      set({ agentConfig: cfg, changeLog: log });
    } catch {
      // silently fail
    }
  },

  loadAgentsOverview: async () => {
    try {
      const data = await api.agentsOverview();
      set({ agentsOverviewData: data });
    } catch {
      // silently fail
    }
  },

  loadAgentsStatus: async () => {
    try {
      const data = await api.agentsStatus();
      set({ agentsStatusData: data });
    } catch {
      set({ agentsStatusData: null });
    }
  },

  loadWebSearch: async () => {
    try {
      const [brief, config] = await Promise.all([api.searchBrief(), api.searchConfig()]);
      set({ searchBrief: brief, subConfig: config });
    } catch {
      // silently fail
    }
  },

  loadSubConfig: async () => {
    try {
      const config = await api.searchConfig();
      set({ subConfig: config });
    } catch {
      // silently fail
    }
  },

  loadAll: async () => {
    const s = get();
    await s.loadLive();
    const tab = s.activeTab;
    if (['models', 'skills'].includes(tab)) await s.loadAgentConfig();
  },
}));

// ── Countdown & Polling ──

let _cdTimer: ReturnType<typeof setInterval> | null = null;

export function startPolling() {
  if (_cdTimer) return;
  useStore.getState().loadAll();
  _cdTimer = setInterval(() => {
    const s = useStore.getState();
    const cd = s.countdown - 1;
    if (cd <= 0) {
      s.setCountdown(5);
      s.loadAll();
    } else {
      s.setCountdown(cd);
    }
  }, 1000);
}

export function stopPolling() {
  if (_cdTimer) {
    clearInterval(_cdTimer);
    _cdTimer = null;
  }
}

// ── Utility ──

export function esc(s: string | undefined | null): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function timeAgo(iso: string | undefined, locale: Locale = 'zh'): string {
  if (!iso) return '';
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return '';
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(mins / 60);
    return formatRelativeTime(locale, mins, hrs);
  } catch {
    return '';
  }
}
