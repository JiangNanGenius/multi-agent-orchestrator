/**
 * 协作讨论空间 — 自动识别正式讨论或轻松聊天
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useStore, DEPTS, deptMeta } from '../store';
import { api, type CollabDiscussResult, type CollabMinute, type CollabAgentBusyEntry } from '../api';
import { pickLocaleText, type Locale } from '../i18n';

const EMOTION_EMOJI: Record<string, string> = {
  neutral: '', confident: '😏', worried: '😟', angry: '😤',
  thinking: '🤔', amused: '😄', happy: '😊',
};

const STAGE_LABEL: Record<string, { zh: string; en: string }> = {
  meeting_init: { zh: '协作准备', en: 'Collaboration Setup' },
  moderator_open: { zh: '开场说明', en: 'Opening Remarks' },
  expert_statement: { zh: '成员发言', en: 'Member Statements' },
  cross_discussion: { zh: '共同讨论', en: 'Group Discussion' },
  decision_sync: { zh: '结论整理', en: 'Decision Summary' },
  meeting_closed: { zh: '协作结束', en: 'Collaboration Closed' },
  chatting: { zh: '自由闲聊', en: 'Chatting' },
};

const COLLAB_POSITIONS: Record<string, { x: number; y: number }> = {
  plan_center: { x: 18, y: 22 },
  review_center: { x: 18, y: 42 },
  dispatch_center: { x: 18, y: 62 },
  docs_specialist: { x: 84, y: 16 },
  data_specialist: { x: 84, y: 29 },
  code_specialist: { x: 84, y: 42 },
  audit_specialist: { x: 84, y: 55 },
  deploy_specialist: { x: 84, y: 68 },
  search_specialist: { x: 84, y: 81 },
  control_center: { x: 50, y: 18 },
  admin_specialist: { x: 50, y: 80 },
};

interface CollabMessage {
  type: string;
  content: string;
  agent_id?: string;
  agent_name?: string;
  emotion?: string;
  action?: string | null;
  timestamp?: number;
}

interface CollabAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  personality?: string;
  speaking_style?: string;
}

interface TraceEntry {
  at?: number;
  round?: number;
  stage?: string;
  kind?: string;
  content?: string;
  mode?: string;
  intent?: string;
  speaker_ids?: string[];
  result_stage?: string;
  summary?: string;
  reason?: string;
  auto_run?: boolean;
}

interface CollabSession {
  session_id: string;
  topic: string;
  agents: CollabAgent[];
  messages: CollabMessage[];
  round: number;
  phase: string;
  mode?: 'meeting' | 'chat';
  stage?: string;
  moderator_id?: string;
  moderator_name?: string;
  speaker_queue?: string[];
  agenda?: string;
  minutes?: CollabMinute[];
  trace?: TraceEntry[];
  decision_items?: string[];
  open_questions?: string[];
  action_items?: string[];
  stage_history?: Array<Record<string, unknown>>;
  summary?: string;
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
}

function normalizeSession(res: CollabDiscussResult): CollabSession {
  return {
    session_id: res.session_id || '',
    topic: res.topic || '',
    agents: res.agents || [],
    messages: (res.messages || []).map((msg) => ({
      type: msg.type,
      content: msg.content,
      agent_id: msg.agent_id,
      agent_name: msg.agent_name,
      emotion: msg.emotion,
      action: msg.action,
      timestamp: msg.timestamp,
    })),
    round: res.round || 0,
    phase: res.phase || 'active',
    mode: res.mode,
    stage: res.stage,
    moderator_id: res.moderator_id,
    moderator_name: res.moderator_name,
    speaker_queue: res.speaker_queue || [],
    agenda: res.agenda || '',
    minutes: res.minutes || [],
    trace: (res.trace || []) as TraceEntry[],
    decision_items: res.decision_items || [],
    open_questions: res.open_questions || [],
    action_items: res.action_items || [],
    stage_history: res.stage_history || [],
    summary: res.summary,
    select_all: res.select_all,
    run_state: res.run_state || (res.phase === 'concluded' ? 'concluded' : 'running'),
    auto_run: res.auto_run || false,
    run_interval_sec: res.run_interval_sec,
    auto_round_limit: res.auto_round_limit,
    auto_round_count: res.auto_round_count,
    last_advanced_at: res.last_advanced_at,
    next_run_at: res.next_run_at,
    claimed_agents: res.claimed_agents || [],
    conflicted_agents: res.conflicted_agents || [],
    yielded_agents: res.yielded_agents || [],
    busy_snapshot: res.busy_snapshot || [],
  };
}

function mergeAdvanceResult(prev: CollabSession, res: CollabDiscussResult): CollabSession {
  const appendedMessages: CollabMessage[] = (res.new_messages || []).map((m) => ({
    type: m.type || 'agent',
    agent_id: m.agent_id || '',
    agent_name: m.agent_name || m.name || '',
    content: m.content,
    emotion: m.emotion,
    action: m.action,
    timestamp: Date.now() / 1000,
  }));

  const mergedMessages = [...prev.messages, ...appendedMessages];
  if (res.scene_note) {
    mergedMessages.push({
      type: 'scene_note',
      content: res.scene_note,
      timestamp: Date.now() / 1000,
    });
  }

  return {
    ...prev,
    round: res.round ?? prev.round,
    phase: res.phase ?? prev.phase,
    mode: res.mode ?? prev.mode,
    stage: res.stage ?? prev.stage,
    moderator_id: res.moderator_id ?? prev.moderator_id,
    moderator_name: res.moderator_name ?? prev.moderator_name,
    speaker_queue: res.speaker_queue ?? prev.speaker_queue,
    messages: mergedMessages,
    minutes: res.minutes ?? prev.minutes,
    decision_items: res.decision_items ?? prev.decision_items,
    open_questions: res.open_questions ?? prev.open_questions,
    action_items: res.action_items ?? prev.action_items,
    run_state: res.run_state ?? prev.run_state,
    auto_run: res.auto_run ?? prev.auto_run,
    run_interval_sec: res.run_interval_sec ?? prev.run_interval_sec,
    auto_round_limit: res.auto_round_limit ?? prev.auto_round_limit,
    auto_round_count: res.auto_round_count ?? prev.auto_round_count,
    last_advanced_at: res.last_advanced_at ?? prev.last_advanced_at,
    next_run_at: res.next_run_at ?? prev.next_run_at,
    claimed_agents: res.claimed_agents ?? prev.claimed_agents,
    conflicted_agents: res.conflicted_agents ?? prev.conflicted_agents,
    yielded_agents: res.yielded_agents ?? prev.yielded_agents,
    busy_snapshot: res.busy_snapshot ?? prev.busy_snapshot,
  };
}

function busyAccent(state?: string) {
  switch (state) {
    case 'active':
      return 'text-emerald-300 border-emerald-700/40 bg-emerald-900/20';
    case 'reserved':
      return 'text-sky-300 border-sky-700/40 bg-sky-900/20';
    case 'paused':
      return 'text-amber-300 border-amber-700/40 bg-amber-900/20';
    case 'yielding':
      return 'text-fuchsia-300 border-fuchsia-700/40 bg-fuchsia-900/20';
    case 'cooldown':
      return 'text-slate-300 border-slate-700/40 bg-slate-800/30';
    default:
      return 'text-[var(--muted)] border-[var(--line)] bg-[var(--panel2)]';
  }
}

export default function CollaborationDiscussion() {
  const locale = useStore((s) => s.locale);
  const toast = useStore((s) => s.toast);
  const liveStatus = useStore((s) => s.liveStatus);
  const collabAgentBusyData = useStore((s) => s.collabAgentBusyData);
  const loadCollabBusy = useStore((s) => s.loadCollabBusy);

  const [phase, setPhase] = useState<'setup' | 'session'>('setup');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(['control_center', 'plan_center', 'review_center']));
  const [topic, setTopic] = useState('');
  const [moderatorId, setModeratorId] = useState('control_center');
  const [session, setSession] = useState<CollabSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayRef = useRef(false);

  const [userInput, setUserInput] = useState('');
  const [showConstraint, setShowConstraint] = useState(false);
  const [constraintInput, setConstraintInput] = useState('');
  const [constraintFlash, setConstraintFlash] = useState(false);
  const [diceRolling, setDiceRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [emotions, setEmotions] = useState<Record<string, string>>({});
  const [speakerSelection, setSpeakerSelection] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages?.length]);

  useEffect(() => {
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);

  useEffect(() => {
    if (!autoPlay || !session || loading || session.phase === 'concluded' || session.run_state === 'paused') return;
    const timer = setInterval(() => {
      if (!autoPlayRef.current || loading) return;
      if (session.mode === 'meeting') {
        handleAdvance({
          intent: 'next_stage',
          stageAction: 'next_stage',
          speakerIds: Array.from(speakerSelection),
        });
      } else {
        handleAdvance({ intent: 'chat' });
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [autoPlay, session, loading, speakerSelection]);

  useEffect(() => {
    loadCollabBusy().catch(() => {});
  }, [loadCollabBusy]);

  const allAgentIds = useMemo(() => DEPTS.map((d) => d.id), []);
  const sessionAgents = session?.agents || [];
  const currentModeratorId = session?.moderator_id || moderatorId;
  const moderatorSelectable = Array.from(selectedIds);
  const currentMode = session?.mode || 'meeting';
  const currentStage = session?.stage || 'meeting_init';
  const speakerPool = sessionAgents.filter((agent) => agent.id !== currentModeratorId);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      if (moderatorId && !next.has(moderatorId)) {
        next.add(moderatorId);
      }
      return next;
    });
  }, [moderatorId]);

  useEffect(() => {
    if (!session) return;
    const queue = session.speaker_queue || [];
    if (queue.length > 0) {
      setSpeakerSelection(new Set(queue));
    }
  }, [session?.speaker_queue, session?.session_id]);

  const toggleAgent = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (id === moderatorId) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllAgents = () => {
    setSelectedIds(new Set(allAgentIds));
    if (!moderatorId) setModeratorId('control_center');
  };

  const clearAgentSelection = () => {
    setSelectedIds(new Set(moderatorId ? [moderatorId] : []));
  };

  const toggleSpeaker = (id: string) => {
    setSpeakerSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const animateMessages = (messages: CollabMessage[]) => {
    const aiMsgs = messages
      .filter((m) => m.type === 'agent' || m.type === 'moderator')
      .map((m) => ({ agent_id: m.agent_id || '', emotion: m.emotion || 'neutral' }))
      .filter((m) => Boolean(m.agent_id));

    if (aiMsgs.length === 0) return;
    const emotionMap: Record<string, string> = {};
    let idx = 0;
    const cycle = () => {
      if (idx < aiMsgs.length) {
        const currentAgentId = aiMsgs[idx].agent_id;
        setSpeakingId(currentAgentId);
        emotionMap[currentAgentId] = aiMsgs[idx].emotion;
        idx += 1;
        setTimeout(cycle, 1100);
      } else {
        setSpeakingId(null);
      }
    };
    cycle();
    setEmotions((prev) => ({ ...prev, ...emotionMap }));
  };

  const handleStart = async () => {
    if (!topic.trim() || selectedIds.size < 2 || loading) return;
    setLoading(true);
    try {
      const res = await api.collabDiscussStart(
        topic,
        Array.from(selectedIds),
        undefined,
        'auto',
        moderatorId,
        selectedIds.size === allAgentIds.length,
      );
      if (!res.ok) throw new Error(res.error || pickLocaleText(locale, '启动失败', 'Failed to start discussion'));
      const normalized = normalizeSession(res);
      setSession(normalized);
      setPhase('session');
      loadCollabBusy().catch(() => {});
      setSpeakerSelection(new Set(normalized.speaker_queue || []));
      animateMessages(normalized.messages.slice(-3));
    } catch (e: unknown) {
      toast((e as Error).message || pickLocaleText(locale, '启动失败', 'Failed to start discussion'), 'err');
    } finally {
      setLoading(false);
    }
  };

  const handleAdvance = useCallback(async ({
    userMessage,
    constraint,
    intent = 'auto',
    speakerIds = [],
    stageAction,
  }: {
    userMessage?: string;
    constraint?: string;
    intent?: 'auto' | 'meeting' | 'chat' | 'user_message' | 'constraint' | 'next_round' | 'next_stage';
    speakerIds?: string[];
    stageAction?: string;
  }) => {
    if (!session || loading) return;
    setLoading(true);
    try {
      const res = await api.collabDiscussAdvance(
        session.session_id,
        userMessage,
        constraint,
        intent,
        speakerIds,
        stageAction,
      );
      if (!res.ok) throw new Error(res.error || pickLocaleText(locale, '推进失败', 'Failed to advance discussion'));
      setSession((prev) => (prev ? mergeAdvanceResult(prev, res) : prev));
      loadCollabBusy().catch(() => {});
      animateMessages((res.new_messages || []).map((m) => ({
        type: m.type || 'agent',
        content: m.content,
        agent_id: m.agent_id,
        agent_name: m.agent_name || m.name,
        emotion: m.emotion,
      })));
    } catch (e: unknown) {
      toast((e as Error).message || pickLocaleText(locale, '推进失败', 'Failed to advance discussion'), 'err');
    } finally {
      setLoading(false);
    }
  }, [session, loading, locale, toast]);

  const handleUserSubmit = () => {
    const msg = userInput.trim();
    if (!msg) return;
    setUserInput('');
    handleAdvance({
      userMessage: msg,
      intent: currentMode === 'meeting' ? 'user_message' : 'chat',
      speakerIds: currentMode === 'meeting' ? Array.from(speakerSelection) : [],
    });
  };

  const handleConstraint = () => {
    const msg = constraintInput.trim();
    if (!msg) return;
    setConstraintInput('');
    setShowConstraint(false);
    setConstraintFlash(true);
    setTimeout(() => setConstraintFlash(false), 800);
    handleAdvance({
      constraint: msg,
      intent: 'constraint',
      speakerIds: Array.from(speakerSelection),
    });
  };

  const handleDice = async () => {
    if (loading || diceRolling) return;
    setDiceRolling(true);
    setDiceResult(null);

    let count = 0;
    const timer = setInterval(async () => {
      count += 1;
      setDiceResult(pickLocaleText(locale, '🎲 当前协作出现新变化...', '🎲 A new twist is coming...'));
      if (count >= 6) {
        clearInterval(timer);
        try {
          const res = await api.collabDiscussFate();
          const event = res.event || pickLocaleText(locale, '出现了新的临时情况', 'A new situation just came up');
          setDiceResult(event);
          setDiceRolling(false);
          handleAdvance({
            constraint: locale === 'en' ? `[Random Event] ${event}` : `【随机事件】${event}`,
            intent: 'constraint',
            speakerIds: Array.from(speakerSelection),
          });
        } catch {
          setDiceResult(pickLocaleText(locale, '暂时无法生成新的随机情况', 'Unable to generate a new random event right now'));
          setDiceRolling(false);
        }
      }
    }, 200);
  };

  const handlePauseResume = async () => {
    if (!session || loading || session.phase === 'concluded') return;
    setLoading(true);
    try {
      const res = session.run_state === 'paused'
        ? await api.collabDiscussResume(session.session_id, autoPlayRef.current)
        : await api.collabDiscussPause(session.session_id);
      if (!res.ok) throw new Error(res.error || pickLocaleText(locale, '更新运行状态失败', 'Failed to update run state'));
      setSession((prev) => (prev ? { ...prev, ...normalizeSession(res), messages: prev.messages } : prev));
      loadCollabBusy().catch(() => {});
      if (session.run_state !== 'paused') {
        setAutoPlay(false);
      }
    } catch (e: unknown) {
      toast((e as Error).message || pickLocaleText(locale, '更新运行状态失败', 'Failed to update run state'), 'err');
    } finally {
      setLoading(false);
    }
  };

  const handleConclude = async () => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await api.collabDiscussConclude(session.session_id);
      if (!res.ok) throw new Error(res.error || pickLocaleText(locale, '结束失败', 'Failed to finish discussion'));
      setSession((prev) =>
        prev
          ? {
              ...prev,
              phase: 'concluded',
              run_state: 'concluded',
              auto_run: false,
              next_run_at: null,
              stage: prev.mode === 'meeting' ? 'meeting_closed' : prev.stage,
              summary: res.summary || prev.summary,
              minutes: res.minutes || prev.minutes,
              decision_items: res.decision_items || prev.decision_items,
              open_questions: res.open_questions || prev.open_questions,
              action_items: res.action_items || prev.action_items,
              messages: [
                ...prev.messages,
                {
                  type: 'system',
                      content: res.summary
                        ? (locale === 'en' ? `📋 Discussion finished — ${res.summary}` : `📋 讨论结束 —— ${res.summary}`)
                        : pickLocaleText(locale, '📋 讨论已结束', '📋 Discussion finished'),
                  timestamp: Date.now() / 1000,
                },
              ],
            }
          : prev,
      );
      loadCollabBusy().catch(() => {});
      setAutoPlay(false);
    } catch (e: unknown) {
      toast((e as Error).message || pickLocaleText(locale, '结束失败', 'Failed to conclude discussion'), 'err');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (session) {
      api.collabDiscussDestroy(session.session_id).catch(() => {}).finally(() => {
        loadCollabBusy().catch(() => {});
      });
    }
    setPhase('setup');
    setSession(null);
    setAutoPlay(false);
    setEmotions({});
    setSpeakingId(null);
    setDiceResult(null);
    setSpeakerSelection(new Set());
  };

  const activeEdicts = (liveStatus?.tasks || []).filter(
    (t) => /^JJC-/i.test(t.id) && !['Done', 'Cancelled'].includes(t.state),
  );

  const presetTopics = [
    ...activeEdicts.slice(0, 3).map((t) => ({
      text: locale === 'en' ? `Start a discussion on ${t.id}: ${t.title}` : `围绕任务 ${t.id} 发起讨论：${t.title}`,
      icon: '📜',
    })),
    { text: pickLocaleText(locale, '一起看看当前方案和可能风险', 'Review the current plan and possible risks together'), icon: '🏗️' },
    { text: pickLocaleText(locale, '讨论下周安排和分工', 'Discuss next week’s plan and responsibilities'), icon: '📋' },
    { text: pickLocaleText(locale, '你们先陪我聊聊最近项目推进感受', 'Let us just chat about the recent project mood'), icon: '💬' },
    { text: pickLocaleText(locale, '讨论突发问题的处理方案与备用安排', 'Discuss the response plan and fallback option for an incident'), icon: '🚨' },
  ];

  const stageText = STAGE_LABEL[currentStage] || { zh: currentStage, en: currentStage };
  const minutes = session?.minutes || [];
  const decisions = session?.decision_items || [];
  const openQuestions = session?.open_questions || [];
  const actionItems = session?.action_items || [];
  const trace = session?.trace || [];
  const busyEntries = collabAgentBusyData?.busy || [];
  const busyByAgent = new Map(busyEntries.map((entry) => [entry.agent_id, entry]));
  const activeBusySessions = collabAgentBusyData?.sessions || [];
  const sessionBusySnapshot = session?.busy_snapshot?.length
    ? session.busy_snapshot
    : (sessionAgents.map((agent) => busyByAgent.get(agent.id)).filter(Boolean) as CollabAgentBusyEntry[]);

  if (phase === 'setup') {
    return (
      <div className="space-y-6">
        <div className="text-center py-4">
          <h2 className="text-xl font-bold bg-gradient-to-r from-amber-400 to-purple-400 bg-clip-text text-transparent">
            {pickLocaleText(locale, '👥 协作交流区', '👥 Collaboration Space')}
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            {pickLocaleText(
              locale,
              '系统会自动识别你是想进行正式协作还是轻松聊天；正式协作会启用引导说明、轮流表达、分步推进与结果记录。',
              'The system can tell whether you want a structured collaboration or a casual chat. Structured collaboration includes guided opening, turn-taking, step-by-step progress, and result notes.',
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_.8fr] gap-4">
          <div className="space-y-4">
            <div className="bg-[var(--panel)] rounded-xl p-4 border border-[var(--line)]">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <div>
                  <div className="text-sm font-semibold">{pickLocaleText(locale, '👥 参与成员选择', '👥 Participants')}</div>
                  <div className="text-xs text-[var(--muted)] mt-1">
                    {locale === 'en' ? `${selectedIds.size}/${allAgentIds.length} selected, at least 2` : `已选 ${selectedIds.size}/${allAgentIds.length} 位，至少 2 位`}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={selectAllAgents}
                    className="text-xs px-3 py-1.5 rounded-lg border border-[var(--acc)]40 text-[var(--acc)] hover:bg-[var(--acc)]10 transition"
                  >
                    {pickLocaleText(locale, '选择所有成员', 'Select Everyone')}
                  </button>
                  <button
                    onClick={clearAgentSelection}
                    className="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] transition"
                  >
                    {pickLocaleText(locale, '仅保留当前发起人', 'Keep Only the Current Lead')}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {DEPTS.map((d) => {
                  const active = selectedIds.has(d.id);
                  const meta = deptMeta(d.id, locale);
                  const color = meta.color;
                  const isModerator = moderatorId === d.id;
                  return (
                    <button
                      key={d.id}
                      onClick={() => toggleAgent(d.id)}
                      className="p-2.5 rounded-lg border transition-all text-left"
                      style={{
                        borderColor: active ? color + '80' : 'var(--line)',
                        background: active ? color + '15' : 'var(--panel2)',
                        boxShadow: active ? `0 0 12px ${color}20` : 'none',
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-lg">{d.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate" style={{ color: active ? color : 'var(--text)' }}>
                            {meta.label}
                          </div>
                          <div className="text-[10px] text-[var(--muted)] truncate">{meta.role}</div>
                          {busyByAgent.get(d.id)?.state && busyByAgent.get(d.id)?.state !== 'idle' && (
                            <div className="mt-1">
                              <span className={`inline-flex text-[9px] px-1.5 py-0.5 rounded-full border ${busyAccent(busyByAgent.get(d.id)?.state)}`}>
                                {busyByAgent.get(d.id)?.label}
                              </span>
                            </div>
                          )}
                        </div>
                        {isModerator && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            {pickLocaleText(locale, '发起人', 'Lead')}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-[var(--panel)] rounded-xl p-4 border border-[var(--line)]">
              <div className="text-sm font-semibold mb-2">{pickLocaleText(locale, '👥 当前带领人', '👥 Current Lead')}</div>
              <select
                value={moderatorId}
                onChange={(e) => setModeratorId(e.target.value)}
                className="w-full bg-[var(--panel2)] rounded-lg px-3 py-2 text-sm border border-[var(--line)] outline-none focus:border-[var(--acc)]"
              >
                {moderatorSelectable.map((id) => {
                  const meta = deptMeta(id, locale);
                  return (
                    <option key={id} value={id}>
                      {meta.emoji} {meta.label} · {meta.role}
                    </option>
                  );
                })}
              </select>
              <div className="text-[11px] text-[var(--muted)] mt-2">
                {pickLocaleText(locale, '在当前协作中，只有这里选中的成员会在这一轮参与表达。', 'In the current collaboration, only the selected members will take part in this round.')}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-[var(--panel)] rounded-xl p-4 border border-[var(--line)]">
              <div className="text-sm font-semibold mb-2">{pickLocaleText(locale, '📌 当前话题', '📌 Topic')}</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {presetTopics.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setTopic(p.text)}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--line)] hover:border-[var(--acc)] hover:text-[var(--acc)] transition-colors"
                    style={{
                      background: topic === p.text ? 'var(--acc)18' : 'transparent',
                      borderColor: topic === p.text ? 'var(--acc)' : undefined,
                      color: topic === p.text ? 'var(--acc)' : undefined,
                    }}
                  >
                    {p.icon} {p.text}
                  </button>
                ))}
              </div>
              <textarea
                className="w-full bg-[var(--panel2)] rounded-lg p-3 text-sm border border-[var(--line)] focus:border-[var(--acc)] outline-none resize-none"
                rows={5}
                placeholder={pickLocaleText(locale, '例如：请大家围绕发布时间、风险和资源安排正式讨论；或者直接说“陪我聊聊最近的推进感受”。', 'Example: ask everyone to discuss launch timing, risks, and staffing in a formal discussion; or simply say “let us chat about recent progress.”')}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>

            <div className="bg-[var(--panel)] rounded-xl p-4 border border-[var(--line)] space-y-2">
              <div className="text-sm font-semibold">{pickLocaleText(locale, '🧠 讨论方式说明', '🧠 How Discussion Works')}</div>
              <div className="text-xs text-[var(--muted)] leading-relaxed">
                {pickLocaleText(
                  locale,
                  '系统会自动识别这是结构化讨论还是轻松聊天。若识别为结构化讨论，将依次进入：准备、开场说明、成员表达、共同交流、结论整理与结束；若识别为轻松聊天，则过程会更自然随意。',
                  'The system automatically detects whether this is a structured discussion or a casual chat. Structured discussions move through setup, opening remarks, member statements, shared exchange, summary, and close; casual chat keeps a lighter and more natural flow.',
                )}
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleStart}
          disabled={selectedIds.size < 2 || !topic.trim() || loading}
          className="w-full py-3 rounded-xl font-semibold text-sm transition-all border-0"
          style={{
            background:
              selectedIds.size >= 2 && topic.trim()
                ? 'linear-gradient(135deg, #6a9eff, #a07aff)'
                : 'var(--panel2)',
            color: selectedIds.size >= 2 && topic.trim() ? '#fff' : 'var(--muted)',
            opacity: loading ? 0.6 : 1,
            cursor: selectedIds.size >= 2 && topic.trim() && !loading ? 'pointer' : 'not-allowed',
          }}
        >
          {loading
            ? pickLocaleText(locale, '讨论准备中...', 'Preparing discussion...')
            : pickLocaleText(locale, '👥 开始协作', '👥 Start Collaboration')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-[var(--panel)] rounded-xl px-4 py-3 border border-[var(--line)]">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold">{pickLocaleText(locale, '👥 讨论空间', '👥 Discussion Space')}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${currentMode === 'meeting' ? 'bg-amber-900/30 text-amber-300 border-amber-700/40' : 'bg-sky-900/30 text-sky-300 border-sky-700/40'}`}>
                {currentMode === 'meeting'
                  ? pickLocaleText(locale, '结构化讨论', 'Structured Discussion')
                  : pickLocaleText(locale, '轻松聊天', 'Casual Chat')}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--acc)]20 text-[var(--acc)] border border-[var(--acc)]30">
                {locale === 'en' ? `Round ${session?.round || 0}` : `第${session?.round || 0}轮`}
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${session?.run_state === 'paused' ? 'bg-amber-900/30 text-amber-300 border-amber-700/40' : 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40'}`}>
                {session?.run_state === 'paused'
                  ? pickLocaleText(locale, '已暂停', 'Paused')
                  : pickLocaleText(locale, '运行中', 'Running')}
              </span>
              {session?.phase === 'concluded' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800">
                  {pickLocaleText(locale, '已结束', 'Concluded')}
                </span>
              )}
            </div>
            <div className="text-xs text-[var(--muted)]">
              {pickLocaleText(locale, '议题', 'Topic')}：{session?.topic}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowConstraint(!showConstraint)}
              className="text-xs px-2.5 py-1 rounded-lg border border-amber-600/40 text-amber-400 hover:bg-amber-900/20 transition"
            >
              {pickLocaleText(locale, '⚡ 补充条件', '⚡ Add Condition')}
            </button>
            <button
              onClick={handleDice}
              disabled={diceRolling || loading}
              className="text-xs px-2.5 py-1 rounded-lg border border-purple-600/40 text-purple-400 hover:bg-purple-900/20 transition"
            >
              🎲 {diceRolling ? '...' : pickLocaleText(locale, '随机事件', 'Random Event')}
            </button>
            <button
              onClick={() => setAutoPlay(!autoPlay)}
              disabled={session?.run_state === 'paused'}
              className={`text-xs px-2.5 py-1 rounded-lg border transition ${autoPlay ? 'border-green-600/40 text-green-400 bg-green-900/20' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'} disabled:opacity-40`}
            >
              {autoPlay ? pickLocaleText(locale, '⏸ 暂停自动继续', '⏸ Pause Auto Continue') : pickLocaleText(locale, '▶ 自动继续', '▶ Auto Continue')}
            </button>
            {session?.phase !== 'concluded' && (
              <button
                onClick={handlePauseResume}
                disabled={loading}
                className={`text-xs px-2.5 py-1 rounded-lg border transition ${session?.run_state === 'paused' ? 'border-emerald-600/40 text-emerald-300 hover:bg-emerald-900/20' : 'border-amber-600/40 text-amber-300 hover:bg-amber-900/20'} disabled:opacity-40`}
              >
                {session?.run_state === 'paused'
                  ? pickLocaleText(locale, '⏯ 继续讨论', '⏯ Resume Discussion')
                  : pickLocaleText(locale, '⏸ 暂停讨论', '⏸ Pause Discussion')}
              </button>
            )}
            {session?.phase !== 'concluded' && (
              <button
                onClick={handleConclude}
                className="text-xs px-2.5 py-1 rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--warn)] hover:border-[var(--warn)]40 transition"
              >
                {pickLocaleText(locale, '📋 结束讨论', '📋 End Discussion')}
              </button>
            )}
            <button
              onClick={handleReset}
              className="text-xs px-2 py-1 rounded-lg border border-red-900/40 text-red-400/70 hover:text-red-400 transition"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {showConstraint && (
        <div className="bg-gradient-to-br from-amber-950/40 to-purple-950/30 rounded-xl p-4 border border-amber-700/30" style={{ animation: 'fadeIn .3s' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-amber-400">{pickLocaleText(locale, '⚡ 补充条件', '⚡ Add Condition')}</span>
            <button onClick={() => setShowConstraint(false)} className="text-xs text-[var(--muted)]">✕</button>
          </div>
          <p className="text-[10px] text-amber-300/60 mb-2">
            {pickLocaleText(locale, '你可以补充新的限制、背景变化或额外要求，系统会据此调整讨论方向。', 'Add new constraints, context changes, or extra requirements, and the system will adjust the discussion accordingly.')}
          </p>
          <div className="flex gap-2">
            <input
              value={constraintInput}
              onChange={(e) => setConstraintInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConstraint()}
              placeholder={pickLocaleText(locale, '例如：预算减半，但上线时间不能延后...', 'Example: cut the budget in half, but do not delay the launch date...')}
              className="flex-1 bg-black/30 rounded-lg px-3 py-1.5 text-sm border border-amber-800/40 outline-none focus:border-amber-600"
            />
            <button
              onClick={handleConstraint}
              disabled={!constraintInput.trim()}
              className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-purple-600 text-white text-xs font-semibold disabled:opacity-40"
            >
              {pickLocaleText(locale, '加入', 'Add')}
            </button>
          </div>
        </div>
      )}

      {diceResult && (
        <div className="bg-purple-950/40 rounded-lg px-3 py-2 border border-purple-700/30 text-xs text-purple-300 flex items-center gap-2" style={{ animation: 'fadeIn .3s' }}>
          <span className="text-lg">🎲</span>
          {diceResult}
        </div>
      )}

      {constraintFlash && (
        <div
          className="fixed inset-0 pointer-events-none z-50"
          style={{
            background: 'radial-gradient(circle, rgba(255,200,50,0.3), transparent 70%)',
            animation: 'fadeOut .8s forwards',
          }}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_.8fr] gap-4">
        <div className="space-y-4 min-w-0">
          <div className="bg-[var(--panel)] rounded-xl border border-[var(--line)] p-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">


              <MetricCard
                title={pickLocaleText(locale, '当前模式', 'Current Mode')}
                value={currentMode === 'meeting' ? pickLocaleText(locale, '正式讨论', 'Formal Discussion') : pickLocaleText(locale, '轻松聊天', 'Chat')}
                accent={currentMode === 'meeting' ? '#e8a040' : '#6a9eff'}
              />
              <MetricCard
                title={pickLocaleText(locale, '当前发起人', 'Current Lead')}
                value={session?.moderator_name || deptMeta(currentModeratorId, locale).label}
                accent={'#a07aff'}
              />
              <MetricCard
                title={pickLocaleText(locale, '当前阶段', 'Current Stage')}
                value={locale === 'en' ? stageText.en : stageText.zh}
                accent={'#6aef9a'}
              />
              <MetricCard
                title={pickLocaleText(locale, '可追溯记录', 'Trace Entries')}
                value={String(trace.length)}
                accent={'#ff9a6a'}
              />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_.85fr] gap-3">
              <div className="rounded-lg border border-[var(--line)] bg-[var(--panel2)] p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs font-semibold">{pickLocaleText(locale, '成员忙碌概览', 'Member Busy Overview')}</div>
                  <span className="text-[10px] text-[var(--muted)]">{busyEntries.filter((item) => item.state !== 'idle').length}/{busyEntries.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {busyEntries.map((entry) => (
                    <div key={entry.agent_id} className={`px-2 py-1 rounded-lg border text-[10px] ${busyAccent(entry.state)}`}>
                      <span className="font-semibold">{entry.emoji} {entry.name}</span>
                      <span className="ml-1 opacity-80">{entry.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-[var(--panel2)] p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs font-semibold">{pickLocaleText(locale, '进行中的其他讨论', 'Other Active Discussions')}</div>
                  <span className="text-[10px] text-[var(--muted)]">{activeBusySessions.length}</span>
                </div>
                {activeBusySessions.length > 0 ? (
                  <div className="space-y-2 max-h-[120px] overflow-y-auto pr-1">
                    {activeBusySessions.slice(0, 4).map((item) => (
                      <div key={item.session_id} className="rounded-lg border border-[var(--line)] p-2 text-[10px] bg-black/10">
                        <div className="font-semibold text-[var(--text)] truncate">{item.topic}</div>
                        <div className="text-[var(--muted)] mt-1">
                          {pickLocaleText(locale, '状态', 'State')}：{item.run_state || '-'} · {pickLocaleText(locale, '轮次', 'Round')} {item.round}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-[var(--muted)]">{pickLocaleText(locale, '当前没有其他讨论占用这些成员。', 'No other discussions are currently occupying these members.')}</div>
                )}
              </div>
            </div>
          </div>

          {currentMode === 'meeting' && session?.phase !== 'concluded' && (
            <div className="bg-[var(--panel)] rounded-xl border border-[var(--line)] p-4 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-sm font-semibold">{pickLocaleText(locale, '🎯 本轮参与成员', '🎯 Participants for This Round')}</div>
                  <div className="text-xs text-[var(--muted)] mt-1">
                    {pickLocaleText(locale, '只有当前选中的成员会在下一轮参与表达，你也可以直接进入下一步。', 'Only the selected members will participate in the next round, and you can also move directly to the next step.')}
                  </div>
                </div>
                <button
                  onClick={() => setSpeakerSelection(new Set(speakerPool.map((agent) => agent.id)))}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[var(--acc)]40 text-[var(--acc)] hover:bg-[var(--acc)]10 transition"
                >
                  {pickLocaleText(locale, '本轮全选', 'Select All for This Round')}
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {speakerPool.map((agent) => {
                  const meta = deptMeta(agent.id, locale);
                  const active = speakerSelection.has(agent.id);
                  const busy = busyByAgent.get(agent.id);
                  const blocked = Boolean(busy && busy.session_id && busy.session_id !== session?.session_id && busy.state !== 'idle');
                  return (
                    <button
                      key={agent.id}
                      onClick={() => toggleSpeaker(agent.id)}
                      disabled={blocked}
                      className="p-2 rounded-lg border text-left transition disabled:opacity-50"
                      style={{
                        borderColor: active ? meta.color + '80' : 'var(--line)',
                        background: active ? meta.color + '15' : 'var(--panel2)',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span>{agent.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">{agent.name}</div>
                          <div className="text-[10px] text-[var(--muted)] truncate">{agent.role}</div>
                          {busy && busy.state !== 'idle' && (
                            <div className="mt-1">
                              <span className={`inline-flex text-[9px] px-1.5 py-0.5 rounded-full border ${busyAccent(busy.state)}`}>
                                {busy.label}
                              </span>
                            </div>
                          )}
                        </div>
                        {blocked ? <span className="text-[10px] text-amber-300">!</span> : active && <span className="text-[10px] text-[var(--acc)]">✓</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => handleAdvance({
                    intent: 'next_round',
                    speakerIds: Array.from(speakerSelection),
                  })}
                  disabled={loading || speakerSelection.size === 0}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-[var(--acc)]40 text-[var(--acc)] hover:bg-[var(--acc)]10 disabled:opacity-40"
                >
                  {pickLocaleText(locale, '让已选成员继续', 'Continue with Selected Members')}
                </button>
                <button
                  onClick={() => handleAdvance({
                    intent: 'next_stage',
                    speakerIds: Array.from(speakerSelection),
                    stageAction: 'next_stage',
                  })}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-green-600/40 text-green-400 hover:bg-green-900/20 disabled:opacity-40"
                >
                  {pickLocaleText(locale, '进入下一步', 'Go to Next Step')}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-3">
            <div className="bg-[var(--panel)] rounded-xl p-3 border border-[var(--line)] relative overflow-hidden min-h-[340px]">
              <div className="text-center mb-2">
                <div className="inline-block px-3 py-1 rounded-lg bg-gradient-to-b from-amber-800/40 to-amber-950/40 border border-amber-700/30">
                  <span className="text-lg">👥</span>
                  <div className="text-[10px] text-amber-400/80">
                    {session?.moderator_name || pickLocaleText(locale, '当前带领人', 'Current Lead')}
                  </div>
                </div>
              </div>

              <div className="relative" style={{ minHeight: 270 }}>
                <div className="absolute left-0 top-0 text-[9px] text-[var(--muted)] opacity-50">{pickLocaleText(locale, '讨论引导', 'Discussion Lead')}</div>
                <div className="absolute right-0 top-0 text-[9px] text-[var(--muted)] opacity-50">{pickLocaleText(locale, '参与成员', 'Participants')}</div>

                {sessionAgents.map((agent) => {
                  const pos = COLLAB_POSITIONS[agent.id] || { x: 50, y: 50 };
                  const meta = deptMeta(agent.id, locale);
                  const color = meta.color;
                  const isSpeaking = speakingId === agent.id;
                  const emotion = emotions[agent.id] || 'neutral';
                  const isModerator = currentModeratorId === agent.id;
                  const isQueued = (session?.speaker_queue || []).includes(agent.id);
                  const busy = sessionBusySnapshot.find((entry) => entry.agent_id === agent.id) || busyByAgent.get(agent.id);
                  const isConflicted = (session?.conflicted_agents || []).includes(agent.id);

                  return (
                    <div
                      key={agent.id}
                      className="absolute transition-all duration-500"
                      style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
                    >
                      {isSpeaking && (
                        <div
                          className="absolute -inset-2 rounded-full"
                          style={{ background: `radial-gradient(circle, ${color}40, transparent)`, animation: 'pulse 1s infinite' }}
                        />
                      )}
                      <div
                        className="relative w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 transition-all"
                        style={{
                          borderColor: isSpeaking || isModerator ? color : color + '40',
                          background: isSpeaking || isModerator ? color + '30' : color + '10',
                          transform: isSpeaking ? 'scale(1.2)' : 'scale(1)',
                          boxShadow: isSpeaking ? `0 0 16px ${color}50` : 'none',
                        }}
                      >
                        {agent.emoji}
                        {EMOTION_EMOJI[emotion] && (
                          <span className="absolute -top-1 -right-1 text-xs" style={{ animation: 'bounceIn .3s' }}>
                            {EMOTION_EMOJI[emotion]}
                          </span>
                        )}
                        {isModerator && (
                          <span className="absolute -bottom-1 -right-1 text-[9px] bg-amber-500 text-black rounded-full w-4 h-4 flex items-center justify-center">H</span>
                        )}
                      </div>
                      <div className="text-[9px] text-center mt-0.5 whitespace-nowrap" style={{ color: isSpeaking ? color : 'var(--muted)' }}>
                        {agent.name}
                      </div>
                        {isQueued && currentMode === 'meeting' && (
                          <div className="text-[8px] text-center text-emerald-400 mt-0.5">
                            {pickLocaleText(locale, '本轮参与', 'Active This Round')}
                          </div>
                        )}
                        {busy && (
                          <div className={`text-[8px] text-center mt-0.5 px-1 py-0.5 rounded border ${busyAccent(busy.state)}`}>
                            {isConflicted
                              ? pickLocaleText(locale, '正在参与其他讨论', 'Busy in Another Discussion')
                              : busy.label}
                          </div>
                        )}

                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-[var(--panel)] rounded-xl border border-[var(--line)] flex flex-col" style={{ maxHeight: 620 }}>
              <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ minHeight: 260 }}>
                {(session?.messages || []).map((msg, i) => (
                  <MessageBubble key={i} msg={msg} agents={sessionAgents} locale={locale} moderatorId={currentModeratorId} />
                ))}
                {loading && (
                  <div className="text-xs text-[var(--muted)] text-center py-2" style={{ animation: 'pulse 1.5s infinite' }}>
                    {currentMode === 'meeting'
                      ? pickLocaleText(locale, '👥 大家正在整理这一轮内容...', '👥 Everyone is preparing the next part...')
                      : pickLocaleText(locale, '👥 讨论仍在继续...', '👥 The discussion is continuing...')}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {session?.phase !== 'concluded' && (
                <div className="border-t border-[var(--line)] p-3 space-y-2">
                  <div className="text-[11px] text-[var(--muted)]">
                    {session?.run_state === 'paused'
                      ? pickLocaleText(locale, '讨论已暂停。你可以恢复后继续，或直接结束本次讨论。', 'The discussion is paused. Resume it to continue, or end it directly.')
                      : currentMode === 'meeting'
                        ? pickLocaleText(locale, '你可以随时补充要求，或按当前已选成员继续推进。', 'You can add requirements at any time, or continue with the currently selected members.')
                        : pickLocaleText(locale, '你可以像在群聊里一样直接和大家说话。', 'You can talk to everyone as if you were in a group chat.')}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUserSubmit()}
                      placeholder={pickLocaleText(locale, '输入你的消息...', 'Type your message...')}
                      className="flex-1 bg-[var(--panel2)] rounded-lg px-3 py-2 text-sm border border-[var(--line)] outline-none focus:border-amber-600"
                    />
                    <button
                      onClick={handleUserSubmit}
                      disabled={!userInput.trim() || loading || session?.run_state === 'paused'}
                      className="px-4 py-2 rounded-lg text-xs font-semibold border-0 disabled:opacity-40"
                      style={{
                        background: userInput.trim() ? 'linear-gradient(135deg, #e8a040, #f5c842)' : 'var(--panel2)',
                        color: userInput.trim() ? '#000' : 'var(--muted)',
                      }}
                    >
                      {pickLocaleText(locale, '发送', 'Send')}
                    </button>
                    <button
                      onClick={() => handleAdvance({
                        intent: currentMode === 'meeting' ? 'next_round' : 'chat',
                        speakerIds: currentMode === 'meeting' ? Array.from(speakerSelection) : [],
                      })}
                      disabled={loading || session?.run_state === 'paused'}
                      className="px-3 py-2 rounded-lg text-xs border border-[var(--acc)]40 text-[var(--acc)] hover:bg-[var(--acc)]10 disabled:opacity-40 transition"
                    >
                      {currentMode === 'meeting'
                        ? pickLocaleText(locale, '下一轮', 'Next Round')
                        : pickLocaleText(locale, '继续聊', 'Continue')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          <div className="bg-[var(--panel)] rounded-xl border border-[var(--line)] p-4 space-y-3">
            <div className="text-sm font-semibold">{pickLocaleText(locale, '📒 讨论摘要 / 对话记录', '📒 Discussion Summary / Notes')}</div>
            {minutes.length > 0 ? (
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {minutes.slice().reverse().map((minute, idx) => (
                  <div key={`${minute.timestamp}-${idx}`} className="rounded-lg border border-[var(--line)] bg-[var(--panel2)] p-2">
                    <div className="text-[10px] text-[var(--muted)] mb-1">
                      {pickLocaleText(locale, '第', 'Round ')}{minute.round}{pickLocaleText(locale, '轮', '')} · {locale === 'en' ? (STAGE_LABEL[minute.stage]?.en || minute.stage) : (STAGE_LABEL[minute.stage]?.zh || minute.stage)}
                    </div>
                    <div className="text-xs leading-relaxed">{minute.content}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-[var(--muted)]">
                {currentMode === 'meeting'
                  ? pickLocaleText(locale, '讨论摘要会随着交流推进持续生成。', 'The discussion summary will continue to build as the conversation progresses.')
                  : pickLocaleText(locale, '轻松聊天模式下不会强制生成正式摘要。', 'Casual chat does not enforce a formal summary.')}
              </div>
            )}
            {session?.summary && (
              <div className="rounded-lg border border-emerald-700/30 bg-emerald-950/20 p-2">
                <div className="text-[10px] text-emerald-400 mb-1">{pickLocaleText(locale, '最终总结', 'Final Summary')}</div>
                <div className="text-xs leading-relaxed">{session.summary}</div>
              </div>
            )}
          </div>

          <SummaryListCard title={pickLocaleText(locale, '✅ 当前结论', '✅ Decisions')} items={decisions} emptyText={pickLocaleText(locale, '尚未形成结论。', 'No decisions yet.')} accent="emerald" />
          <SummaryListCard title={pickLocaleText(locale, '❓ 待决问题', '❓ Open Questions')} items={openQuestions} emptyText={pickLocaleText(locale, '暂无待决问题。', 'No open questions.')} accent="amber" />
          <SummaryListCard title={pickLocaleText(locale, '📌 行动项', '📌 Action Items')} items={actionItems} emptyText={pickLocaleText(locale, '暂无行动项。', 'No action items.')} accent="sky" />

          <div className="bg-[var(--panel)] rounded-xl border border-[var(--line)] p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-sm font-semibold">{pickLocaleText(locale, '🧾 可追溯记录', '🧾 Trace Log')}</div>
              <span className="text-[10px] text-[var(--muted)]">{trace.length}</span>
            </div>
            {trace.length > 0 ? (
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {trace.slice().reverse().map((item, idx) => (
                  <div key={`${item.at || idx}-${idx}`} className="rounded-lg border border-[var(--line)] bg-[var(--panel2)] p-2 text-xs">
                    <div className="text-[10px] text-[var(--muted)] mb-1">
                      {pickLocaleText(locale, '阶段', 'Stage')}：{locale === 'en' ? (STAGE_LABEL[item.stage || '']?.en || item.stage || '-') : (STAGE_LABEL[item.stage || '']?.zh || item.stage || '-')}
                    </div>
                    <div className="leading-relaxed break-words">
                      {renderTrace(item, locale)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-[var(--muted)]">{pickLocaleText(locale, '暂无追溯记录。', 'No trace entries yet.')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, accent }: { title: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel2)] p-3">
      <div className="text-[10px] text-[var(--muted)] mb-1">{title}</div>
      <div className="text-sm font-semibold" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function SummaryListCard({
  title,
  items,
  emptyText,
  accent,
}: {
  title: string;
  items: string[];
  emptyText: string;
  accent: 'emerald' | 'amber' | 'sky';
}) {
  const colorMap = {
    emerald: 'text-emerald-400 border-emerald-700/30 bg-emerald-950/10',
    amber: 'text-amber-400 border-amber-700/30 bg-amber-950/10',
    sky: 'text-sky-400 border-sky-700/30 bg-sky-950/10',
  };

  return (
    <div className="bg-[var(--panel)] rounded-xl border border-[var(--line)] p-4">
      <div className={`text-sm font-semibold mb-2 ${colorMap[accent].split(' ')[0]}`}>{title}</div>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={`${item}-${idx}`} className={`rounded-lg border p-2 text-xs leading-relaxed ${colorMap[accent]}`}>
              {item}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-[var(--muted)]">{emptyText}</div>
      )}
    </div>
  );
}

function renderTrace(item: TraceEntry, locale: Locale) {
  if (item.kind === 'user_message' && item.content) {
    return pickLocaleText(locale, `用户插话：${item.content}`, `User spoke: ${item.content}`);
  }
  if (item.kind === 'constraint' && item.content) {
    return pickLocaleText(locale, `注入约束：${item.content}`, `Constraint injected: ${item.content}`);
  }
  if (item.kind === 'advance') {
    const speakers = (item.speaker_ids || []).join(', ') || pickLocaleText(locale, '未指定', 'not specified');
    return pickLocaleText(locale, `讨论已推进，当前意图：${item.intent || 'auto'}；参与名单：${speakers}。`, `Discussion advanced. Intent: ${item.intent || 'auto'}; participants: ${speakers}.`);
  }
  if (item.kind === 'concluded' && item.summary) {
    return pickLocaleText(locale, `讨论结束：${item.summary}`, `Discussion concluded: ${item.summary}`);
  }
  return item.kind || '-';
}

function MessageBubble({
  msg,
  agents,
  locale,
  moderatorId,
}: {
  msg: CollabMessage;
  agents: CollabAgent[];
  locale: Locale;
  moderatorId: string;
}) {
  const speakerId = msg.agent_id || '';
  const speakerName = msg.agent_name || pickLocaleText(locale, '成员', 'Member');
  const meta = deptMeta(speakerId, locale);
  const color = meta.color;
  const agent = agents.find((o) => o.id === speakerId);
  const isModerator = speakerId === moderatorId || msg.type === 'moderator';

  if (msg.type === 'system') {
    return (
      <div className="text-center text-[10px] text-[var(--muted)] py-1 border-b border-[var(--line)] border-dashed">
        {msg.content}
      </div>
    );
  }

  if (msg.type === 'scene_note') {
    return (
      <div className="text-center text-[10px] text-purple-400/80 py-1 italic">
        ✦ {msg.content} ✦
      </div>
    );
  }

  if (msg.type === 'minutes') {
    return (
      <div className="text-center py-2">
        <div className="inline-block rounded-lg px-4 py-2 border border-emerald-700/30 bg-emerald-950/20">
          <div className="text-xs text-emerald-400 font-bold">{pickLocaleText(locale, '📒 纪要更新', '📒 Minutes Update')}</div>
          <div className="text-sm mt-0.5">{msg.content}</div>
        </div>
      </div>
    );
  }

  if (msg.type === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-gradient-to-br from-amber-900/40 to-amber-800/20 rounded-xl px-3 py-2 border border-amber-700/30">
          <div className="text-[10px] text-amber-400 mb-0.5">{pickLocaleText(locale, '👤 用户', '👤 User')}</div>
          <div className="text-sm">{msg.content}</div>
        </div>
      </div>
    );
  }

  if (msg.type === 'constraint') {
    return (
      <div className="text-center py-2">
        <div className="inline-block bg-gradient-to-r from-amber-900/30 via-purple-900/30 to-amber-900/30 rounded-lg px-4 py-2 border border-amber-600/30">
          <div className="text-xs text-amber-400 font-bold">{pickLocaleText(locale, '⚡ 新约束已注入', '⚡ New Constraint Injected')}</div>
          <div className="text-sm mt-0.5">{msg.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 items-start" style={{ animation: 'fadeIn .4s' }}>
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 border"
        style={{ borderColor: color + '60', background: color + '15' }}
      >
        {isModerator ? '👥' : agent?.emoji || '👥'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <span className="text-[11px] font-semibold" style={{ color }}>
            {speakerName}
          </span>
          {isModerator && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-700/30 text-amber-400 bg-amber-900/20">
              {pickLocaleText(locale, '带领人', 'Lead')}
            </span>
          )}
          {msg.action && (
            <span className="text-[10px] text-[var(--muted)]">· {msg.action}</span>
          )}
          {msg.emotion && EMOTION_EMOJI[msg.emotion] && <span className="text-xs">{EMOTION_EMOJI[msg.emotion]}</span>}
        </div>
        <div className="text-sm leading-relaxed">
          {msg.content?.split(/(\*[^*]+\*)/).map((part, i) => {
            if (part.startsWith('*') && part.endsWith('*')) {
              return (
                <span key={i} className="text-[var(--muted)] italic text-xs">
                  {part.slice(1, -1)}
                </span>
              );
            }
            return <span key={i}>{part}</span>;
          })}
        </div>
      </div>
    </div>
  );
}
