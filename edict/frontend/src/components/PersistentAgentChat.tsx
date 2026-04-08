import React, { useEffect, useMemo, useState } from 'react';
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
        content: pickLocaleText(locale, `${agentEmoji} 这里是${agentLabel}会话窗口。请先描述目标、现状和期望结果，我会先追问补足信息，再生成确认摘要。`, `${agentEmoji} This is the ${agentLabel} conversation window. Please describe your goal, current situation, and expected result first. I will ask follow-up questions before generating a confirmation summary.`),
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
      content: pickLocaleText(locale, `${agentEmoji} 这里是${agentLabel}会话窗口。请先描述目标、现状和期望结果，我会先追问补足信息，再生成确认摘要。`, `${agentEmoji} This is the ${agentLabel} conversation window. Please describe your goal, current situation, and expected result first. I will ask follow-up questions before generating a confirmation summary.`),
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
  };

  const resetDraft = () => {
    const welcome: DraftMessage = {
      id: messageId('welcome'),
      role: 'assistant',
      content: pickLocaleText(locale, `${agentEmoji} 已为你打开新的${agentLabel}草稿会话。你可以直接描述需求，也可以先点右侧快捷意图。`, `${agentEmoji} A new ${agentLabel} draft session is ready. You can describe the request directly or start from a quick intent on the right.`),
      at: nowIso(),
      kind: 'info',
    };
    setDraftState({ messages: [welcome], input: '', selectedSessionId: 'draft', updatedAt: nowIso() });
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
        toast(result.message || pickLocaleText(locale, `后台任务已创建：${result.taskId}`, `Background task created: ${result.taskId}`), 'ok');
        updateDraft({ selectedSessionId: result.taskId, input: '' });
        setTaskInput('');
        loadLive();
        setTimeout(() => loadTaskActivity(result.taskId || ''), 900);
        resetDraft();
        setDraftState((prev) => ({ ...prev, selectedSessionId: result.taskId || 'draft' }));
      } else {
        toast(result.error || pickLocaleText(locale, '创建任务失败', 'Failed to create the task'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
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
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    }
    setTaskSending(false);
  };

  const draftSessionCard = (
    <div
      key="draft"
      onClick={() => updateDraft({ selectedSessionId: 'draft' })}
      style={{
        padding: 12,
        borderRadius: 12,
        cursor: 'pointer',
        border: draftState.selectedSessionId === 'draft' ? `1px solid ${accentColor}` : '1px solid var(--line)',
        background: draftState.selectedSessionId === 'draft' ? accentSoft : 'var(--panel2)',
        boxShadow: draftState.selectedSessionId === 'draft' ? `0 12px 24px ${accentColor}22` : 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6, alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{pickLocaleText(locale, draftLabelZh, draftLabelEn)}</div>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: '#1a2040', color: accentColor }}>
          {pickLocaleText(locale, '草稿', 'Draft')}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>{draftPreview}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>{formatTime(draftState.updatedAt, locale)}</div>
    </div>
  );

  return (
    <div>
      <div
        style={{
          marginBottom: 18,
          background: `linear-gradient(135deg, ${accentColor}22, rgba(15,24,44,.92))`,
          border: `1px solid ${accentColor}33`,
          borderRadius: 16,
          padding: 18,
          boxShadow: '0 18px 36px rgba(0,0,0,.18)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, color: accentColor, fontWeight: 700, letterSpacing: '.05em', marginBottom: 6 }}>
              {pickLocaleText(locale, headerKickerZh, headerKickerEn)}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
              {pickLocaleText(locale, headerTitleZh, headerTitleEn)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8, maxWidth: 860 }}>
              {pickLocaleText(locale, headerDescZh, headerDescEn)}
            </div>
          </div>
          <div style={{ minWidth: 240, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{pickLocaleText(locale, '当前处理方', 'Current Handler')}</div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{agentEmoji} {agentLabel}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{pickLocaleText(locale, handlerNoteZh, handlerNoteEn)}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr) 300px', gap: 16, alignItems: 'start' }}>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{pickLocaleText(locale, '会话列表', 'Sessions')}</div>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{sessions.length + 1}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 760, overflowY: 'auto', paddingRight: 4 }}>
            {draftSessionCard}
            {sessions.map((task) => {
              const latest = task.activity?.length ? summarizeActivity(task.activity[task.activity.length - 1], locale) : task.now || task.title;
              const active = draftState.selectedSessionId === task.id;
              return (
                <div
                  key={task.id}
                  onClick={() => updateDraft({ selectedSessionId: task.id })}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    cursor: 'pointer',
                    border: active ? `1px solid ${accentColor}` : '1px solid var(--line)',
                    background: active ? accentSoft : 'var(--panel2)',
                    boxShadow: active ? `0 12px 24px ${accentColor}22` : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.5 }}>{compactText(task.title || task.id, 38)}</div>
                    <span style={{ fontSize: 10, color: accentColor, whiteSpace: 'nowrap' }}>{stateLabel(task, locale)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>{compactText(latest || pickLocaleText(locale, '暂无动态', 'No updates yet'))}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>{formatTime(task.updatedAt || '', locale)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)', background: 'rgba(255,255,255,.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 12, color: accentColor, fontWeight: 700, marginBottom: 4 }}>
                  {selectedTask ? pickLocaleText(locale, '任务会话', 'Task Session') : pickLocaleText(locale, '草稿会话', 'Draft Session')}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  {selectedTask ? selectedTask.title : pickLocaleText(locale, draftLabelZh, draftLabelEn)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {selectedTask ? (
                  <button
                    type="button"
                    onClick={() => loadTaskActivity(selectedTask.id)}
                    style={{ padding: '8px 14px', background: 'transparent', color: accentColor, border: `1px solid ${accentColor}`, borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
                  >
                    {pickLocaleText(locale, '刷新动态', 'Refresh Updates')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={resetDraft}
                    style={{ padding: '8px 14px', background: 'transparent', color: accentColor, border: `1px solid ${accentColor}`, borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
                  >
                    {pickLocaleText(locale, '新建草稿', 'New Draft')}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div style={{ minHeight: 560, maxHeight: 680, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12, background: 'linear-gradient(180deg, rgba(255,255,255,.01), rgba(0,0,0,.04))' }}>
            {!selectedTask ? (
              <>
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 14, fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                  {pickLocaleText(locale, introZh, introEn)}
                </div>
                {draftState.messages.map((item) => {
                  const isUser = item.role === 'user';
                  const bubbleBg = isUser ? accentSoft : item.role === 'system' ? 'rgba(245,200,66,.10)' : 'var(--panel2)';
                  const bubbleBorder = isUser ? `${accentColor}44` : item.role === 'system' ? '#f5c84244' : 'var(--line)';
                  return (
                    <div key={item.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                      <div style={{ maxWidth: '86%', background: bubbleBg, border: `1px solid ${bubbleBorder}`, borderRadius: 14, padding: '12px 14px' }}>
                        <div style={{ fontSize: 11, color: isUser ? accentColor : 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>
                          {isUser ? pickLocaleText(locale, '你', 'You') : item.role === 'system' ? pickLocaleText(locale, '系统', 'System') : agentLabel}
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{item.content}</div>
                        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)' }}>{formatTime(item.at, locale)}</div>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : activityLoading ? (
              <div style={{ textAlign: 'center', padding: '26px 0', color: 'var(--muted)', fontSize: 12 }}>{pickLocaleText(locale, '⟳ 正在读取任务动态…', '⟳ Loading task activity...')}</div>
            ) : activity.length === 0 ? (
              <div style={{ background: 'var(--panel2)', border: '1px dashed var(--line)', borderRadius: 12, padding: 16, color: 'var(--muted)', fontSize: 12, lineHeight: 1.8 }}>
                {pickLocaleText(locale, '当前还没有读取到任务动态。你可以先刷新，或稍等几秒让后台执行链路落库。', 'No task activity was retrieved yet. You can refresh now or wait a few seconds for the backend workflow to persist updates.')}
              </div>
            ) : (
              activity.map((item, index) => {
                const tone = activityTone(item);
                return (
                  <div key={`${String(item.at || index)}-${item.kind}-${index}`} style={{ border: `1px solid ${tone.border}`, background: tone.bg, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)' }}>
                        {item.kind === 'progress' && item.agent ? `${item.agent} · ${pickLocaleText(locale, '进度', 'Progress')}` : item.kind || pickLocaleText(locale, '动态更新', 'Update')}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{formatTime(String(item.at || ''), locale)}</div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                      {summarizeActivity(item, locale)}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ padding: 18, borderTop: '1px solid var(--line)', background: 'rgba(255,255,255,.02)' }}>
            {!selectedTask ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {review.summary ? (
                  <div style={{ background: review.ready ? accentSoft : 'var(--panel2)', border: `1px solid ${review.ready ? `${accentColor}55` : 'var(--line)'}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: review.ready ? accentColor : 'var(--text)', marginBottom: 8 }}>
                      {review.ready ? pickLocaleText(locale, '提交前确认摘要', 'Pre-submission Confirmation Summary') : pickLocaleText(locale, '待补全信息', 'Missing Information')}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                      {review.ready ? review.summary : review.followUp}
                    </div>
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  <textarea
                    rows={4}
                    value={draftState.input}
                    onChange={(e) => updateDraft({ input: e.target.value })}
                    placeholder={pickLocaleText(locale, '请继续描述需求，或补充范围、现状、约束、期望结果。', 'Continue describing the request, or add scope, current state, constraints, and expected result.')}
                    style={{ flex: 1, padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.7 }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 144 }}>
                    <button
                      type="button"
                      onClick={sendDraftMessage}
                      disabled={!draftState.input.trim()}
                      style={{ padding: '11px 14px', fontSize: 13, background: accentColor, color: '#08111d', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
                    >
                      {pickLocaleText(locale, '发送', 'Send')}
                    </button>
                    <button
                      type="button"
                      onClick={confirmCreateTask}
                      disabled={creating || !review.ready}
                      style={{ padding: '11px 14px', fontSize: 13, background: review.ready ? '#2ecc8a' : 'var(--panel2)', color: review.ready ? '#04130c' : 'var(--muted)', border: 'none', borderRadius: 10, cursor: review.ready ? 'pointer' : 'not-allowed', fontWeight: 800 }}
                    >
                      {creating ? pickLocaleText(locale, '⟳ 创建中…', '⟳ Creating...') : pickLocaleText(locale, '确认并创建任务', 'Confirm & Create Task')}
                    </button>
                  </div>
                </div>
              </div>
            ) : appendTaskMessage ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <textarea
                  rows={3}
                  value={taskInput}
                  onChange={(e) => setTaskInput(e.target.value)}
                  placeholder={pickLocaleText(locale, '如需补充说明，请在这里继续留言，系统会把内容写入当前任务活动流。', 'If you need to add more instructions, leave a follow-up note here and the system will append it to the current task activity stream.')}
                  style={{ flex: 1, padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.7 }}
                />
                <button
                  type="button"
                  onClick={sendTaskMessage}
                  disabled={taskSending || !taskInput.trim()}
                  style={{ padding: '11px 16px', fontSize: 13, background: accentColor, color: '#08111d', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 800, minWidth: 132 }}
                >
                  {taskSending ? pickLocaleText(locale, '⟳ 追加中…', '⟳ Appending...') : pickLocaleText(locale, '追加说明', 'Append Note')}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                {pickLocaleText(locale, '当前会话已进入后台执行。刷新后仍可从左侧会话列表恢复，并继续查看活动流。', 'This session has entered backend execution. It can still be restored from the session list after a refresh, and the activity stream remains traceable.')}
              </div>
            )}
          </div>
        </div>

        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>{pickLocaleText(locale, '快捷意图', 'Quick Intents')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {intents.map((intent) => (
              <button
                key={intent.key}
                type="button"
                onClick={() => {
                  const prefill = pickLocaleText(locale, intent.prefillZh, intent.prefillEn);
                  updateDraft({ selectedSessionId: 'draft', intentKey: intent.key, input: prefill });
                }}
                style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 12, border: `1px solid ${accentColor}33`, background: 'var(--panel2)', cursor: 'pointer' }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>{pickLocaleText(locale, intent.labelZh, intent.labelEn)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>{pickLocaleText(locale, intent.helperZh || intent.prefillZh, intent.helperEn || intent.prefillEn)}</div>
              </button>
            ))}
          </div>

          <div style={{ background: review.ready ? accentSoft : 'var(--panel2)', border: `1px solid ${review.ready ? `${accentColor}55` : 'var(--line)'}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8, color: review.ready ? accentColor : 'var(--text)' }}>
              {pickLocaleText(locale, '确认状态', 'Confirmation Status')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
              {review.ready
                ? pickLocaleText(locale, '信息已达到提交标准。你可以直接确认创建任务，后续活动流将绑定 taskId 持久化保存。', 'The information is ready for submission. You can confirm now, and the subsequent activity stream will be persisted with the bound task ID.')
                : (review.followUp || pickLocaleText(locale, '请先补全必要信息。', 'Please fill in the required details first.'))}
            </div>
          </div>

          {renderSidebar ? renderSidebar({ locale, review, draftText: draftUserText, selectedTask }) : (
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{pickLocaleText(locale, '会话说明', 'Session Notes')}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
                {pickLocaleText(locale, '草稿阶段的最近会话与未发送输入会保存在浏览器本地；一旦确认创建任务，后续执行历史将以任务活动流为主记录源，并可在刷新后恢复。', 'Recent draft sessions and unsent input are stored locally in the browser. Once the task is confirmed, the execution history will be recorded primarily in the task activity stream and can be restored after refresh.')}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
