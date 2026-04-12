/**
 * Zustand Store — 多Agent协作平台状态管理
 * HTTP 5s 轮询，无 WebSocket
 */

import { create } from 'zustand';
import { applyLocale, detectLocale, formatRelativeTime, persistLocale, type Locale } from './i18n';
import { applyTheme, detectThemeMode, persistThemeMode, resolveTheme, type ThemeMode, type ResolvedTheme } from './theme';
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
    label: '总控中心',
    labelEn: 'Control Center',
    role: '接收用户消息并接入正式任务链路',
    roleEn: 'Receives user requests and routes formal work into the task pipeline',
    rank: '中心层',
    rankEn: 'Core Center',
    emoji: '🎛️',
    color: '#e8a040',
  },
  plan_center: {
    label: '规划中心',
    labelEn: 'Planning Center',
    role: '负责起草方案并组织进入评审与调度',
    roleEn: 'Drafts execution plans and moves work into review and dispatch',
    rank: '中心层',
    rankEn: 'Core Center',
    emoji: '🧭',
    color: '#a07aff',
  },
  review_center: {
    label: '评审中心',
    labelEn: 'Review Center',
    role: '独立审议规划方案并把关风险与边界',
    roleEn: 'Independently reviews plans and checks risks and boundaries',
    rank: '中心层',
    rankEn: 'Core Center',
    emoji: '🔍',
    color: '#6a9eff',
  },
  dispatch_center: {
    label: '调度中心',
    labelEn: 'Dispatch Center',
    role: '负责派发 specialist 并汇总执行结果',
    roleEn: 'Dispatches specialists and consolidates execution results',
    rank: '中心层',
    rankEn: 'Core Center',
    emoji: '📮',
    color: '#6aef9a',
  },
  docs_specialist: {
    label: '文案专家',
    labelEn: 'Documentation Specialist',
    role: '负责文档、规范、界面文案与对外沟通内容',
    roleEn: 'Handles documents, specifications, interface copy, and external communication content',
    rank: '专家执行组',
    rankEn: 'Specialist Group',
    emoji: '📝',
    color: '#f5c842',
  },
  data_specialist: {
    label: '数据专家',
    labelEn: 'Data Specialist',
    role: '负责数据分析、统计整理与资源管理',
    roleEn: 'Handles data analysis, statistical organization, and resource management',
    rank: '专家执行组',
    rankEn: 'Specialist Group',
    emoji: '💰',
    color: '#ff9a6a',
  },
  code_specialist: {
    label: '代码专家',
    labelEn: 'Code Specialist',
    role: '负责工程实现、架构设计与功能开发',
    roleEn: 'Handles engineering implementation, architecture design, and feature development',
    rank: '专家执行组',
    rankEn: 'Specialist Group',
    emoji: '⚔️',
    color: '#44aaff',
  },
  audit_specialist: {
    label: '审计专家',
    labelEn: 'Audit Specialist',
    role: '负责质量保障、测试验收与合规审计',
    roleEn: 'Handles quality assurance, test acceptance, and compliance auditing',
    rank: '专家执行组',
    rankEn: 'Specialist Group',
    emoji: '⚖️',
    color: '#cc4444',
  },
  deploy_specialist: {
    label: '部署专家',
    labelEn: 'Deployment Specialist',
    role: '负责基础设施、部署运维与性能监控',
    roleEn: 'Handles infrastructure, deployment operations, and performance monitoring',
    rank: '专家执行组',
    rankEn: 'Specialist Group',
    emoji: '🔧',
    color: '#ff5270',
  },
  admin_specialist: {
    label: '管理专家',
    labelEn: 'Admin Specialist',
    role: '负责 Agent 管理、能力培训与协作规范维护',
    roleEn: 'Handles agent management, capability training, and collaboration standards',
    rank: '专家执行组',
    rankEn: 'Specialist Group',
    emoji: '🗂️',
    color: '#9b59b6',
  },
  expert_curator: {
    label: '专家编组官',
    labelEn: 'Expert Curator',
    role: '负责专家新增、下线与名册治理一致性维护',
    roleEn: 'Handles expert onboarding, retirement, and roster consistency governance',
    rank: '治理角色',
    rankEn: 'Governance Role',
    emoji: '🧩',
    color: '#7be0ff',
  },
  search_specialist: {
    label: '搜索专家',
    labelEn: 'Search Specialist',
    role: '负责全网搜索、线索整理与来源归纳',
    roleEn: 'Handles web search, lead organization, and source summarization',
    rank: '专家执行组',
    rankEn: 'Specialist Group',
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
    .replace(/Agent管理专家/g, '管理专家')
    .replace(/技能管理助手/g, '管理专家')
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

export function isAgentOrchestrator(t: Task): boolean {
  return /^JJC-/i.test(t.taskCode || t.id || '');
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
  | 'tasks' | 'monitor' | 'agents'
  | 'skills' | 'memory' | 'web_search' | 'collaboration' | 'automation';

export const TAB_DEFS: { key: TabKey; label: string; labelEn: string; icon: string }[] = [
  { key: 'tasks',         label: '任务中枢', icon: '📋', labelEn: 'Mission Hub' },
  { key: 'collaboration', label: '协作会议室', icon: '🤝', labelEn: 'Collaboration' },
  { key: 'monitor',       label: '最新动态', icon: '📡', labelEn: 'Updates' },
  { key: 'automation',    label: '自动化控制台', icon: '⚙️', labelEn: 'Automation' },
  { key: 'agents',        label: 'Agent 管理工作台', icon: '👔', labelEn: 'Agent Management Workbench' },
  { key: 'skills',        label: 'Skill 管理工作台', icon: '🎯', labelEn: 'Skill Management Workbench' },
  { key: 'memory',        label: '记忆中心', icon: '🧠', labelEn: 'Memory Center' },
  { key: 'web_search',    label: '全网搜索', icon: '🌐', labelEn: 'Web Search' },
];


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
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
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
  tplCatFilter: string;
  selectedAgent: string | null;
  modalTaskId: string | null;
  countdown: number;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  setThemeMode: (mode: ThemeMode) => void;
  cycleThemeMode: () => void;
  refreshThemeFromSystem: () => void;

  // Toast
  toasts: { id: number; msg: string; type: 'ok' | 'err' }[];

  // Actions
  setActiveTab: (tab: TabKey) => void;
  setTaskFilter: (f: 'active' | 'archived' | 'all') => void;
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
const initialLocale = detectLocale();
const initialThemeMode = detectThemeMode();
const initialResolvedTheme = applyTheme(initialThemeMode);
applyLocale(initialLocale);

const DEMO_MODELS = [
  { id: 'gpt-4.1', label: 'GPT‑4.1', provider: 'OpenAI' },
  { id: 'gpt-4o-mini', label: 'GPT‑4o mini', provider: 'OpenAI' },
  { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'DeepSeek' },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'DeepSeek' },
];

function demoIso(minutesAgo = 0) {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
}

function makeDemoTask({
  id,
  title,
  state,
  org,
  currentDept,
  targetDept,
  archived = false,
  archivedAt,
  heartbeatLabel,
  output,
  todoPrefix,
}: {
  id: string;
  title: string;
  state: string;
  org: string;
  currentDept?: string;
  targetDept?: string;
  archived?: boolean;
  archivedAt?: string;
  heartbeatLabel: string;
  output: string;
  todoPrefix: string;
}): Task {
  return {
    id,
    title,
    state,
    org,
    currentDept,
    targetDept,
    targetDepts: targetDept ? [targetDept] : undefined,
    now: heartbeatLabel,
    eta: archived ? '已归档' : '预计 15 分钟内更新',
    block: archived ? '' : '暂无阻塞，等待下一轮确认',
    ac: '需要在会商后形成结论与执行建议',
    output,
    heartbeat: {
      status: archived ? 'idle' : state === 'Doing' || state === 'ReviewCenter' ? 'active' : 'warn',
      label: heartbeatLabel,
    },
    flow_log: [
      { at: demoIso(160), from: '需求提交', to: '整体协调', remark: `${todoPrefix} 已进入工作台` },
      { at: demoIso(90), from: '整体协调', to: currentDept || org, remark: `${todoPrefix} 已完成初步分流` },
      { at: demoIso(25), from: currentDept || org, to: targetDept || currentDept || org, remark: `${todoPrefix} 正在推进中` },
    ],
    todos: [
      { id: `${id}-todo-1`, title: `${todoPrefix}：补齐背景信息`, status: 'completed' },
      { id: `${id}-todo-2`, title: `${todoPrefix}：确认关键约束`, status: state === 'Done' ? 'completed' : 'in-progress' },
      { id: `${id}-todo-3`, title: `${todoPrefix}：输出纪要与建议`, status: archived ? 'completed' : 'not-started' },
    ],
    review_round: state === 'ReviewCenter' ? 2 : 1,
    archived,
    archivedAt,
    updatedAt: demoIso(8),
    workspaceLatestSummary: output,
  };
}

function buildDemoLiveStatus(): LiveStatus {
  return {
    tasks: [
      makeDemoTask({
        id: 'JJC-240410-001',
        title: '梳理海外 AI 产品监测面板重构方案',
        state: 'Doing',
        org: 'control_center',
        currentDept: 'plan_center',
        targetDept: 'review_center',
        heartbeatLabel: '方案拆解完成 70%，等待界面重构意见',
        output: '已形成信息架构、视觉重构方向与页面拆分建议。',
        todoPrefix: '重构方案',
      }),
      makeDemoTask({
        id: 'JJC-240410-002',
        title: '验证全网搜索高级筛选与摘要展示逻辑',
        state: 'ReviewCenter',
        org: 'search_specialist',
        currentDept: 'review_center',
        targetDept: 'control_center',
        heartbeatLabel: '高级搜索摘要已可见，等待交互复核',
        output: '已补齐主题、鲜度、排序与搜索深度的摘要信息。',
        todoPrefix: '搜索交互',
      }),
      makeDemoTask({
        id: 'JJC-240410-003',
        title: '恢复 Agent 管理与技能库入口',
        state: 'Assigned',
        org: 'admin_specialist',
        currentDept: 'dispatch_center',
        targetDept: 'expert_curator',
        heartbeatLabel: '已分派给技能管理助手与协作安排 Agent',
        output: '当前等待数据装载与结果验证。',
        todoPrefix: 'Agent 入口',
      }),
      makeDemoTask({
        id: 'JJC-240410-004',
        title: '归档：上一版监控首页视觉审视记录',
        state: 'Done',
        org: 'review_center',
        currentDept: 'review_center',
        targetDept: 'review_center',
        archived: true,
        archivedAt: demoIso(240),
        heartbeatLabel: '记录已归档',
        output: '已归档旧版问题：层级弱、入口散、状态反馈不清晰。',
        todoPrefix: '历史审视',
      }),
      makeDemoTask({
        id: 'OC-plan_center-001',
        title: '快捷入口：方案整理助手近期对话',
        state: 'Doing',
        org: 'plan_center',
        currentDept: 'plan_center',
        targetDept: 'plan_center',
        heartbeatLabel: '最近 10 分钟有 4 条协作消息',
        output: '保留最近上下文与参考草案。',
        todoPrefix: '近期对话',
      }),
      makeDemoTask({
        id: 'MC-review_center-001',
        title: '快捷入口：结果检查晨会纪要',
        state: 'Review',
        org: 'review_center',
        currentDept: 'review_center',
        targetDept: 'control_center',
        heartbeatLabel: '晨会结论待同步到任务板',
        output: '纪要已生成，待主持人确认后推送。',
        todoPrefix: '晨会纪要',
      }),
    ],
    syncStatus: { ok: true, mode: 'demo-fallback' },
  };
}

const DEMO_AGENT_CONFIG: AgentConfig = {
  agents: Object.entries(AGENT_ARCHITECTURE).map(([id, meta], idx) => ({
    id,
    label: meta.label,
    emoji: meta.emoji,
    role: meta.role,
    model: idx % 3 === 0 ? 'deepseek-reasoner' : idx % 2 === 0 ? 'gpt-4.1' : 'deepseek-chat',
    skills: [
      {
        name: `${meta.label}-workspace-audit`,
        description: `检查${meta.label}页面元素与交互完整性。`,
        path: `/skills/${id}/workspace-audit/SKILL.md`,
      },
      {
        name: `${meta.label}-briefing-pack`,
        description: `整理${meta.label}相关纪要、摘要与执行建议。`,
        path: `/skills/${id}/briefing-pack/SKILL.md`,
      },
    ],
  })),
  knownModels: DEMO_MODELS,
  dispatchChannel: 'feishu',
};

const DEMO_CHANGE_LOG: ChangeLogEntry[] = [
  { at: demoIso(180), agentId: 'control_center', oldModel: 'deepseek-chat', newModel: 'gpt-4.1' },
  { at: demoIso(120), agentId: 'search_specialist', oldModel: 'gpt-4o-mini', newModel: 'deepseek-reasoner' },
  { at: demoIso(45), agentId: 'admin_specialist', oldModel: 'deepseek-chat', newModel: 'gpt-4.1', rolledBack: true },
];

const DEMO_AGENTS_OVERVIEW: AgentsOverviewData = {
  agents: Object.entries(AGENT_ARCHITECTURE).map(([id, meta], idx) => ({
    id,
    label: meta.label,
    emoji: meta.emoji,
    role: meta.role,
    rank: meta.rank,
    model: idx % 3 === 0 ? 'deepseek-reasoner' : idx % 2 === 0 ? 'gpt-4.1' : 'deepseek-chat',
    model_short: idx % 3 === 0 ? 'DS-R1' : idx % 2 === 0 ? 'GPT-4.1' : 'DS-Chat',
    tokens_in: 24000 + idx * 3800,
    tokens_out: 13000 + idx * 2400,
    cache_read: 9000 + idx * 1200,
    cache_write: 4200 + idx * 800,
    cost_cny: Number((18 + idx * 2.4).toFixed(1)),
    cost_usd: Number((2.5 + idx * 0.33).toFixed(2)),
    sessions: 4 + (idx % 4),
    messages: 18 + idx * 3,
    tasks_done: 5 + idx,
    tasks_active: idx < 4 ? 1 : 0,
    flow_participations: 8 + idx * 2,
    merit_score: 96 - idx * 3,
    merit_rank: idx + 1,
    last_active: demoIso(idx * 9 + 4),
    heartbeat: { status: idx < 5 ? 'active' : idx % 3 === 0 ? 'warn' : 'idle', label: idx < 5 ? '在线处理中' : '空闲待命' },
    participated_tasks: [
      { id: 'JJC-240410-001', title: '梳理海外 AI 产品监测面板重构方案', state: 'Doing' },
      { id: 'JJC-240410-002', title: '验证全网搜索高级筛选与摘要展示逻辑', state: 'ReviewCenter' },
    ],
  })),
  totals: { tasks_done: 126, cost_cny: 284.5 },
  top_agent: '总览协调',
};

const DEMO_AGENTS_STATUS: AgentsStatusData = {
  ok: true,
  gateway: { alive: true, probe: true, status: 'fallback ready' },
  agents: Object.entries(AGENT_ARCHITECTURE).map(([id, meta], idx) => ({
    id,
    label: meta.label,
    emoji: meta.emoji,
    role: meta.role,
    status: idx < 4 ? 'running' : idx % 4 === 0 ? 'offline' : 'idle',
    statusLabel: idx < 4 ? '处理中' : idx % 4 === 0 ? '离线待唤醒' : '待命中',
    lastActive: demoIso(idx * 11 + 3),
  })),
  checkedAt: demoIso(1),
};

const DEMO_COLLAB_BUSY: CollabAgentBusyResult = {
  ok: true,
  busy: [
    {
      agent_id: 'plan_center',
      name: '方案整理',
      emoji: '🧭',
      role: '帮助整理方案与步骤',
      state: 'active',
      label: '正在主持结构梳理',
      source_type: 'meeting',
      source_id: 'collab-demo-001',
      occupancy_kind: 'meeting',
      session_id: 'collab-demo-001',
      topic: '智能会商界面重构',
      mode: 'meeting',
      stage: 'roundtable',
      round: 2,
      moderator_id: 'control_center',
      task_id: 'JJC-240410-001',
      task_title: '梳理海外 AI 产品监测面板重构方案',
      task_state: 'Doing',
      task_org: 'control_center',
      claimed_by: 'control_center',
      reason: '作为当前主持人参与会商',
      updated_at: Date.now() - 2 * 60 * 1000,
    },
    {
      agent_id: 'review_center',
      name: '结果检查',
      emoji: '🔍',
      role: '帮助检查结果是否完整',
      state: 'reserved',
      label: '等待下一轮复核',
      source_type: 'task',
      source_id: 'JJC-240410-002',
      occupancy_kind: 'task_reserved',
      session_id: 'task-review-001',
      topic: '搜索配置复核',
      mode: 'task',
      stage: 'verification',
      round: 1,
      moderator_id: 'control_center',
      task_id: 'JJC-240410-002',
      task_title: '验证全网搜索高级筛选与摘要展示逻辑',
      task_state: 'ReviewCenter',
      task_org: 'search_specialist',
      claimed_by: 'dispatch_center',
      reason: '为搜索结果复核预留检查资源',
      updated_at: Date.now() - 6 * 60 * 1000,
    },
    {
      agent_id: 'search_specialist',
      name: '搜索助手',
      emoji: '🌐',
      role: '帮助查找全网信息与线索',
      state: 'active',
      label: '正在处理搜索请求',
      source_type: 'task',
      source_id: 'JJC-240410-002',
      occupancy_kind: 'task_active',
      session_id: 'search-task-001',
      topic: '高级搜索体验验证',
      mode: 'task',
      stage: 'searching',
      round: 1,
      moderator_id: 'control_center',
      task_id: 'JJC-240410-002',
      task_title: '验证全网搜索高级筛选与摘要展示逻辑',
      task_state: 'ReviewCenter',
      task_org: 'search_specialist',
      claimed_by: 'search_specialist',
      reason: '全网搜索任务执行中',
      updated_at: Date.now() - 1 * 60 * 1000,
    },
  ],
  sessions: [
    {
      session_id: 'collab-demo-001',
      topic: '智能会商界面重构',
      round: 2,
      phase: 'discussion',
      mode: 'meeting',
      stage: 'roundtable',
      moderator_id: 'control_center',
      moderator_name: '总览协调',
      agent_count: 4,
      message_count: 12,
      run_state: 'running',
      auto_run: true,
      last_advanced_at: Date.now() - 2 * 60 * 1000,
      next_run_at: Date.now() + 3 * 60 * 1000,
      updated_at: Date.now() - 1 * 60 * 1000,
      claimed_agents: ['control_center', 'plan_center', 'review_center', 'expert_curator'],
      conflicted_agents: [],
      yielded_agents: [],
    },
  ],
  tasks: [
    {
      task_id: 'JJC-240410-001',
      task_title: '梳理海外 AI 产品监测面板重构方案',
      task_state: 'Doing',
      task_org: 'control_center',
      run_state: 'running',
      occupancy_kind: 'meeting',
      claimed_agents: ['control_center', 'plan_center'],
      updated_at: Date.now() - 2 * 60 * 1000,
    },
    {
      task_id: 'JJC-240410-002',
      task_title: '验证全网搜索高级筛选与摘要展示逻辑',
      task_state: 'ReviewCenter',
      task_org: 'search_specialist',
      run_state: 'running',
      occupancy_kind: 'task_active',
      claimed_agents: ['search_specialist', 'review_center'],
      updated_at: Date.now() - 1 * 60 * 1000,
    },
  ],
  updated_at: Date.now(),
};

const DEMO_SEARCH_BRIEF: SearchBrief = {
  date: '20260410',
  generated_at: demoIso(5),
  categories: {
    政治: [
      {
        title: '多国开始评估 AI 基础设施安全与数据治理框架',
        summary: '政策层面开始同步关注算力、模型透明度与跨境数据流动。',
        link: 'https://example.com/politics-ai-governance',
        source: 'Policy Brief',
        pub_date: demoIso(140),
      },
    ],
    经济: [
      {
        title: '企业级 AI 投入从试点转向流程重构，预算集中在可见 ROI 场景',
        summary: '市场更关注能否真正落地到分析、运营和协同台。',
        link: 'https://example.com/economy-ai-roi',
        source: 'Market Watch',
        pub_date: demoIso(220),
      },
    ],
    AI大模型: [
      {
        title: '新一轮多模型协作产品强调编排、会商与可解释的结果流',
        summary: '产品竞争焦点正从单点问答转向工作流可视化和多角色协作。',
        link: 'https://example.com/ai-multi-agent-workflow',
        source: 'AI Daily',
        image: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1200&q=80',
        pub_date: demoIso(90),
      },
      {
        title: '搜索型 AI 产品开始把摘要、排序、时效与主题控制前置到主界面',
        summary: '界面设计趋势是默认简单、细节可展开，同时保留状态反馈。',
        link: 'https://example.com/ai-search-ux',
        source: 'Product Signals',
        pub_date: demoIso(40),
      },
    ],
    公司: [
      {
        title: '协同工作台类产品正在重做导航，把高频系统操作移到侧边 Dock',
        summary: '设置、刷新和身份相关入口更适合放在固定快捷区，而非顶部主导航。',
        link: 'https://example.com/company-workspace-navigation',
        source: 'Workspace Notes',
        pub_date: demoIso(70),
      },
    ],
  },
};

const DEMO_SEARCH_CATEGORIES = [
  '政治',
  '经济',
  'AI大模型',
  '公司',
  '海外动态',
].map((name) => ({
  name,
  enabled: ['政治', '经济', 'AI大模型', '公司'].includes(name),
}));

const DEMO_SUB_CONFIG: SubConfig = {
  categories: DEMO_SEARCH_CATEGORIES,
  keywords: ['多模型协作', '交互逻辑', '信息架构', '界面重构'],
  custom_feeds: [
    { name: 'Design Signals', url: 'https://example.com/design-signals.xml', category: 'AI大模型' },
    { name: 'Policy Radar', url: 'https://example.com/policy-radar.xml', category: '政治' },
  ],
  feishu_webhook: '',
};

const EMPTY_LIVE_STATUS: LiveStatus = {
  tasks: [],
  syncStatus: { ok: false, mode: 'auth-required' },
};

const EMPTY_AGENT_CONFIG: AgentConfig = {
  agents: [],
  knownModels: [],
  dispatchChannel: '',
};

const EMPTY_AGENTS_OVERVIEW: AgentsOverviewData = {
  agents: [],
  totals: { tasks_done: 0, cost_cny: 0 },
  top_agent: '',
};

const EMPTY_AGENTS_STATUS: AgentsStatusData = {
  ok: false,
  gateway: { alive: false, probe: false, status: 'unavailable' },
  agents: [],
  checkedAt: '',
};

const EMPTY_COLLAB_BUSY: CollabAgentBusyResult = {
  ok: false,
  busy: [],
  sessions: [],
  tasks: [],
};

const EMPTY_SEARCH_BRIEF: SearchBrief = {
  categories: {},
};

const EMPTY_SUB_CONFIG: SubConfig = {
  categories: [],
  keywords: [],
  custom_feeds: [],
  feishu_webhook: '',
};

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
  tplCatFilter: '全部',
  selectedAgent: null,
  modalTaskId: null,
  countdown: 5,
  locale: initialLocale,
  themeMode: initialThemeMode,
  resolvedTheme: initialResolvedTheme,

  toasts: [],

  setActiveTab: (tab) => {
    const nextTab: TabKey = tab;
    set({ activeTab: nextTab });
    const s = get();
    if (['skills', 'agents'].includes(nextTab) && !s.agentConfig) s.loadAgentConfig();
    if (nextTab === 'agents' && !s.agentsOverviewData) s.loadAgentsOverview();
    if (nextTab === 'monitor') {
      s.loadAgentsStatus();
      s.loadCollabBusy();
    }
    if (nextTab === 'collaboration' || nextTab === 'tasks') s.loadCollabBusy();
    if (nextTab === 'web_search' && !s.searchBrief) s.loadWebSearch();
  },
  setTaskFilter: (f) => set({ taskFilter: f }),
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
  setThemeMode: (mode) => {
    persistThemeMode(mode);
    const resolvedTheme = applyTheme(mode);
    set({ themeMode: mode, resolvedTheme });
  },
  cycleThemeMode: () => {
    const current = get().themeMode;
    const next: ThemeMode = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
    persistThemeMode(next);
    const resolvedTheme = applyTheme(next);
    set({ themeMode: next, resolvedTheme });
  },
  refreshThemeFromSystem: () => {
    const mode = get().themeMode;
    if (mode !== 'system') {
      set({ resolvedTheme: resolveTheme(mode) });
      return;
    }
    set({ resolvedTheme: applyTheme(mode) });
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
      set({
        liveStatus: {
          tasks: Array.isArray(data?.tasks) ? data.tasks : [],
          syncStatus: data?.syncStatus && typeof data.syncStatus === 'object'
            ? data.syncStatus
            : EMPTY_LIVE_STATUS.syncStatus,
        },
      });
      const s = get();
      if (!s.agentsOverviewData) {
        api.agentsOverview()
          .then((d) => set({ agentsOverviewData: d?.agents?.length ? d : EMPTY_AGENTS_OVERVIEW }))
          .catch(() => set({ agentsOverviewData: EMPTY_AGENTS_OVERVIEW }));
      }
    } catch {
      set({ liveStatus: EMPTY_LIVE_STATUS });
      if (!get().agentsOverviewData) set({ agentsOverviewData: EMPTY_AGENTS_OVERVIEW });
    }
  },

  loadAgentConfig: async () => {
    try {
      const cfg = await api.agentConfig();
      const log = await api.modelChangeLog().catch(() => []);
      const normalizedAgents = Array.isArray(cfg?.agents)
        ? cfg.agents.map((agent) => ({
          ...agent,
          emoji: typeof agent?.emoji === 'string' && agent.emoji.trim() ? agent.emoji : '🤖',
        }))
        : [];
      set({
        agentConfig: {
          agents: normalizedAgents,
          knownModels: Array.isArray(cfg?.knownModels) ? cfg.knownModels : [],
          dispatchChannel: typeof cfg?.dispatchChannel === 'string' ? cfg.dispatchChannel : '',
        },
        changeLog: Array.isArray(log) ? log : [],
      });
    } catch {
      set({ agentConfig: EMPTY_AGENT_CONFIG, changeLog: [] });
    }
  },

  loadAgentsOverview: async () => {
    try {
      const data = await api.agentsOverview();
      set({ agentsOverviewData: data?.agents?.length ? data : EMPTY_AGENTS_OVERVIEW });
    } catch {
      set({ agentsOverviewData: EMPTY_AGENTS_OVERVIEW });
    }
  },

  loadAgentsStatus: async () => {
    try {
      const data = await api.agentsStatus();
      set({ agentsStatusData: data?.agents?.length ? data : EMPTY_AGENTS_STATUS });
    } catch {
      set({ agentsStatusData: EMPTY_AGENTS_STATUS });
    }
  },

  loadCollabBusy: async () => {
    try {
      const data = await api.globalAgentBusy();
      const hasBusyData = !!((data?.busy?.length || 0) + (data?.sessions?.length || 0) + (data?.tasks?.length || 0));
      set({ collabAgentBusyData: hasBusyData ? data : EMPTY_COLLAB_BUSY });
    } catch {
      set({ collabAgentBusyData: EMPTY_COLLAB_BUSY });
    }
  },

  loadWebSearch: async () => {
    try {
      const [brief, config] = await Promise.all([api.searchBrief(), api.searchConfig()]);
      set({
        searchBrief: brief && Object.keys(brief.categories || {}).length ? brief : EMPTY_SEARCH_BRIEF,
        subConfig: config?.categories?.length ? config : EMPTY_SUB_CONFIG,
      });
    } catch {
      set({ searchBrief: EMPTY_SEARCH_BRIEF, subConfig: EMPTY_SUB_CONFIG });
    }
  },

  loadSubConfig: async () => {
    try {
      const config = await api.searchConfig();
      set({ subConfig: config?.categories?.length ? config : EMPTY_SUB_CONFIG });
    } catch {
      set({ subConfig: EMPTY_SUB_CONFIG });
    }
  },

  loadAll: async () => {
    const s = get();
    await Promise.all([
      s.loadLive(),
      s.loadCollabBusy(),
      s.activeTab === 'monitor' ? s.loadAgentsStatus() : Promise.resolve(),
      ['agents', 'skills'].includes(s.activeTab) ? s.loadAgentConfig() : Promise.resolve(),
      s.activeTab === 'agents' ? s.loadAgentsOverview() : Promise.resolve(),
      s.activeTab === 'web_search' ? s.loadWebSearch() : Promise.resolve(),
    ]);
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
