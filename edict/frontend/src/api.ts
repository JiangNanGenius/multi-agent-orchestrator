/**
 * API 层 — 对接 dashboard/server.py
 * 生产环境从同源 (port 7891) 请求，开发环境可通过 VITE_API_URL 指定
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

// ── 通用请求 ──

async function fetchJ<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function postJ<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  return res.json();
}

// ── API 接口 ──

export const api = {
  // 认证
  authStatus: () => fetchJ<AuthStatus>(`${API_BASE}/api/auth/status`),
  login: (username: string, password: string) =>
    postJ<AuthLoginResult>(`${API_BASE}/api/auth/login`, { username, password }),
  logout: () =>
    postJ<ActionResult>(`${API_BASE}/api/auth/logout`, {}),
  firstChange: (currentPassword: string, newPassword: string, newUsername?: string) =>
    postJ<AuthLoginResult>(`${API_BASE}/api/auth/first-change`, { currentPassword, newPassword, newUsername }),
  changePassword: (currentPassword: string, newPassword: string) =>
    postJ<ActionResult>(`${API_BASE}/api/auth/change-password`, { currentPassword, newPassword }),
  changeUsername: (currentPassword: string, newUsername: string) =>
    postJ<AuthLoginResult>(`${API_BASE}/api/auth/change-username`, { currentPassword, newUsername }),

  // 核心数据
  liveStatus: () => fetchJ<LiveStatus>(`${API_BASE}/api/live-status`),
  agentConfig: () => fetchJ<AgentConfig>(`${API_BASE}/api/agent-config`),
  modelChangeLog: () => fetchJ<ChangeLogEntry[]>(`${API_BASE}/api/model-change-log`).catch(() => []),
  agentsOverview: () => fetchJ<AgentsOverviewData>(`${API_BASE}/api/agents-overview`),
  searchBrief: () => fetchJ<SearchBrief>(`${API_BASE}/api/search-brief`),
  searchConfig: () => fetchJ<SubConfig>(`${API_BASE}/api/search-config`),
  agentsStatus: () => fetchJ<AgentsStatusData>(`${API_BASE}/api/agents-status`),
  globalAgentBusy: () => fetchJ<CollabAgentBusyResult>(`${API_BASE}/api/global-agent-busy`),

  // 任务实时动态
  taskActivity: (id: string) =>
    fetchJ<TaskActivityData>(`${API_BASE}/api/task-activity/${encodeURIComponent(id)}`),
  schedulerState: (id: string) =>
    fetchJ<SchedulerStateData>(`${API_BASE}/api/scheduler-state/${encodeURIComponent(id)}`),

  // 技能内容
  skillContent: (agentId: string, skillName: string) =>
    fetchJ<SkillContentResult>(
      `${API_BASE}/api/skill-content/${encodeURIComponent(agentId)}/${encodeURIComponent(skillName)}`
    ),

  // 操作类
  setModel: (agentId: string, model: string) =>
    postJ<ActionResult>(`${API_BASE}/api/set-model`, { agentId, model }),
  setDispatchChannel: (channel: string) =>
    postJ<ActionResult>(`${API_BASE}/api/set-dispatch-channel`, { channel }),
  agentWake: (agentId: string, message = '') =>
    postJ<ActionResult>(`${API_BASE}/api/agent-wake`, { agentId, message }),
  sendAgentCommand: (agentId: string, message: string) =>
    postJ<ActionResult>(`${API_BASE}/api/agent-command`, { agentId, message }),
  agentActivity: (agentId: string) =>
    fetchJ<AgentActivityResult>(`${API_BASE}/api/agent-activity/${encodeURIComponent(agentId)}`),
  taskAction: (taskId: string, action: string, reason: string) =>
    postJ<ActionResult>(`${API_BASE}/api/task-action`, { taskId, action, reason }),
  reviewAction: (taskId: string, action: string, comment: string) =>
    postJ<ActionResult>(`${API_BASE}/api/review-action`, { taskId, action, comment }),
  advanceState: (taskId: string, comment: string) =>
    postJ<ActionResult>(`${API_BASE}/api/advance-state`, { taskId, comment }),
  archiveTask: (taskId: string, archived: boolean) =>
    postJ<ActionResult>(`${API_BASE}/api/archive-task`, { taskId, archived }),
  archiveAllDone: () =>
    postJ<ActionResult & { count?: number }>(`${API_BASE}/api/archive-task`, { archiveAllDone: true }),
  schedulerScan: (thresholdSec = 180) =>
    postJ<ActionResult & { count?: number; actions?: ScanAction[]; checkedAt?: string }>(
      `${API_BASE}/api/scheduler-scan`,
      { thresholdSec }
    ),
  schedulerRetry: (taskId: string, reason: string) =>
    postJ<ActionResult>(`${API_BASE}/api/scheduler-retry`, { taskId, reason }),
  schedulerEscalate: (taskId: string, reason: string) =>
    postJ<ActionResult>(`${API_BASE}/api/scheduler-escalate`, { taskId, reason }),
  schedulerRollback: (taskId: string, reason: string) =>
    postJ<ActionResult>(`${API_BASE}/api/scheduler-rollback`, { taskId, reason }),
  schedulerConfig: (taskId: string, config: SchedulerInfo) =>
    postJ<ActionResult & { scheduler?: SchedulerInfo; checkedAt?: string }>(`${API_BASE}/api/scheduler-config`, { taskId, config }),
  refreshSearch: () =>
    postJ<ActionResult>(`${API_BASE}/api/search-brief/refresh`, {}),
  saveSearchConfig: (config: SubConfig) =>
    postJ<ActionResult>(`${API_BASE}/api/search-config`, config),
  addSkill: (agentId: string, skillName: string, description: string, trigger: string) =>
    postJ<ActionResult>(`${API_BASE}/api/add-skill`, { agentId, skillName, description, trigger }),

  // 远程 Skills 管理
  addRemoteSkill: (agentId: string, skillName: string, sourceUrl: string, description?: string) =>
    postJ<ActionResult & { skillName?: string; agentId?: string; source?: string; localPath?: string; size?: number; addedAt?: string }>(
      `${API_BASE}/api/add-remote-skill`, { agentId, skillName, sourceUrl, description: description || '' }
    ),
  remoteSkillsList: () =>
    fetchJ<RemoteSkillsListResult>(`${API_BASE}/api/remote-skills-list`),
  updateRemoteSkill: (agentId: string, skillName: string) =>
    postJ<ActionResult>(`${API_BASE}/api/update-remote-skill`, { agentId, skillName }),
  removeRemoteSkill: (agentId: string, skillName: string) =>
    postJ<ActionResult>(`${API_BASE}/api/remove-remote-skill`, { agentId, skillName }),

  createTask: (data: CreateTaskPayload) =>
    postJ<ActionResult & { taskId?: string }>(`${API_BASE}/api/create-task`, data),
  taskAppendMessage: (taskId: string, agentId: string, message: string) =>
    postJ<ActionResult>(`${API_BASE}/api/task-append-message`, { taskId, agentId, message }),

  // ── 多角色协同讨论 ──
  collabDiscussStart: (
    topic: string,
    agentIds: string[],
    taskId?: string,
    preferredMode: 'auto' | 'meeting' | 'chat' = 'auto',
    moderatorId?: string,
    selectAll = false,
  ) =>
    postJ<CollabDiscussResult>(`${API_BASE}/api/collab-discuss/start`, {
      topic,
      agents: agentIds,
      taskId,
      preferredMode,
      moderatorId,
      selectAll,
    }),
  collabDiscussAdvance: (
    sessionId: string,
    userMessage?: string,
    constraint?: string,
    intent: 'auto' | 'meeting' | 'chat' | 'user_message' | 'constraint' | 'next_round' | 'next_stage' = 'auto',
    speakerIds: string[] = [],
    stageAction?: string,
  ) =>
    postJ<CollabDiscussResult>(`${API_BASE}/api/collab-discuss/advance`, {
      sessionId,
      userMessage,
      constraint,
      intent,
      speakerIds,
      stageAction,
    }),
  collabDiscussPause: (sessionId: string, reason = '') =>
    postJ<CollabDiscussResult>(`${API_BASE}/api/collab-discuss/pause`, { sessionId, reason }),
  collabDiscussResume: (sessionId: string, autoRun?: boolean, reason = '') =>
    postJ<CollabDiscussResult>(`${API_BASE}/api/collab-discuss/resume`, {
      sessionId,
      reason,
      ...(typeof autoRun === 'boolean' ? { autoRun } : {}),
    }),
  collabDiscussConclude: (sessionId: string) =>
    postJ<ActionResult & { summary?: string; minutes?: CollabMinute[]; decision_items?: string[]; open_questions?: string[]; action_items?: string[] }>(`${API_BASE}/api/collab-discuss/conclude`, { sessionId }),
  collabDiscussDestroy: (sessionId: string) =>
    postJ<ActionResult>(`${API_BASE}/api/collab-discuss/destroy`, { sessionId }),
  collabDiscussAgentBusy: () =>
    fetchJ<CollabAgentBusyResult>(`${API_BASE}/api/collab-discuss/agent-busy`),
  collabDiscussRunStatus: (sessionId: string) =>
    fetchJ<CollabRunStatus>(`${API_BASE}/api/collab-discuss/run-status/${encodeURIComponent(sessionId)}`),
  collabDiscussFate: () =>
    fetchJ<{ ok: boolean; event: string }>(`${API_BASE}/api/collab-discuss/fate`),
};

// ── Types ──

export interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface AuthStatus {
  enabled: boolean;
  configured: boolean;
  username: string;
  mustChangePassword: boolean;
  authenticated: boolean;
  currentUser?: string | null;
  authFile?: string;
}
export interface AuthLoginResult extends ActionResult {
  token?: string;
  username?: string;
  mustChangePassword?: boolean;
}

export interface FlowEntry {
  at: string;
  from: string;
  to: string;
  remark: string;
}

export interface TodoItem {
  id: string | number;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed';
  detail?: string;
}

export interface Heartbeat {
  status: 'active' | 'warn' | 'stalled' | 'unknown' | 'idle';
  label: string;
}

export interface ReplyMeta {
  channel?: string;
  channelFamily?: string;
  policy?: string;
  effectivePolicy?: string;
  fallbackMode?: string;
  transport?: string;
  parsedFromText?: boolean;
  hasNoReplyPrefix?: boolean;
  hasReplyContext?: boolean;
  markers?: string[];
  availableTargets?: string[];
  targetMessageId?: string;
  threadId?: string;
  rootId?: string;
  chatId?: string;
  senderId?: string;
  senderOpenId?: string;
  sourcePaths?: Record<string, string>;
}

export interface SourceMeta {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  updatedAt?: number;
  ageMs?: number;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  channel?: string;
  originLabel?: string;
  originChannel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  replyMeta?: ReplyMeta;
  [key: string]: unknown;
}

export interface Task {
  id: string;
  title: string;
  state: string;
  org: string;
  currentDept?: string;
  targetDept?: string;
  targetDepts?: string[];
  now: string;
  eta: string;
  block: string;
  ac: string;
  output: string;
  heartbeat: Heartbeat;
  flow_log: FlowEntry[];
  todos: TodoItem[];
  review_round: number;
  archived: boolean;
  archivedAt?: string;
  updatedAt?: string;
  sourceMeta?: SourceMeta;
  activity?: ActivityEntry[];
  _prev_state?: string;
}

export interface SyncStatus {
  ok: boolean;
  [key: string]: unknown;
}

export interface LiveStatus {
  tasks: Task[];
  syncStatus: SyncStatus;
}

export interface AgentInfo {
  id: string;
  label: string;
  emoji: string;
  role: string;
  model: string;
  skills: SkillInfo[];
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export interface KnownModel {
  id: string;
  label: string;
  provider: string;
}

export interface AgentConfig {
  agents: AgentInfo[];
  knownModels?: KnownModel[];
  dispatchChannel?: string;
}

export interface ChangeLogEntry {
  at: string;
  agentId: string;
  oldModel: string;
  newModel: string;
  rolledBack?: boolean;
}

export interface OfficialInfo {
  id: string;
  label: string;
  emoji: string;
  role: string;
  rank: string;
  model: string;
  model_short: string;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_write: number;
  cost_cny: number;
  cost_usd: number;
  sessions: number;
  messages: number;
  tasks_done: number;
  tasks_active: number;
  flow_participations: number;
  merit_score: number;
  merit_rank: number;
  last_active: string;
  heartbeat: Heartbeat;
  participated_tasks: { id: string; title: string; state: string }[];
}

export interface AgentsOverviewData {
  agents: OfficialInfo[];
  totals: { tasks_done: number; cost_cny: number };
  top_agent: string;
}

export interface AgentStatusInfo {
  id: string;
  label: string;
  emoji: string;
  role: string;
  status: 'running' | 'idle' | 'offline' | 'unconfigured';
  statusLabel: string;
  lastActive?: string;
}

export interface GatewayStatus {
  alive: boolean;
  probe: boolean;
  status: string;
}

export interface AgentsStatusData {
  ok: boolean;
  gateway: GatewayStatus;
  agents: AgentStatusInfo[];
  checkedAt: string;
}

export interface SearchResultItem {
  title: string;
  summary?: string;
  desc?: string;
  link: string;
  source: string;
  image?: string;
  pub_date?: string;
}

export interface SearchBrief {
  date?: string;
  generated_at?: string;
  categories: Record<string, SearchResultItem[]>;
}

export interface SubCategoryConfig {
  name: string;
  enabled: boolean;
}

export interface CustomFeed {
  name: string;
  url: string;
  category: string;
}

export interface SubConfig {
  categories: SubCategoryConfig[];
  keywords: string[];
  custom_feeds: CustomFeed[];
  feishu_webhook: string;
}

export interface ActivityEntry {
  kind: string;
  at?: number | string;
  text?: string;
  message?: string;
  summary?: string;
  thinking?: string;
  agent?: string;
  from?: string;
  to?: string;
  remark?: string;
  tools?: { name: string; input_preview?: string }[];
  tool?: string;
  output?: string;
  exitCode?: number | null;
  items?: TodoItem[];
  diff?: {
    changed?: { id: string; from: string; to: string }[];
    added?: { id: string; title: string }[];
    removed?: { id: string; title: string }[];
  };
}

export interface PhaseDuration {
  phase: string;
  durationSec: number;
  durationText: string;
  ongoing?: boolean;
}

export interface TodosSummary {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  percent: number;
}

export interface ResourceSummary {
  totalTokens?: number;
  totalCost?: number;
  totalElapsedSec?: number;
}

export interface TaskActivityData {
  ok: boolean;
  message?: string;
  error?: string;
  activity?: ActivityEntry[];
  relatedAgents?: string[];
  agentLabel?: string;
  lastActive?: string;
  phaseDurations?: PhaseDuration[];
  totalDuration?: string;
  todosSummary?: TodosSummary;
  resourceSummary?: ResourceSummary;
}

export interface AgentActivityResult {
  ok: boolean;
  agentId?: string;
  activity?: ActivityEntry[];
  error?: string;
}

export interface SchedulerInfo {
  retryCount?: number;
  escalationLevel?: number;
  lastDispatchStatus?: string;
  stallThresholdSec?: number;
  enabled?: boolean;
  lastProgressAt?: string;
  lastDispatchAt?: string;
  lastDispatchAgent?: string;
  autoRollback?: boolean;
  maxRetry?: number;
  maxRollback?: number;
  rollbackCount?: number;
  lastEscalatedAt?: string;
  lastRetryAt?: string;
  snapshot?: {
    state?: string;
    org?: string;
    now?: string;
    savedAt?: string;
    note?: string;
  };
}

export interface SchedulerStateData {
  ok: boolean;
  error?: string;
  scheduler?: SchedulerInfo;
  stalledSec?: number;
}

export interface SkillContentResult {
  ok: boolean;
  name?: string;
  agent?: string;
  content?: string;
  path?: string;
  error?: string;
}

export interface ScanAction {
  taskId: string;
  action: string;
  to?: string;
  toState?: string;
  stalledSec?: number;
}

export interface CreateTaskPayload {
  title: string;
  org: string;
  owner?: string;
  targetDept?: string;
  targetDepts?: string[];
  priority?: string;
  templateId?: string;
  params?: Record<string, string>;
}

export interface RemoteSkillItem {
  skillName: string;
  agentId: string;
  sourceUrl: string;
  description: string;
  localPath: string;
  addedAt: string;
  lastUpdated: string;
  status: 'valid' | 'not-found' | string;
}

export interface RemoteSkillsListResult {
  ok: boolean;
  remoteSkills?: RemoteSkillItem[];
  count?: number;
  listedAt?: string;
  error?: string;
}

// ── 协同讨论 ──

export interface CollabMinute {
  round: number;
  stage: string;
  content: string;
  timestamp: number;
}

export interface CollabAgentBusyEntry {
  agent_id: string;
  name: string;
  emoji: string;
  role: string;
  state: 'idle' | 'reserved' | 'active' | 'paused' | 'yielding' | 'cooldown' | string;
  label: string;
  source_type?: 'meeting' | 'chat' | 'task' | string;
  source_id?: string;
  occupancy_kind?: 'meeting' | 'chat' | 'task_active' | 'task_reserved' | 'task_paused' | 'task_blocked' | string;
  session_id: string;
  topic: string;
  mode: string;
  stage: string;
  round: number;
  moderator_id: string;
  task_id?: string;
  task_title?: string;
  task_state?: string;
  task_org?: string;
  claimed_by: string;
  reason: string;
  updated_at: number;
}

export interface GlobalBusyTaskItem {
  task_id: string;
  task_title: string;
  task_state: string;
  task_org: string;
  run_state?: 'running' | 'paused' | string;
  occupancy_kind?: string;
  claimed_agents?: string[];
  updated_at?: number;
}

export interface CollabSessionListItem {
  session_id: string;
  topic: string;
  round: number;
  phase: string;
  mode?: 'meeting' | 'chat';
  stage?: string;
  moderator_id?: string;
  moderator_name?: string;
  agent_count?: number;
  message_count?: number;
  run_state?: 'running' | 'paused' | 'concluded' | string;
  auto_run?: boolean;
  last_advanced_at?: number | null;
  next_run_at?: number | null;
  updated_at?: number | null;
  claimed_agents?: string[];
  conflicted_agents?: string[];
  yielded_agents?: string[];
}

export interface CollabAgentBusyResult {
  ok: boolean;
  busy: CollabAgentBusyEntry[];
  sessions: CollabSessionListItem[];
  tasks?: GlobalBusyTaskItem[];
  updated_at?: number;
  error?: string;
}

export interface CollabRunStatus {
  ok: boolean;
  session_id?: string;
  phase?: string;
  run_state?: 'running' | 'paused' | 'concluded' | string;
  auto_run?: boolean;
  auto_round_limit?: number;
  auto_round_count?: number;
  last_advanced_at?: number | null;
  next_run_at?: number | null;
  claimed_agents?: string[];
  conflicted_agents?: string[];
  yielded_agents?: string[];
  busy_snapshot?: CollabAgentBusyEntry[];
  error?: string;
}

export interface CollabDiscussResult {
  ok: boolean;
  session_id?: string;
  topic?: string;
  round?: number;
  phase?: string;
  mode?: 'meeting' | 'chat';
  stage?: string;
  moderator_id?: string;
  moderator_name?: string;
  speaker_queue?: string[];
  agenda?: string;
  minutes?: CollabMinute[];
  trace?: Array<Record<string, unknown>>;
  decision_items?: string[];
  open_questions?: string[];
  action_items?: string[];
  stage_history?: Array<Record<string, unknown>>;
  select_all?: boolean;
  run_state?: 'running' | 'paused' | 'concluded' | string;
  auto_run?: boolean;
  run_interval_sec?: number;
  auto_round_limit?: number;
  auto_round_count?: number;
  last_advanced_at?: number | null;
  next_run_at?: number | null;
  claimed_agents?: string[];
  conflicted_agents?: string[];
  yielded_agents?: string[];
  busy_snapshot?: CollabAgentBusyEntry[];
  agents?: Array<{
    id: string;
    name: string;
    emoji: string;
    role: string;
    personality: string;
    speaking_style: string;
  }>;
  messages?: Array<{
    type: string;
    content: string;
    agent_id?: string;
    agent_name?: string;
    emotion?: string;
    action?: string;
    timestamp?: number;
  }>;
  new_messages?: Array<{
    type?: string;
    agent_id?: string;
    agent_name?: string;
    name?: string;
    content: string;
    emotion?: string;
    action?: string;
  }>;
  scene_note?: string;
  total_messages?: number;
  summary?: string;
  error?: string;
}
