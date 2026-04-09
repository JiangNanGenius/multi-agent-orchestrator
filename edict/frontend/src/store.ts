/**
 * Zustand Store — 多Agent协作平台状态管理
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
  type CollabAgentBusyResult,
} from './api';

// ── Pipeline Definition (PIPE) ──

export const PIPE = [
  { key: 'Inbox',         dept: '已接收',     deptEn: 'Received',           icon: '🗂️', action: '收到', actionEn: 'Received' },
  { key: 'ControlCenter', dept: '需求确认',   deptEn: 'Needs Review',       icon: '🎛️', action: '确认', actionEn: 'Review' },
  { key: 'PlanCenter',    dept: '方案整理',   deptEn: 'Planning',           icon: '🧭', action: '整理', actionEn: 'Plan' },
  { key: 'ReviewCenter',  dept: '结果核对',   deptEn: 'Quality Check',      icon: '🔍', action: '核对', actionEn: 'Check' },
  { key: 'Assigned',      dept: '安排处理',   deptEn: 'Assigned',           icon: '📮', action: '安排', actionEn: 'Assign' },
  { key: 'Doing',         dept: '处理中',     deptEn: 'In Progress',        icon: '⚙️', action: '处理', actionEn: 'Handle' },
  { key: 'Review',        dept: '结果整理',   deptEn: 'Wrapping Up',        icon: '🧾', action: '整理', actionEn: 'Wrap Up' },
  { key: 'Done',          dept: '已完成',     deptEn: 'Completed',          icon: '✅', action: '完成', actionEn: 'Complete' },
] as const;

export const PIPE_STATE_IDX: Record<string, number> = {
  Inbox: 0, Pending: 0, ControlCenter: 1, PlanCenter: 2, ReviewCenter: 3,
  Assigned: 4, Doing: 5, Review: 6, Done: 7, Blocked: 5, Cancelled: 5, Next: 4,
};

export const AGENT_ARCHITECTURE = {
  control_center: {
    label: '总览协调',
    labelEn: 'Overview Coordination',
    role: '帮助统筹整体进度',
    roleEn: 'Helps coordinate overall progress',
    rank: '核心服务',
    rankEn: 'Core Service',
    emoji: '🎛️',
    color: '#e8a040',
  },
  plan_center: {
    label: '方案整理',
    labelEn: 'Planning',
    role: '帮助整理方案与步骤',
    roleEn: 'Helps organize plans and steps',
    rank: '协作服务',
    rankEn: 'Support Service',
    emoji: '🧭',
    color: '#a07aff',
  },
  review_center: {
    label: '结果检查',
    labelEn: 'Review',
    role: '帮助检查结果是否完整',
    roleEn: 'Helps review whether results are complete',
    rank: '协作服务',
    rankEn: 'Support Service',
    emoji: '🔍',
    color: '#6a9eff',
  },
  dispatch_center: {
    label: '安排处理',
    labelEn: 'Assignment',
    role: '帮助安排合适的人继续处理',
    roleEn: 'Helps assign the right people to continue',
    rank: '协作服务',
    rankEn: 'Support Service',
    emoji: '📮',
    color: '#6aef9a',
  },
  docs_specialist: {
    label: '内容助手',
    labelEn: 'Content Assistant',
    role: '帮助整理说明、总结与成稿',
    roleEn: 'Helps draft summaries, explanations, and final copy',
    rank: '服务角色',
    rankEn: 'Service Role',
    emoji: '📝',
    color: '#f5c842',
  },
  data_specialist: {
    label: '数据助手',
    labelEn: 'Data Assistant',
    role: '帮助整理数据、图表与结论',
    roleEn: 'Helps organize data, charts, and findings',
    rank: '服务角色',
    rankEn: 'Service Role',
    emoji: '💰',
    color: '#ff9a6a',
  },
  code_specialist: {
    label: '功能助手',
    labelEn: 'Feature Assistant',
    role: '帮助制作和调整所需功能',
    roleEn: 'Helps create and adjust the needed features',
    rank: '处理助手',
    rankEn: 'Assistant',
    emoji: '⚔️',
    color: '#44aaff',
  },
  audit_specialist: {
    label: '核对助手',
    labelEn: 'Check Assistant',
    role: '帮助核对风险、规则与重要细节',
    roleEn: 'Helps check risks, rules, and important details',
    rank: '服务角色',
    rankEn: 'Service Role',
    emoji: '⚖️',
    color: '#cc4444',
  },
  deploy_specialist: {
    label: '上线助手',
    labelEn: 'Launch Assistant',
    role: '帮助处理上线前准备与发布事项',
    roleEn: 'Helps prepare launch-related work and release steps',
    rank: '处理助手',
    rankEn: 'Assistant',
    emoji: '🔧',
    color: '#ff5270',
  },
  admin_specialist: {
    label: '能力整理助手',
    labelEn: 'Capability Assistant',
    role: '帮助整理常用能力与相关设置',
    roleEn: 'Helps organize common capabilities and related settings',
    rank: '处理助手',
    rankEn: 'Assistant',
    emoji: '🗂️',
    color: '#9b59b6',
  },
  expert_curator: {
    label: '协作安排助手',
    labelEn: 'Collaboration Assistant',
    role: '帮助整理协作成员与分工',
    roleEn: 'Helps organize collaborators and assignments',
    rank: '处理助手',
    rankEn: 'Assistant',
    emoji: '🧩',
    color: '#7be0ff',
  },
  search_specialist: {
    label: '搜索助手',
    labelEn: 'Search Assistant',
    role: '帮助查找全网信息与线索',
    roleEn: 'Helps search web information and leads',
    rank: '辅助能力',
    rankEn: 'Support',
    emoji: '🌐',
    color: '#36cfc9',
  },
} as const;

export type AgentArchitectureId = keyof typeof AGENT_ARCHITECTURE;

export const DEPT_COLOR: Record<string, string> = {
  '待处理': '#ffd700',
  '处理中': '#44aaff',
  '已完成': '#2ecc8a',
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
    .replace(/结果报告/g, '已完成')
    .replace(/Result report/g, 'Completed')
    .replace(/专业执行组/g, '处理中')
    .replace(/Execution Team/g, 'In Progress')
    .replace(/Agent管理专家/g, '能力整理助手')
    .replace(/管理专家/g, '能力整理助手')
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
  Inbox: '已接收',
  Pending: '等待处理',
  ControlCenter: '需求确认中',
  PlanCenter: '方案整理中',
  ReviewCenter: '结果核对中',
  Assigned: '已安排',
  Doing: '处理中',
  Review: '结果整理中',
  Done: '已完成',
  Blocked: '暂时卡住',
  Cancelled: '已结束',
  Next: '即将开始',
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
  Inbox: 'Received',
  Pending: 'Waiting',
  ControlCenter: 'Reviewing Needs',
  PlanCenter: 'Planning',
  ReviewCenter: 'Checking Results',
  Assigned: 'Assigned',
  Doing: 'In Progress',
  Review: 'Wrapping Up',
  Done: 'Completed',
  Blocked: 'Stuck',
  Cancelled: 'Ended',
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

const STATE_TO_FLOW_NODE: Record<string, string> = {
  Inbox: '需求提交',
  Pending: '需求提交',
  ControlCenter: '整体协调',
  PlanCenter: '方案整理',
  ReviewCenter: '结果检查',
  Assigned: '安排处理',
  Doing: '正在处理',
  Review: '安排处理',
  Done: '结果归档',
  Blocked: '正在处理',
  Cancelled: '正在处理',
  Next: '安排处理',
};

function resolveFlowNode(input: string): string {
  if (!input) return '';
  const trimmed = String(input).trim();
  if (!trimmed) return '';
  const byState = STATE_TO_FLOW_NODE[trimmed];
  if (byState) return byState;
  const normalizedId = normalizeAgentId(trimmed);
  if (normalizedId !== trimmed && AGENT_ARCHITECTURE[normalizedId as AgentArchitectureId]) {
    return normalizedId;
  }
  const normalizedLabel = normalizeDeptLabel(trimmed);
  if (normalizedLabel && normalizedLabel !== trimmed) return normalizedLabel;
  return trimmed;
}

function flowActionLabel(node: string, locale: Locale = 'zh'): string {
  const key = resolveFlowNode(node);
  const zh = {
    '需求提交': '提交',
    '整体协调': '协调',
    '方案整理': '整理',
    '结果检查': '检查',
    '安排处理': '安排',
    '正在处理': '处理',
    '结果归档': '归档',
    docs_specialist: '撰写',
    data_specialist: '分析',
    code_specialist: '处理',
    audit_specialist: '核对',
    deploy_specialist: '发布',
    admin_specialist: '设置',
    search_specialist: '搜索',
  } as const;
  const en = {
    '需求提交': 'Submit',
    '整体协调': 'Coordinate',
    '方案整理': 'Organize',
    '结果检查': 'Review',
    '安排处理': 'Arrange',
    '正在处理': 'Handle',
    '结果归档': 'Archive',
    docs_specialist: 'Write',
    data_specialist: 'Analyze',
    code_specialist: 'Handle',
    audit_specialist: 'Check',
    deploy_specialist: 'Release',
    admin_specialist: 'Set Up',
    search_specialist: 'Search',
  } as const;
  const dict = locale === 'en' ? en : zh;
  return dict[key as keyof typeof dict] || (locale === 'en' ? 'Handle' : '处理');
}

function flowStageMeta(node: string, locale: Locale = 'zh'): Omit<PipeStatus, 'status'> {
  const resolved = resolveFlowNode(node);
  const pipeStage = PIPE.find((stage) => stage.key === resolved || stage.dept === resolved || stage.deptEn === resolved);
  if (pipeStage) {
    return {
      key: pipeStage.key,
      icon: pipeStage.icon,
      dept: locale === 'en' ? pipeStage.deptEn : pipeStage.dept,
      action: locale === 'en' ? pipeStage.actionEn : pipeStage.action,
    };
  }
  const meta = deptMeta(resolved, locale);
  return {
    key: normalizeAgentId(resolved) || resolved,
    icon: meta.emoji || '🧩',
    dept: meta.label || resolved,
    action: flowActionLabel(resolved, locale),
  };
}

function buildStaticPipeStatus(t: Task, locale: Locale = 'zh'): PipeStatus[] {
  const stateIdx = PIPE_STATE_IDX[t.state] ?? 4;
  return PIPE.map((stage, i) => ({
    key: `${stage.key}-${i}`,
    icon: stage.icon,
    dept: locale === 'en' ? stage.deptEn : stage.dept,
    action: locale === 'en' ? stage.actionEn : stage.action,
    status: (i < stateIdx ? 'done' : i === stateIdx ? 'active' : 'pending') as 'done' | 'active' | 'pending',
  }));
}

export function getPipeStatus(t: Task, locale: Locale = 'zh'): PipeStatus[] {
  const sequence: string[] = [];
  const pushNode = (node: string) => {
    const resolved = resolveFlowNode(node);
    if (!resolved) return;
    if (sequence[sequence.length - 1] === resolved) return;
    sequence.push(resolved);
  };

  pushNode('任务入口');
  (t.flow_log || []).forEach((entry) => {
    pushNode(entry.from || '');
    pushNode(entry.to || '');
  });
  pushNode(t.org || '');
  if (t.state === 'Done') pushNode('结果归档');

  const dynamicStages = sequence.map((node, index) => ({
    ...flowStageMeta(node, locale),
    key: `${flowStageMeta(node, locale).key}-${index}`,
  }));

  if (dynamicStages.length < 2) {
    return buildStaticPipeStatus(t, locale);
  }

  const activeNode = t.state === 'Done'
    ? '结果归档'
    : resolveFlowNode(t.org || STATE_TO_FLOW_NODE[t.state] || sequence[sequence.length - 1] || '');
  const activeDept = activeNode ? flowStageMeta(activeNode, locale).dept : '';
  let activeIdx = dynamicStages.map((stage) => stage.dept).lastIndexOf(activeDept);
  if (activeIdx < 0) activeIdx = dynamicStages.length - 1;

  return dynamicStages.map((stage, index) => ({
    ...stage,
    status: (index < activeIdx ? 'done' : index === activeIdx ? 'active' : 'pending') as 'done' | 'active' | 'pending',
  }));
}

export function getTaskScheduler(t: Task): SchedulerInfo | undefined {
  return (t as Task & { _scheduler?: SchedulerInfo })._scheduler;
}

export function getSchedulerSummary(t: Task, locale: Locale = 'zh'): { tone: 'ok' | 'warn' | 'danger' | 'muted'; icon: string; label: string; detail: string } {
  const sched = getTaskScheduler(t);
  if (!sched) {
    return locale === 'en'
      ? { tone: 'muted', icon: '🧭', label: 'Not Ready', detail: 'Automatic handling has not been set for this task yet' }
      : { tone: 'muted', icon: '🧭', label: '尚未设置', detail: '当前任务还没有开启自动处理设置' };
  }
  if (sched.enabled === false) {
    return locale === 'en'
      ? { tone: 'muted', icon: '⏸', label: 'Manual Handling', detail: 'Automatic handling is turned off for this task' }
      : { tone: 'muted', icon: '⏸', label: '手动处理', detail: '当前任务已关闭自动处理' };
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
          label: escalationLevel === 1 ? 'Needs Attention' : 'Reassigned',
          detail: escalationLevel === 1 ? 'The task has been raised for additional review' : 'The task has been reassigned for continued handling',
        }
      : {
          tone: 'danger',
          icon: '📣',
          label: escalationLevel === 1 ? '需要关注' : '已重新安排',
          detail: escalationLevel === 1 ? '当前任务已提升关注并进入补充检查' : '当前任务已重新安排给合适成员继续处理',
        };
  }
  if (retryCount > 0) {
    return locale === 'en'
      ? {
          tone: 'warn',
          icon: '🔁',
          label: 'Retrying Automatically',
          detail: `Retried automatically ${retryCount}/${maxRetry} time(s)`,
        }
      : {
          tone: 'warn',
          icon: '🔁',
          label: '正在自动重试',
          detail: `当前已自动重试 ${retryCount}/${maxRetry} 次`,
        };
  }
  if (status && status !== 'idle') {
    return locale === 'en'
      ? {
          tone: 'ok',
          icon: '⚙️',
          label: 'Automatic Handling On',
          detail: `Latest handling status: ${status}`,
        }
      : {
          tone: 'ok',
          icon: '⚙️',
          label: '自动处理中',
          detail: `最近处理状态：${status}`,
        };
  }
  return locale === 'en'
    ? {
        tone: 'ok',
        icon: '🟢',
        label: 'Automatic Handling Healthy',
        detail: `Pause threshold ${Number(sched.stallThresholdSec || 600)} sec`,
      }
    : {
        tone: 'ok',
        icon: '🟢',
        label: '自动处理正常',
        detail: `暂停阈值 ${Number(sched.stallThresholdSec || 600)} 秒`,
      };
}

// ── Tabs ──

export type TabKey =
  | 'tasks' | 'monitor' | 'agents' | 'models'
  | 'skills' | 'sessions' | 'archives' | 'templates' | 'web_search' | 'collaboration' | 'automation' | 'system_settings';

export const TAB_DEFS: { key: TabKey; label: string; labelEn: string; icon: string }[] = [
  { key: 'tasks',       label: '我的事项', icon: '📋', labelEn: 'Tasks' },
  { key: 'collaboration', label: '一起讨论', icon: '👥', labelEn: 'Discussion' },
  { key: 'monitor',     label: '最新动态', icon: '📡', labelEn: 'Updates' },
  { key: 'automation',  label: '自动跟进', icon: '🧭', labelEn: 'Auto Follow-up' },
  { key: 'agents',      label: '协作成员', icon: '👔', labelEn: 'Team' },
  { key: 'models',      label: '回复风格', icon: '🤖', labelEn: 'Response Style' },
  { key: 'skills',      label: '更多能力', icon: '🎯', labelEn: 'More Capabilities' },
  { key: 'sessions',    label: '快捷入口', icon: '💬', labelEn: 'Shortcuts' },
  { key: 'archives',    label: '历史记录', icon: '🗄️', labelEn: 'History' },
  { key: 'templates',   label: '常用模板', icon: '📋', labelEn: 'Templates' },
  { key: 'web_search',  label: '全网搜索', icon: '🌐', labelEn: 'Web Search' },
  { key: 'system_settings', label: '系统设置', icon: '⚙️', labelEn: 'System Settings' },
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
    desc: '基于本周看板数据和各成员进展，自动生成结构化周报',
    depts: ['数据助手', '文稿助手'], est: '~10分钟', cost: '¥0.5',
    params: [
      { key: 'date_range', label: '报告周期', type: 'text', default: '本周', required: true },
      { key: 'focus', label: '重点关注（逗号分隔）', type: 'text', default: '项目进展,下周计划' },
      { key: 'format', label: '输出格式', type: 'select', options: ['Markdown', '飞书文档'], default: 'Markdown' },
    ],
    command: '生成{date_range}的周报，重点覆盖{focus}，输出为{format}格式',
  },
  {
    id: 'tpl-code-review', cat: '方案与搭建', icon: '🔍', name: '文件质量检查',
    desc: '对指定仓库或文件进行质量检查，输出问题清单和改进建议',
    depts: ['处理助手', '核对助手'], est: '~20分钟', cost: '¥2',
    params: [
      { key: 'repo', label: '仓库/文件路径', type: 'text', required: true },
      { key: 'scope', label: '审查范围', type: 'select', options: ['全量', '增量(最近commit)', '指定文件'], default: '增量(最近commit)' },
      { key: 'focus', label: '重点关注（可选）', type: 'text', default: '安全漏洞,错误处理,性能' },
    ],
    command: '对 {repo} 进行文件质量检查，范围：{scope}，重点关注：{focus}',
  },
  {
    id: 'tpl-api-design', cat: '方案与搭建', icon: '⚡', name: '对接方案整理',
    desc: '从需求描述到接口方案、处理方式和验证步骤，一次性整理清楚',
    depts: ['规划助手', '处理助手'], est: '~45分钟', cost: '¥3',
    params: [
      { key: 'requirement', label: '需求描述', type: 'textarea', required: true },
      { key: 'tech', label: '技术栈', type: 'select', options: ['Python/FastAPI', 'Node/Express', 'Go/Gin'], default: 'Python/FastAPI' },
      { key: 'auth', label: '鉴权方式', type: 'select', options: ['JWT', 'API Key', '无'], default: 'JWT' },
    ],
    command: '基于 {requirement} 整理一个 {tech} 的接口方案与处理方式，访问方式：{auth}',
  },
  {
    id: 'tpl-competitor', cat: '数据分析', icon: '📊', name: '竞品分析',
    desc: '收集竞品网站信息，分析对比并生成结构化报告',
    depts: ['处理助手', '数据助手', '文稿助手'], est: '~60分钟', cost: '¥5',
    params: [
      { key: 'targets', label: '竞品名称/URL（每行一个）', type: 'textarea', required: true },
      { key: 'dimensions', label: '分析维度', type: 'text', default: '产品功能,定价策略,用户评价' },
      { key: 'format', label: '输出格式', type: 'select', options: ['Markdown报告', '表格对比'], default: 'Markdown报告' },
    ],
    command: '对以下竞品进行分析：\n{targets}\n\n分析维度：{dimensions}，输出格式：{format}',
  },
  {
    id: 'tpl-data-report', cat: '数据分析', icon: '📈', name: '数据报告',
    desc: '对给定数据进行整理、分析和图表展示，输出分析报告',
    depts: ['数据助手', '文稿助手'], est: '~30分钟', cost: '¥2',
    params: [
      { key: 'data_source', label: '数据源描述/路径', type: 'text', required: true },
      { key: 'questions', label: '分析问题（每行一个）', type: 'textarea' },
      { key: 'viz', label: '是否需要可视化图表', type: 'select', options: ['是', '否'], default: '是' },
    ],
    command: '对数据 {data_source} 进行分析。{questions}\n需要可视化：{viz}',
  },
  {
    id: 'tpl-blog', cat: '内容创作', icon: '✍️', name: '博客文章',
    desc: '给定主题和要求，生成结构完整的长文内容',
    depts: ['文稿助手'], est: '~15分钟', cost: '¥1',
    params: [
      { key: 'topic', label: '文章主题', type: 'text', required: true },
      { key: 'audience', label: '目标读者', type: 'text', default: '普通读者' },
      { key: 'length', label: '期望字数', type: 'select', options: ['~1000字', '~2000字', '~3000字'], default: '~2000字' },
      { key: 'style', label: '风格', type: 'select', options: ['步骤说明', '观点评论', '案例分析'], default: '步骤说明' },
    ],
    command: '写一篇关于「{topic}」的博客文章，面向{audience}，{length}，风格：{style}',
  },
  {
    id: 'tpl-deploy', cat: '方案与搭建', icon: '🚀', name: '上线准备方案',
    desc: '生成完整的上线检查清单、发布建议与持续更新安排',
    depts: ['处理助手', '上线助手'], est: '~25分钟', cost: '¥2',
    params: [
      { key: 'project', label: '项目名称/描述', type: 'text', required: true },
      { key: 'env', label: '上线环境', type: 'select', options: ['标准环境', '容器环境', '独立主机', '轻量托管'], default: '标准环境' },
      { key: 'ci', label: '自动发布方式', type: 'select', options: ['GitHub Actions', 'GitLab CI', '无'], default: 'GitHub Actions' },
    ],
    command: '为项目「{project}」生成{env}上线准备方案，自动发布方式使用{ci}',
  },
  {
    id: 'tpl-email', cat: '内容创作', icon: '📧', name: '邮件/通知文案',
    desc: '根据场景和目的，生成邮件或通知内容',
    depts: ['文稿助手'], est: '~5分钟', cost: '¥0.3',
    params: [
      { key: 'scenario', label: '使用场景', type: 'select', options: ['商务邮件', '产品发布', '客户通知', '内部公告'], default: '商务邮件' },
      { key: 'purpose', label: '目的/内容', type: 'textarea', required: true },
      { key: 'tone', label: '语调', type: 'select', options: ['正式', '友好', '简洁'], default: '正式' },
    ],
    command: '撰写一封{scenario}，{tone}语调。内容：{purpose}',
  },
  {
    id: 'tpl-standup', cat: '日常办公', icon: '🗓️', name: '每日进展摘要',
    desc: '汇总今日进展和明日计划，生成简明摘要',
    depts: ['协调助手'], est: '~5分钟', cost: '¥0.3',
    params: [
      { key: 'range', label: '汇总范围', type: 'select', options: ['今天', '最近24小时', '昨天+今天'], default: '今天' },
    ],
    command: '汇总{range}的工作进展和待办，生成每日进展摘要',
  },
];

export const TPL_CATS = [
  { name: '全部', icon: '📋' },
  { name: '日常办公', icon: '💼' },
  { name: '数据分析', icon: '📊' },
  { name: '方案与搭建', icon: '⚙️' },
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
  collabAgentBusyData: CollabAgentBusyResult | null;
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
  loadCollabBusy: () => Promise<void>;
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
  collabAgentBusyData: null,
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
    if (tab === 'monitor') {
      s.loadAgentsStatus();
      s.loadCollabBusy();
    }
    if (tab === 'collaboration' || tab === 'tasks') s.loadCollabBusy();
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

  loadCollabBusy: async () => {
    try {
      const data = await api.globalAgentBusy();
      set({ collabAgentBusyData: data });
    } catch {
      set({ collabAgentBusyData: null });
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
    await Promise.all([
      s.loadLive(),
      s.loadCollabBusy(),
      s.activeTab === 'monitor' ? s.loadAgentsStatus() : Promise.resolve(),
    ]);
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
