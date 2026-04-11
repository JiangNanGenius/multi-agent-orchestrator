import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api, type ActionResult, type ActivityEntry, type Task } from '../api';
import { useStore, stateLabel } from '../store';
import { pickLocaleText, type Locale } from '../i18n';

type DraftMessageRole = 'assistant' | 'user' | 'system';

type DraftMessage = {
  id: string;
  role: DraftMessageRole;
  content: string;
  at: string;
  kind?: 'question' | 'summary' | 'info';
};

type DraftState = {
  messages: DraftMessage[];
  input: string;
  selectedSessionId: string;
  updatedAt: string;
  intentKey?: string;
};

export type ChatIntent = {
  key: string;
  labelZh: string;
  labelEn: string;
  prefillZh: string;
  prefillEn: string;
  helperZh?: string;
  helperEn?: string;
};

export type DraftReview = {
  ready: boolean;
  title: string;
  summary: string;
  followUp: string;
  missing?: string[];
};

type SidebarRenderArgs = {
  locale: Locale;
  review: DraftReview;
  draftText: string;
  selectedTask: Task | null;
};

type Props = {
  storageKey: string;
  agentId: string;
  agentLabel: string;
  agentEmoji: string;
  accentColor: string;
  accentSoft: string;
  headerKickerZh: string;
  headerKickerEn: string;
  headerTitleZh: string;
  headerTitleEn: string;
  headerDescZh: string;
  headerDescEn: string;
  handlerNoteZh: string;
  handlerNoteEn: string;
  introZh: string;
  introEn: string;
  draftLabelZh: string;
  draftLabelEn: string;
  taskFilter: (task: Task) => boolean;
  intents: ChatIntent[];
  buildDraftReview: (draftText: string, locale: Locale) => DraftReview;
  createTask: (draftText: string, review: DraftReview) => Promise<ActionResult & { taskId?: string }>;
  appendTaskMessage?: (taskId: string, text: string) => Promise<ActionResult>;
  renderSidebar?: (args: SidebarRenderArgs) => React.ReactNode;
};

type MobilePanelKey = 'sessions' | 'conversation' | 'intents';

const TERMINAL_STATES = new Set(['Done', 'Cancelled']);

function nowIso() {
  return new Date().toISOString();
}

function messageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeActivity(entry: ActivityEntry, locale: Locale): string {
  if (entry.message) return entry.message;
  if (entry.summary) return entry.summary;
  if (entry.text) return entry.text;
  if (entry.remark) return entry.remark;
  if (entry.output) return entry.output;
  if (entry.thinking) return entry.thinking;
  if (entry.tool) return `${pickLocaleText(locale, '工具调用：', 'Tool call: ')}${entry.tool}`;
  if (entry.from || entry.to) return `${entry.from || '—'} → ${entry.to || '—'}`;
  if (entry.items?.length) {
    return entry.items
      .map((item) => `${item.status === 'completed' ? '✅' : item.status === 'in-progress' ? '🟡' : '⚪'} ${item.title}`)
      .join('\n');
  }
  return pickLocaleText(locale, '暂无摘要', 'No summary');
}

function readDraftState(storageKey: string, locale: Locale, agentEmoji: string, agentLabel: string): DraftState {
  if (typeof window === 'undefined') {
    return {
      messages: [{
        id: messageId('welcome'),
        role: 'assistant',
        content: pickLocaleText(locale, `${agentEmoji} 这里由${agentLabel}为你提供协助。请先描述目标、现状和期望结果，我会先追问补足信息，再生成确认摘要。`, `${agentEmoji} ${agentLabel} is here to help. Please describe your goal, current situation, and expected result first. I will ask follow-up questions before generating a confirmation summary.`),
        at: nowIso(),
        kind: 'info',
      }],
      input: '',
      selectedSessionId: 'draft',
      updatedAt: nowIso(),
    };
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DraftState>;
      if (parsed && Array.isArray(parsed.messages)) {
        return {
          messages: parsed.messages,
          input: typeof parsed.input === 'string' ? parsed.input : '',
          selectedSessionId: typeof parsed.selectedSessionId === 'string' ? parsed.selectedSessionId : 'draft',
          updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
          intentKey: typeof parsed.intentKey === 'string' ? parsed.intentKey : undefined,
        };
      }
    }
  } catch {
    // ignore broken local cache
  }

  return {
    messages: [{
      id: messageId('welcome'),
      role: 'assistant',
      content: pickLocaleText(locale, `${agentEmoji} 请直接告诉我你要处理什么，我会先补齐关键信息，再继续执行。`, `${agentEmoji} Tell me what you want to handle and I will fill in the missing details before we continue.`),
      at: nowIso(),
      kind: 'info',
    }],
    input: '',
    selectedSessionId: 'draft',
    updatedAt: nowIso(),
  };
}

function saveDraftState(storageKey: string, state: DraftState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function compactText(text: string, limit = 72): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit)}…`;
}

function formatTime(value: string, locale: Locale): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return locale === 'en'
    ? date.toLocaleString('en-US', { hour12: false })
    : date.toLocaleString('zh-CN', { hour12: false });
}

function activityTone(entry: ActivityEntry) {
  if (entry.kind === 'assistant') return { border: '#7be0ff44', bg: 'rgba(123,224,255,.08)' };
  if (entry.kind === 'user') return { border: '#9b59b644', bg: 'rgba(155,89,182,.10)' };
  if (entry.kind === 'flow') return { border: '#6a9eff33', bg: 'rgba(106,158,255,.07)' };
  if (entry.kind === 'todos') return { border: '#2ecc8a33', bg: 'rgba(46,204,138,.08)' };
  return { border: 'var(--line)', bg: 'var(--panel2)' };
}

export default function PersistentAgentChat(props: Props) {
  const {
    storageKey,
    agentId,
    agentLabel,
    agentEmoji,
    accentColor,
    accentSoft,
    headerKickerZh,
    headerKickerEn,
    headerTitleZh,
    headerTitleEn,
    headerDescZh,
    headerDescEn,
    handlerNoteZh,
    handlerNoteEn,
    introZh,
    introEn,
    draftLabelZh,
    draftLabelEn,
    taskFilter,
    intents,
    buildDraftReview,
    createTask,
    appendTaskMessage,
    renderSidebar,
  } = props;

  const locale = useStore((s) => s.locale);
  const liveStatus = useStore((s) => s.liveStatus);
  const loadLive = useStore((s) => s.loadLive);
  const toast = useStore((s) => s.toast);

  const [draftState, setDraftState] = useState<DraftState>(() => readDraftState(storageKey, locale, agentEmoji, agentLabel));
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [taskInput, setTaskInput] = useState('');
  const [taskSending, setTaskSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanelKey>('conversation');
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const [intentsCollapsed, setIntentsCollapsed] = useState(false);

  useEffect(() => {
    saveDraftState(storageKey, draftState);
  }, [draftState, storageKey]);

  useEffect(() => {
    loadLive();
  }, [loadLive]);

  const sessions = useMemo(() => {
    const tasks = (liveStatus?.tasks || []).filter(taskFilter);
    return [...tasks].sort((a, b) => {
      const at = new Date(a.updatedAt || a.eta || 0).getTime();
      const bt = new Date(b.updatedAt || b.eta || 0).getTime();
      return bt - at;
    });
  }, [liveStatus?.tasks, taskFilter]);

  const selectedTask = useMemo(
    () => sessions.find((item) => item.id === draftState.selectedSessionId) || null,
    [sessions, draftState.selectedSessionId],
  );

  const draftUserText = useMemo(
    () => draftState.messages.filter((item) => item.role === 'user').map((item) => item.content).join('\n'),
    [draftState.messages],
  );

  const review = useMemo(
    () => buildDraftReview(draftUserText, locale),
    [buildDraftReview, draftUserText, locale],
  );

  const draftPreview = useMemo(() => {
    const last = [...draftState.messages].reverse().find((item) => item.role === 'user' || item.role === 'assistant');
    return last ? compactText(last.content) : pickLocaleText(locale, '还没有开始会话', 'No conversation yet');
  }, [draftState.messages, locale]);

  const sessionCountLabel = `${sessions.length + 1}`;
  const selectedSessionTitle = selectedTask ? selectedTask.title : pickLocaleText(locale, draftLabelZh, draftLabelEn);
  const conversationScopeLabel = selectedTask
    ? pickLocaleText(locale, '任务会话', 'Task Session')
    : pickLocaleText(locale, '本地草稿', 'Local Draft');
  const conversationItemsLabel = selectedTask
    ? pickLocaleText(locale, `${activity.length} 条记录`, `${activity.length} records`)
    : pickLocaleText(locale, `${draftState.messages.length} 条消息`, `${draftState.messages.length} messages`);
  const conversationStatusLabel = selectedTask
    ? stateLabel(selectedTask, locale)
    : review.ready
      ? pickLocaleText(locale, '可直接提交', 'Ready to submit')
      : pickLocaleText(locale, '待补全信息', 'Needs more input');
  const mobileTabs = [
    { key: 'sessions' as const, label: pickLocaleText(locale, '会话', 'Sessions') },
    { key: 'conversation' as const, label: pickLocaleText(locale, '对话', 'Conversation') },
    { key: 'intents' as const, label: pickLocaleText(locale, '意图', 'Intents') },
  ];

  const loadTaskActivity = async (taskId: string) => {
    if (!taskId) {
      setActivity([]);
      return;
    }
    setActivityLoading(true);
    try {
      const result = await api.taskActivity(taskId);
      setActivity(result.ok ? (result.activity || []) : []);
    } catch {
      setActivity([]);
    }
    setActivityLoading(false);
  };

  useEffect(() => {
    if (!selectedTask) {
      setActivity([]);
      return;
    }
    loadTaskActivity(selectedTask.id);
  }, [selectedTask?.id]);

  useEffect(() => {
    if (!selectedTask || TERMINAL_STATES.has(selectedTask.state)) return;
    const timer = window.setInterval(() => {
      loadTaskActivity(selectedTask.id);
      loadLive();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [selectedTask?.id, selectedTask?.state, loadLive]);

  const updateDraft = (patch: Partial<DraftState>) => {
    setDraftState((prev) => ({ ...prev, ...patch, updatedAt: nowIso() }));
  };

  const pushDraftMessages = (messages: DraftMessage[]) => {
    setDraftState((prev) => ({
      ...prev,
      messages: [...prev.messages, ...messages],
      input: '',
      updatedAt: nowIso(),
      selectedSessionId: 'draft',
    }));
  };

  const activateSession = (sessionId: string) => {
    updateDraft({ selectedSessionId: sessionId });
    setMobilePanel('conversation');
  };

  const sendDraftMessage = () => {
    const text = draftState.input.trim();
    if (!text) return;
    const userMessage: DraftMessage = {
      id: messageId('draft-user'),
      role: 'user',
      content: text,
      at: nowIso(),
    };
    const nextText = [draftUserText, text].filter(Boolean).join('\n');
    const nextReview = buildDraftReview(nextText, locale);
    const assistantMessage: DraftMessage = {
      id: messageId('draft-assistant'),
      role: 'assistant',
      content: nextReview.ready
        ? `${pickLocaleText(locale, '我已整理出提交前确认摘要，请先确认：', 'I have prepared the pre-submission confirmation summary. Please review it first:')}\n\n${nextReview.summary}`
        : nextReview.followUp,
      at: nowIso(),
      kind: nextReview.ready ? 'summary' : 'question',
    };
    pushDraftMessages([userMessage, assistantMessage]);
    setMobilePanel('conversation');
  };

  const resetDraft = () => {
    const welcome: DraftMessage = {
      id: messageId('welcome'),
      role: 'assistant',
      content: pickLocaleText(locale, `${agentEmoji} 已为你打开新的${agentLabel}沟通窗口。你可以直接描述需求，也可以先点右侧快捷意图。`, `${agentEmoji} A new ${agentLabel} conversation is ready. You can describe the request directly or start from a quick intent on the right.`),
      at: nowIso(),
      kind: 'info',
    };
    setDraftState({ messages: [welcome], input: '', selectedSessionId: 'draft', updatedAt: nowIso() });
    setMobilePanel('conversation');
  };

  const confirmCreateTask = async () => {
    if (!review.ready) {
      toast(review.followUp || pickLocaleText(locale, '请先补全信息再创建任务', 'Please complete the missing details before creating a task'), 'err');
      return;
    }
    setCreating(true);
    try {
      const result = await createTask(draftUserText, review);
      if (result.ok && result.taskId) {
        toast(result.message || pickLocaleText(locale, `处理单已创建：${result.taskId}`, `Request created: ${result.taskId}`), 'ok');
        updateDraft({ selectedSessionId: result.taskId, input: '' });
        setTaskInput('');
        loadLive();
        setTimeout(() => loadTaskActivity(result.taskId || ''), 900);
        resetDraft();
        setDraftState((prev) => ({ ...prev, selectedSessionId: result.taskId || 'draft' }));
        setMobilePanel('conversation');
      } else {
        toast(result.error || pickLocaleText(locale, '创建任务失败', 'Failed to create the task'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    }
    setCreating(false);
  };

  const sendTaskMessage = async () => {
    if (!appendTaskMessage || !selectedTask) return;
    const text = taskInput.trim();
    if (!text) return;
    setTaskSending(true);
    try {
      const result = await appendTaskMessage(selectedTask.id, text);
      if (result.ok) {
        toast(result.message || pickLocaleText(locale, '补充说明已记录到当前会话', 'The follow-up note was appended to the current session'), 'ok');
        setTaskInput('');
        await loadTaskActivity(selectedTask.id);
        loadLive();
      } else {
        toast(result.error || pickLocaleText(locale, '补充说明提交失败', 'Failed to append the follow-up note'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    }
    setTaskSending(false);
  };

  const draftSessionCard = (
    <button
      key="draft"
      type="button"
      className={`agent-chat-session-card ${draftState.selectedSessionId === 'draft' ? 'is-active' : ''}`}
      onClick={() => activateSession('draft')}
      style={{
        borderColor: draftState.selectedSessionId === 'draft' ? accentColor : undefined,
        boxShadow: draftState.selectedSessionId === 'draft' ? `0 16px 36px ${accentColor}22` : undefined,
        background: draftState.selectedSessionId === 'draft' ? accentSoft : undefined,
      }}
    >
      <div className="agent-chat-session-card__top">
        <div className="agent-chat-session-card__title">{pickLocaleText(locale, draftLabelZh, draftLabelEn)}</div>
        <span className="agent-chat-badge" style={{ color: accentColor, borderColor: `${accentColor}44`, background: `${accentColor}1a` }}>
          {pickLocaleText(locale, '草稿', 'Draft')}
        </span>
      </div>
      <div className="agent-chat-session-card__preview">{draftPreview}</div>
      <div className="agent-chat-session-card__time">{formatTime(draftState.updatedAt, locale)}</div>
    </button>
  );

  return (
    <div className="agent-chat-shell" style={{ ['--agent-accent' as string]: accentColor, ['--agent-accent-soft' as string]: accentSoft }}>
      <section className="agent-chat-hero">
        <div className="agent-chat-hero__copy">
          <div className="agent-chat-hero__kicker">{pickLocaleText(locale, headerKickerZh, headerKickerEn)}</div>
          <h2 className="agent-chat-hero__title">{pickLocaleText(locale, headerTitleZh, headerTitleEn)}</h2>
          {pickLocaleText(locale, headerDescZh, headerDescEn) ? (
            <p className="agent-chat-hero__desc">{pickLocaleText(locale, headerDescZh, headerDescEn)}</p>
          ) : null}
        </div>
        <div className="agent-chat-hero__handler">
          <div className="agent-chat-meta-label">{pickLocaleText(locale, '当前协助方', 'Currently Helping')}</div>
          <div className="agent-chat-hero__handler-name">{agentEmoji} {agentLabel}</div>
          {pickLocaleText(locale, handlerNoteZh, handlerNoteEn) ? (
            <div className="agent-chat-meta-copy">{pickLocaleText(locale, handlerNoteZh, handlerNoteEn)}</div>
          ) : null}
          <div className="agent-chat-hero__handler-id">ID · {agentId}</div>
        </div>
      </section>

      <section className="agent-chat-mobile-tabs" aria-label={pickLocaleText(locale, '移动端分段导航', 'Mobile segmented navigation')}>
        {mobileTabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`agent-chat-mobile-tabs__item ${mobilePanel === item.key ? 'is-active' : ''}`}
            onClick={() => setMobilePanel(item.key)}
          >
            {item.label}
          </button>
        ))}
      </section>

      <section className={`agent-chat-grid ${sessionsCollapsed ? 'is-sessions-collapsed' : ''} ${intentsCollapsed ? 'is-intents-collapsed' : ''}`}>
        <aside className={`agent-chat-panel agent-chat-panel--sessions ${mobilePanel === 'sessions' ? 'is-mobile-active' : ''} ${sessionsCollapsed ? 'is-collapsed' : ''}`}>
          <div className="agent-chat-panel__head">
            <div className="agent-chat-panel__head-copy">
              <div className="agent-chat-panel__kicker">{pickLocaleText(locale, '会话索引', 'Session Index')}</div>
              <div className="agent-chat-panel__title">{pickLocaleText(locale, '左侧总览所有草稿与任务会话', 'Track every draft and task session from one rail')}</div>
            </div>
            <div className="agent-chat-panel__head-actions">
              {!sessionsCollapsed ? <span className="agent-chat-panel__count">{sessionCountLabel}</span> : null}
              <button
                type="button"
                className="agent-chat-panel__toggle"
                onClick={() => setSessionsCollapsed((value) => !value)}
                aria-expanded={!sessionsCollapsed}
                aria-label={sessionsCollapsed ? pickLocaleText(locale, '展开会话索引', 'Expand session index') : pickLocaleText(locale, '收起会话索引', 'Collapse session index')}
                title={sessionsCollapsed ? pickLocaleText(locale, '展开会话索引', 'Expand session index') : pickLocaleText(locale, '收起会话索引', 'Collapse session index')}
              >
                {sessionsCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
            </div>
          </div>
          {sessionsCollapsed ? (
            <button
              type="button"
              className="agent-chat-panel__collapsed-tab"
              onClick={() => setSessionsCollapsed(false)}
              aria-label={pickLocaleText(locale, '展开会话索引', 'Expand session index')}
            >
              <span className="agent-chat-panel__collapsed-kicker">{pickLocaleText(locale, '会话', 'Sessions')}</span>
              <span className="agent-chat-panel__collapsed-count">{sessionCountLabel}</span>
            </button>
          ) : (
            <div className="agent-chat-panel__body agent-chat-panel__body--sessions">
              <div className="agent-chat-session-list">
                {draftSessionCard}
                {sessions.map((task) => {
                  const latest = task.activity?.length ? summarizeActivity(task.activity[task.activity.length - 1], locale) : task.now || task.title;
                  const active = draftState.selectedSessionId === task.id;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={`agent-chat-session-card ${active ? 'is-active' : ''}`}
                      onClick={() => activateSession(task.id)}
                      style={{
                        borderColor: active ? accentColor : undefined,
                        boxShadow: active ? `0 16px 36px ${accentColor}22` : undefined,
                        background: active ? accentSoft : undefined,
                      }}
                    >
                      <div className="agent-chat-session-card__top">
                        <div className="agent-chat-session-card__title">{compactText(task.title || task.id, 38)}</div>
                        <span className="agent-chat-session-card__state" style={{ color: accentColor }}>{stateLabel(task, locale)}</span>
                      </div>
                      <div className="agent-chat-session-card__preview">{compactText(latest || pickLocaleText(locale, '暂无动态', 'No updates yet'))}</div>
                      <div className="agent-chat-session-card__time">{formatTime(task.updatedAt || '', locale)}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        <section className={`agent-chat-panel agent-chat-panel--conversation ${mobilePanel === 'conversation' ? 'is-mobile-active' : ''}`}>
          <div className="agent-chat-panel__head agent-chat-panel__head--conversation">
            <div>
              <div className="agent-chat-panel__kicker">{selectedTask ? pickLocaleText(locale, '处理记录', 'Request Record') : pickLocaleText(locale, '草稿会话', 'Draft Session')}</div>
              <div className="agent-chat-panel__title">{selectedSessionTitle}</div>
            </div>
            <div className="agent-chat-actions-inline">
              {selectedTask ? (
                <button
                  type="button"
                  className="agent-chat-outline-btn"
                  onClick={() => loadTaskActivity(selectedTask.id)}
                  style={{ color: accentColor, borderColor: `${accentColor}66` }}
                >
                  {pickLocaleText(locale, '刷新记录', 'Refresh Records')}
                </button>
              ) : (
                <button
                  type="button"
                  className="agent-chat-outline-btn"
                  onClick={resetDraft}
                  style={{ color: accentColor, borderColor: `${accentColor}66` }}
                >
                  {pickLocaleText(locale, '新建草稿', 'New Draft')}
                </button>
              )}
            </div>
          </div>

          <div className="agent-chat-summary-strip">
            <span className="agent-chat-badge">{conversationScopeLabel}</span>
            <span className="agent-chat-badge">{conversationItemsLabel}</span>
            <span
              className={`agent-chat-badge ${selectedTask ? 'is-task' : review.ready ? 'is-ready' : 'is-pending'}`}
              style={{
                color: selectedTask ? accentColor : review.ready ? '#7ff0a8' : '#ffd479',
                borderColor: selectedTask ? `${accentColor}44` : review.ready ? 'rgba(76,195,138,0.38)' : 'rgba(245,200,66,0.34)',
                background: selectedTask ? `${accentColor}14` : review.ready ? 'rgba(76,195,138,0.14)' : 'rgba(245,200,66,0.12)',
              }}
            >
              {conversationStatusLabel}
            </span>
          </div>

          <div className="agent-chat-panel__body agent-chat-panel__body--conversation">
            <div className="agent-chat-stream">
              {!selectedTask ? (
                <>
                  <div className="agent-chat-intro-card">{pickLocaleText(locale, introZh, introEn)}</div>
                  {draftState.messages.map((item) => {
                    const isUser = item.role === 'user';
                    const bubbleBg = isUser ? accentSoft : item.role === 'system' ? 'rgba(245,200,66,.10)' : 'var(--panel2)';
                    const bubbleBorder = isUser ? `${accentColor}44` : item.role === 'system' ? '#f5c84244' : 'var(--line)';
                    return (
                      <div key={item.id} className={`agent-chat-bubble-row ${isUser ? 'is-user' : ''}`}>
                        <div className="agent-chat-bubble" style={{ background: bubbleBg, borderColor: bubbleBorder }}>
                          <div className="agent-chat-bubble__author" style={{ color: isUser ? accentColor : undefined }}>
                            {isUser ? pickLocaleText(locale, '你', 'You') : item.role === 'system' ? pickLocaleText(locale, '平台提示', 'Platform') : agentLabel}
                          </div>
                          <div className="agent-chat-bubble__content">{item.content}</div>
                          <div className="agent-chat-bubble__time">{formatTime(item.at, locale)}</div>
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : activityLoading ? (
                <div className="agent-chat-empty-state">{pickLocaleText(locale, '⟳ 正在读取处理记录…', '⟳ Loading request records...')}</div>
              ) : activity.length === 0 ? (
                <div className="agent-chat-empty-state">
                  {pickLocaleText(locale, '暂无处理记录。', 'No request records.')}
                </div>
              ) : (
                activity.map((item, index) => {
                  const tone = activityTone(item);
                  return (
                    <div key={`${String(item.at || index)}-${item.kind}-${index}`} className="agent-chat-activity-card" style={{ borderColor: tone.border, background: tone.bg }}>
                      <div className="agent-chat-activity-card__top">
                        <div className="agent-chat-activity-card__title">
                          {item.kind === 'progress' && item.agent ? `${item.agent} · ${pickLocaleText(locale, '最新进展', 'Latest Update')}` : item.kind || pickLocaleText(locale, '最新动态', 'Update')}
                        </div>
                        <div className="agent-chat-bubble__time">{formatTime(String(item.at || ''), locale)}</div>
                      </div>
                      <div className="agent-chat-activity-card__content">{summarizeActivity(item, locale)}</div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="agent-chat-composer">
              {!selectedTask ? (
                <div className="agent-chat-composer__stack">
                  {review.summary ? (
                    <div className="agent-chat-review-card" style={{ background: review.ready ? accentSoft : 'var(--panel2)', borderColor: review.ready ? `${accentColor}55` : 'var(--line)' }}>
                      <div className="agent-chat-review-card__title" style={{ color: review.ready ? accentColor : undefined }}>
                        {review.ready ? pickLocaleText(locale, '提交前确认摘要', 'Pre-submission Confirmation Summary') : pickLocaleText(locale, '待补全信息', 'Missing Information')}
                      </div>
                      <div className="agent-chat-review-card__content">{review.ready ? review.summary : review.followUp}</div>
                    </div>
                  ) : null}
                  <div className="agent-chat-composer__grid">
                    <textarea
                      rows={4}
                      value={draftState.input}
                      onChange={(e) => updateDraft({ input: e.target.value })}
                      placeholder={pickLocaleText(locale, '请继续描述需求，或补充范围、现状、约束、期望结果。', 'Continue describing the request, or add scope, current state, constraints, and expected result.')}
                      className="agent-chat-textarea"
                    />
                    <div className="agent-chat-composer__actions">
                      <button
                        type="button"
                        onClick={sendDraftMessage}
                        disabled={!draftState.input.trim()}
                        className="agent-chat-primary-btn"
                        style={{ background: accentColor, color: '#08111d' }}
                      >
                        {pickLocaleText(locale, '发送', 'Send')}
                      </button>
                      <button
                        type="button"
                        onClick={confirmCreateTask}
                        disabled={creating || !review.ready}
                        className="agent-chat-primary-btn"
                        style={{
                          background: review.ready ? '#2ecc8a' : 'var(--panel2)',
                          color: review.ready ? '#04130c' : 'var(--muted)',
                        }}
                      >
                        {creating ? pickLocaleText(locale, '⟳ 创建中…', '⟳ Creating...') : pickLocaleText(locale, '确认并创建任务', 'Confirm & Create Task')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : appendTaskMessage ? (
                <div className="agent-chat-composer__grid">
                  <textarea
                    rows={3}
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    placeholder={pickLocaleText(locale, '如需补充说明，请在这里继续留言，系统会把内容写入当前任务活动流。', 'If you need to add more instructions, leave a follow-up note here and the system will append it to the current task activity stream.')}
                    className="agent-chat-textarea"
                  />
                  <div className="agent-chat-composer__actions">
                    <button
                      type="button"
                      onClick={sendTaskMessage}
                      disabled={taskSending || !taskInput.trim()}
                      className="agent-chat-primary-btn"
                      style={{ background: accentColor, color: '#08111d' }}
                    >
                      {taskSending ? pickLocaleText(locale, '⟳ 追加中…', '⟳ Appending...') : pickLocaleText(locale, '追加说明', 'Append Note')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="agent-chat-meta-copy">
                  {pickLocaleText(locale, '当前会话已转为持续处理中。刷新后仍可从左侧会话列表恢复，并继续查看最新动态。', 'This session is now continuing in the background. You can restore it from the session list after a refresh and keep following the latest updates.')}
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className={`agent-chat-panel agent-chat-panel--intents ${mobilePanel === 'intents' ? 'is-mobile-active' : ''} ${intentsCollapsed ? 'is-collapsed' : ''}`}>
          <div className="agent-chat-panel__head">
            <div className="agent-chat-panel__head-copy">
              <div className="agent-chat-panel__kicker">{pickLocaleText(locale, '快捷意图', 'Quick Intents')}</div>
              <div className="agent-chat-panel__title">{pickLocaleText(locale, '把常见需求转为一键预填入口', 'Turn common requests into one-tap starting points')}</div>
            </div>
            <div className="agent-chat-panel__head-actions">
              <button
                type="button"
                className="agent-chat-panel__toggle"
                onClick={() => setIntentsCollapsed((value) => !value)}
                aria-expanded={!intentsCollapsed}
                aria-label={intentsCollapsed ? pickLocaleText(locale, '展开快捷意图', 'Expand quick intents') : pickLocaleText(locale, '收起快捷意图', 'Collapse quick intents')}
                title={intentsCollapsed ? pickLocaleText(locale, '展开快捷意图', 'Expand quick intents') : pickLocaleText(locale, '收起快捷意图', 'Collapse quick intents')}
              >
                {intentsCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
              </button>
            </div>
          </div>
          {intentsCollapsed ? (
            <button
              type="button"
              className="agent-chat-panel__collapsed-tab"
              onClick={() => setIntentsCollapsed(false)}
              aria-label={pickLocaleText(locale, '展开快捷意图', 'Expand quick intents')}
            >
              <span className="agent-chat-panel__collapsed-kicker">{pickLocaleText(locale, '快捷', 'Quick')}</span>
              <span className="agent-chat-panel__collapsed-count">{intents.length}</span>
            </button>
          ) : (
            <div className="agent-chat-panel__body agent-chat-panel__body--intents">
              <div className="agent-chat-intent-list">
                {intents.map((intent) => (
                  <button
                    key={intent.key}
                    type="button"
                    className="agent-chat-intent-card"
                    onClick={() => {
                      const prefill = pickLocaleText(locale, intent.prefillZh, intent.prefillEn);
                      updateDraft({ selectedSessionId: 'draft', intentKey: intent.key, input: prefill });
                      setMobilePanel('conversation');
                    }}
                    style={{ borderColor: `${accentColor}33` }}
                  >
                    <div className="agent-chat-intent-card__title">{pickLocaleText(locale, intent.labelZh, intent.labelEn)}</div>
                    <div className="agent-chat-intent-card__desc">{pickLocaleText(locale, intent.helperZh || intent.prefillZh, intent.helperEn || intent.prefillEn)}</div>
                  </button>
                ))}
              </div>

              <div className="agent-chat-review-card" style={{ background: review.ready ? accentSoft : 'var(--panel2)', borderColor: review.ready ? `${accentColor}55` : 'var(--line)' }}>
                <div className="agent-chat-review-card__title" style={{ color: review.ready ? accentColor : undefined }}>
                  {pickLocaleText(locale, '确认状态', 'Confirmation Status')}
                </div>
                <div className="agent-chat-review-card__content">
                  {review.ready
                    ? pickLocaleText(locale, '信息已达到提交标准。你可以直接确认创建任务，后续活动流将绑定 taskId 持久化保存。', 'The information is ready for submission. You can confirm now, and the subsequent activity stream will be persisted with the bound task ID.')
                    : (review.followUp || pickLocaleText(locale, '请先补全必要信息。', 'Please fill in the required details first.'))}
                </div>
              </div>

              {renderSidebar ? renderSidebar({ locale, review, draftText: draftUserText, selectedTask }) : (
                <div className="agent-chat-note-card">
                  <div className="agent-chat-note-card__title">{pickLocaleText(locale, '会话说明', 'Session Notes')}</div>
                  <div className="agent-chat-meta-copy">
                    {pickLocaleText(locale, '这是页面内的专项处理对话窗口，只在 Agent 调整、技能管理等特定场景使用；日常交流仍以总控中心为主。草稿阶段的最近会话与未发送输入会保存在浏览器本地；一旦确认创建任务，后续执行历史将以任务活动流为主记录源，并可在刷新后恢复。', 'This is a dedicated in-page handling window used only for special scenarios such as Agent updates and skill management. Everyday requests still go through the Control Center. Recent draft sessions and unsent input are stored locally in the browser. Once the task is confirmed, the execution history will be recorded primarily in the task activity stream and can be restored after refresh.')}
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
