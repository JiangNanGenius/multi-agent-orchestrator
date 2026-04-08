/**
 * 协同讨论 — 多Agent实时讨论可视化组件
 *
 * 灵感来自 nvwa 项目的故事剧场 + 协作工坊 + 虚拟生活
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore, DEPTS, deptMeta } from '../store';
import { api } from '../api';
import { pickLocaleText, type Locale } from '../i18n';

const EMOTION_EMOJI: Record<string, string> = {
  neutral: '', confident: '😏', worried: '😟', angry: '😤',
  thinking: '🤔', amused: '😄', happy: '😊',
};

const COURT_POSITIONS: Record<string, { x: number; y: number }> = {
  plan_center: { x: 15, y: 25 }, review_center: { x: 15, y: 45 }, dispatch_center: { x: 15, y: 65 },
  docs_specialist: { x: 85, y: 18 }, data_specialist: { x: 85, y: 31 }, code_specialist: { x: 85, y: 44 },
  audit_specialist: { x: 85, y: 57 }, deploy_specialist: { x: 85, y: 70 }, search_specialist: { x: 85, y: 83 },
  control_center: { x: 50, y: 20 }, admin_specialist: { x: 50, y: 80 },
};

interface CourtMessage {
  type: string;
  content: string;
  agent_id?: string;
  agent_name?: string;
  emotion?: string;
  action?: string;
  timestamp?: number;
}

interface CourtSession {
  session_id: string;
  topic: string;
  agents: Array<{
    id: string;
    name: string;
    emoji: string;
    role: string;
    personality: string;
    speaking_style: string;
  }>;
  messages: CourtMessage[];
  round: number;
  phase: string;
}

export default function CourtDiscussion() {
  const locale = useStore((s) => s.locale);
  const toast = useStore((s) => s.toast);
  const liveStatus = useStore((s) => s.liveStatus);

  const [phase, setPhase] = useState<'setup' | 'session'>('setup');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [topic, setTopic] = useState('');
  const [session, setSession] = useState<CourtSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayRef = useRef(false);

  const [userInput, setUserInput] = useState('');
  const [showDecree, setShowDecree] = useState(false);
  const [decreeInput, setDecreeInput] = useState('');
  const [decreeFlash, setDecreeFlash] = useState(false);
  const [diceRolling, setDiceRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [emotions, setEmotions] = useState<Record<string, string>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages?.length]);

  useEffect(() => {
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);

  useEffect(() => {
    if (!autoPlay || !session || loading) return;
    const timer = setInterval(() => {
      if (autoPlayRef.current && !loading) {
        handleAdvance();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [autoPlay, session, loading]);

  const toggleAgent = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 8) next.add(id);
      return next;
    });
  };

  const handleStart = async () => {
    if (!topic.trim() || selectedIds.size < 2 || loading) return;
    setLoading(true);
    try {
      const res = await api.courtDiscussStart(topic, Array.from(selectedIds));
      if (!res.ok) throw new Error(res.error || pickLocaleText(locale, '启动失败', 'Failed to start discussion'));
      setSession(res as unknown as CourtSession);
      setPhase('session');
    } catch (e: unknown) {
      toast((e as Error).message || pickLocaleText(locale, '启动失败', 'Failed to start discussion'), 'err');
    } finally {
      setLoading(false);
    }
  };

  const handleAdvance = useCallback(async (userMsg?: string, decree?: string) => {
    if (!session || loading) return;
    setLoading(true);

    try {
      const res = await api.courtDiscussAdvance(session.session_id, userMsg, decree);
      if (!res.ok) throw new Error(res.error || pickLocaleText(locale, '推进失败', 'Failed to advance discussion'));

      setSession((prev) => {
        if (!prev) return prev;
        const newMsgs: CourtMessage[] = [];

        if (userMsg) {
          newMsgs.push({ type: 'emperor', content: userMsg, timestamp: Date.now() / 1000 });
        }
        if (decree) {
          newMsgs.push({ type: 'decree', content: decree, timestamp: Date.now() / 1000 });
        }

        const aiMsgs = (res.new_messages || []).map((m: Record<string, string>) => ({
          type: 'agent',
          agent_id: m.agent_id || m.official_id,
          agent_name: m.agent_name || m.official_name || m.name,
          content: m.content,
          emotion: m.emotion,
          action: m.action,
          timestamp: Date.now() / 1000,
        }));

        if (res.scene_note) {
          newMsgs.push({ type: 'scene_note', content: res.scene_note, timestamp: Date.now() / 1000 });
        }

        return {
          ...prev,
          round: res.round ?? prev.round + 1,
          messages: [...prev.messages, ...newMsgs, ...aiMsgs],
        };
      });

      const aiMsgs = (res.new_messages || []).map((m: Record<string, string>) => ({
        agent_id: m.agent_id || m.official_id,
        emotion: m.emotion || 'neutral',
      })).filter((m) => Boolean(m.agent_id));
      if (aiMsgs.length > 0) {
        const emotionMap: Record<string, string> = {};
        let idx = 0;
        const cycle = () => {
          if (idx < aiMsgs.length) {
            const currentAgentId = aiMsgs[idx].agent_id as string;
            setSpeakingId(currentAgentId);
            emotionMap[currentAgentId] = aiMsgs[idx].emotion || 'neutral';
            idx++;
            setTimeout(cycle, 1200);
          } else {
            setSpeakingId(null);
          }
        };
        cycle();
        setEmotions((prev) => ({ ...prev, ...emotionMap }));
      }
    } catch {
      // ignore silently to match existing interaction pattern
    } finally {
      setLoading(false);
    }
  }, [session, loading, locale]);

  const handleEmperor = () => {
    const msg = userInput.trim();
    if (!msg) return;
    setUserInput('');
    handleAdvance(msg);
  };

  const handleDecree = () => {
    const msg = decreeInput.trim();
    if (!msg) return;
    setDecreeInput('');
    setShowDecree(false);
    setDecreeFlash(true);
    setTimeout(() => setDecreeFlash(false), 800);
    handleAdvance(undefined, msg);
  };

  const handleDice = async () => {
    if (loading || diceRolling) return;
    setDiceRolling(true);
    setDiceResult(null);

    let count = 0;
    const timer = setInterval(async () => {
      count++;
      setDiceResult(pickLocaleText(locale, '🎲 命运轮转中...', '🎲 Fate is turning...'));
      if (count >= 6) {
        clearInterval(timer);
        try {
          const res = await api.courtDiscussFate();
          const event = res.event || pickLocaleText(locale, '边疆急报传来', 'Urgent frontier news arrives');
          setDiceResult(event);
          setDiceRolling(false);
          handleAdvance(undefined, locale === 'en' ? `[Random Event] ${event}` : `【随机事件】${event}`);
        } catch {
          setDiceResult(pickLocaleText(locale, '命运之力暂时无法触及', 'The force of fate cannot be reached right now'));
          setDiceRolling(false);
        }
      }
    }, 200);
  };

  const handleConclude = async () => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await api.courtDiscussConclude(session.session_id);
      if (res.summary) {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                phase: 'concluded',
                messages: [
                  ...prev.messages,
                  {
                    type: 'system',
                    content: locale === 'en' ? `📋 Discussion concluded — ${res.summary}` : `📋 协同讨论结束 — ${res.summary}`,
                    timestamp: Date.now() / 1000,
                  },
                ],
              }
            : prev,
        );
      }
      setAutoPlay(false);
    } catch {
      toast(pickLocaleText(locale, '结束失败', 'Failed to conclude discussion'), 'err');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (session) {
      api.courtDiscussDestroy(session.session_id).catch(() => {});
    }
    setPhase('setup');
    setSession(null);
    setAutoPlay(false);
    setEmotions({});
    setSpeakingId(null);
    setDiceResult(null);
  };

  const activeEdicts = (liveStatus?.tasks || []).filter(
    (t) => /^JJC-/i.test(t.id) && !['Done', 'Cancelled'].includes(t.state),
  );

  const presetTopics = [
    ...activeEdicts.slice(0, 3).map((t) => ({
      text: locale === 'en' ? `Discuss task ${t.id}: ${t.title}` : `讨论任务 ${t.id}：${t.title}`,
      taskId: t.id,
      icon: '📜',
    })),
    { text: pickLocaleText(locale, '讨论系统架构优化方案', 'Discuss system architecture optimization'), taskId: '', icon: '🏗️' },
    { text: pickLocaleText(locale, '评估当前项目进展和风险', 'Assess current project progress and risks'), taskId: '', icon: '📊' },
    { text: pickLocaleText(locale, '制定下周工作计划', 'Prepare the work plan for next week'), taskId: '', icon: '📋' },
    { text: pickLocaleText(locale, '紧急问题：线上Bug排查方案', 'Urgent issue: production bug investigation plan'), taskId: '', icon: '🚨' },
  ];

  if (phase === 'setup') {
    return (
      <div className="space-y-6">
        <div className="text-center py-4">
          <h2 className="text-xl font-bold bg-gradient-to-r from-amber-400 to-purple-400 bg-clip-text text-transparent">
            {pickLocaleText(locale, '🏛 协同讨论', '🏛 Collaboration Discussion')}
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            {pickLocaleText(locale, '选择参与 Agent，围绕议题展开讨论 · 你可随时发言或注入新约束改变讨论走向', 'Choose participating agents and start a discussion around the topic. You can speak at any time or inject new constraints to redirect the discussion.')}
          </p>
        </div>

        <div className="bg-[var(--panel)] rounded-xl p-4 border border-[var(--line)]">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold">{pickLocaleText(locale, '👔 选择参与 Agent', '👔 Select Agents')}</span>
            <span className="text-xs text-[var(--muted)]">
              {locale === 'en' ? `(${selectedIds.size}/8, at least 2)` : `（${selectedIds.size}/8，至少2位）`}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {DEPTS.map((d) => {
              const active = selectedIds.has(d.id);
              const meta = deptMeta(d.id, locale);
              const color = meta.color;
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
                    <div>
                      <div className="text-xs font-semibold" style={{ color: active ? color : 'var(--text)' }}>
                        {meta.label}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">{meta.role}</div>
                    </div>
                    {active && (
                      <span
                        className="ml-auto w-4 h-4 rounded-full flex items-center justify-center text-[10px] text-white"
                        style={{ background: color }}
                      >
                        ✓
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-[var(--panel)] rounded-xl p-4 border border-[var(--line)]">
          <div className="text-sm font-semibold mb-2">{pickLocaleText(locale, '📜 设置议题', '📜 Set Topic')}</div>
          {presetTopics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {presetTopics.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setTopic(p.text)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--line)] hover:border-[var(--acc)] hover:text-[var(--acc)] transition-colors"
                  style={{
                    background: topic === p.text ? 'var(--acc)' + '18' : 'transparent',
                    borderColor: topic === p.text ? 'var(--acc)' : undefined,
                    color: topic === p.text ? 'var(--acc)' : undefined,
                  }}
                >
                  {p.icon} {p.text}
                </button>
              ))}
            </div>
          )}
          <textarea
            className="w-full bg-[var(--panel2)] rounded-lg p-3 text-sm border border-[var(--line)] focus:border-[var(--acc)] outline-none resize-none"
            rows={2}
            placeholder={pickLocaleText(locale, '或自定义议题...', 'Or enter a custom topic...')}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            pickLocaleText(locale, '👤 用户发言', '👤 User Speech'),
            pickLocaleText(locale, '⚡ 插入约束', '⚡ Inject Constraints'),
            pickLocaleText(locale, '🎲 随机事件', '🎲 Random Event'),
            pickLocaleText(locale, '🔄 自动推进', '🔄 Auto Advance'),
            pickLocaleText(locale, '📜 讨论记录', '📜 Discussion Log'),
          ].map((tag) => (
            <span key={tag} className="text-[10px] px-2 py-1 rounded-full border border-[var(--line)] text-[var(--muted)]">
              {tag}
            </span>
          ))}
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
            ? pickLocaleText(locale, '准备中...', 'Preparing...')
            : locale === 'en'
              ? `🏛 Start Collaboration (${selectedIds.size} agents)`
              : `🏛 开始协同讨论（${selectedIds.size}个 Agent）`}
        </button>
      </div>
    );
  }

  const agents = session?.agents || (session as CourtSession & { officials?: CourtSession['agents'] })?.officials || [];
  const messages = session?.messages || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2 bg-[var(--panel)] rounded-xl px-4 py-2 border border-[var(--line)]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">{pickLocaleText(locale, '🏛 协同讨论', '🏛 Collaboration')}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--acc)]20 text-[var(--acc)] border border-[var(--acc)]30">
            {locale === 'en' ? `Round ${session?.round || 0}` : `第${session?.round || 0}轮`}
          </span>
          {session?.phase === 'concluded' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800">
              {pickLocaleText(locale, '已结束', 'Concluded')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowDecree(!showDecree)}
            className="text-xs px-2.5 py-1 rounded-lg border border-amber-600/40 text-amber-400 hover:bg-amber-900/20 transition"
            title={pickLocaleText(locale, '插入约束 — 从全局视角干预讨论', 'Inject constraints — intervene from a global perspective')}
          >
            {pickLocaleText(locale, '⚡ 约束', '⚡ Constraints')}
          </button>
          <button
            onClick={handleDice}
            disabled={diceRolling || loading}
            className="text-xs px-2.5 py-1 rounded-lg border border-purple-600/40 text-purple-400 hover:bg-purple-900/20 transition"
            title={pickLocaleText(locale, '随机事件 — 为讨论注入变化', 'Random event — inject change into the discussion')}
          >
            🎲 {diceRolling ? '...' : pickLocaleText(locale, '事件', 'Event')}
          </button>
          <button
            onClick={() => setAutoPlay(!autoPlay)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition ${autoPlay
              ? 'border-green-600/40 text-green-400 bg-green-900/20'
              : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
              }`}
          >
            {autoPlay ? pickLocaleText(locale, '⏸ 暂停', '⏸ Pause') : pickLocaleText(locale, '▶ 自动', '▶ Auto')}
          </button>
          {session?.phase !== 'concluded' && (
            <button
              onClick={handleConclude}
              className="text-xs px-2.5 py-1 rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--warn)] hover:border-[var(--warn)]40 transition"
            >
              {pickLocaleText(locale, '📋 结束讨论', '📋 Conclude')}
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

      {showDecree && (
        <div
          className="bg-gradient-to-br from-amber-950/40 to-purple-950/30 rounded-xl p-4 border border-amber-700/30"
          style={{ animation: 'fadeIn .3s' }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-amber-400">{pickLocaleText(locale, '⚡ 插入约束 — 全局视角', '⚡ Inject Constraints — Global View')}</span>
            <button onClick={() => setShowDecree(false)} className="text-xs text-[var(--muted)]">
              ✕
            </button>
          </div>
          <p className="text-[10px] text-amber-300/60 mb-2">
            {pickLocaleText(locale, '注入新的限制或背景变化，所有参与 Agent 将据此重新响应', 'Inject a new constraint or context change, and all participating agents will respond accordingly.')}
          </p>
          <div className="flex gap-2">
            <input
              value={decreeInput}
              onChange={(e) => setDecreeInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDecree()}
              placeholder={pickLocaleText(locale, '例如：预算减半，但发布日期不能延后...', 'Example: cut the budget in half, but do not delay the release date...')}
              className="flex-1 bg-black/30 rounded-lg px-3 py-1.5 text-sm border border-amber-800/40 outline-none focus:border-amber-600"
            />
            <button
              onClick={handleDecree}
              disabled={!decreeInput.trim()}
              className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-purple-600 text-white text-xs font-semibold disabled:opacity-40"
            >
              {pickLocaleText(locale, '注入', 'Inject')}
            </button>
          </div>
        </div>
      )}

      {diceResult && (
        <div
          className="bg-purple-950/40 rounded-lg px-3 py-2 border border-purple-700/30 text-xs text-purple-300 flex items-center gap-2"
          style={{ animation: 'fadeIn .3s' }}
        >
          <span className="text-lg">🎲</span>
          {diceResult}
        </div>
      )}

      {decreeFlash && (
        <div
          className="fixed inset-0 pointer-events-none z-50"
          style={{
            background: 'radial-gradient(circle, rgba(255,200,50,0.3), transparent 70%)',
            animation: 'fadeOut .8s forwards',
          }}
        />
      )}

      <div className="text-xs text-center text-[var(--muted)] py-1">
        📜 {session?.topic || ''}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
        <div className="bg-[var(--panel)] rounded-xl p-3 border border-[var(--line)] relative overflow-hidden min-h-[320px]">
          <div className="text-center mb-2">
            <div className="inline-block px-3 py-1 rounded-lg bg-gradient-to-b from-amber-800/40 to-amber-950/40 border border-amber-700/30">
              <span className="text-lg">👑</span>
              <div className="text-[10px] text-amber-400/80">{pickLocaleText(locale, '龙 椅', 'Imperial Seat')}</div>
            </div>
          </div>

          <div className="relative" style={{ minHeight: 250 }}>
            <div className="absolute left-0 top-0 text-[9px] text-[var(--muted)] opacity-50">{pickLocaleText(locale, '核心中枢', 'Core Centers')}</div>
            <div className="absolute right-0 top-0 text-[9px] text-[var(--muted)] opacity-50">{pickLocaleText(locale, '专业执行组', 'Execution Team')}</div>

            {agents.map((o) => {
              const pos = COURT_POSITIONS[o.id] || { x: 50, y: 50 };
              const color = deptMeta(o.id, locale).color;
              const isSpeaking = speakingId === o.id;
              const emotion = emotions[o.id] || 'neutral';

              return (
                <div
                  key={o.id}
                  className="absolute transition-all duration-500"
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  {isSpeaking && (
                    <div
                      className="absolute -inset-2 rounded-full"
                      style={{
                        background: `radial-gradient(circle, ${color}40, transparent)`,
                        animation: 'pulse 1s infinite',
                      }}
                    />
                  )}
                  <div
                    className="relative w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 transition-all"
                    style={{
                      borderColor: isSpeaking ? color : color + '40',
                      background: isSpeaking ? color + '30' : color + '10',
                      transform: isSpeaking ? 'scale(1.2)' : 'scale(1)',
                      boxShadow: isSpeaking ? `0 0 16px ${color}50` : 'none',
                    }}
                  >
                    {o.emoji}
                    {EMOTION_EMOJI[emotion] && (
                      <span className="absolute -top-1 -right-1 text-xs" style={{ animation: 'bounceIn .3s' }}>
                        {EMOTION_EMOJI[emotion]}
                      </span>
                    )}
                  </div>
                  <div className="text-[9px] text-center mt-0.5 whitespace-nowrap" style={{ color: isSpeaking ? color : 'var(--muted)' }}>
                    {o.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-[var(--panel)] rounded-xl border border-[var(--line)] flex flex-col" style={{ maxHeight: 500 }}>
          <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ minHeight: 200 }}>
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} agents={agents} locale={locale} />
            ))}
            {loading && (
              <div className="text-xs text-[var(--muted)] text-center py-2" style={{ animation: 'pulse 1.5s infinite' }}>
                {pickLocaleText(locale, '🏛 群臣正在思考...', '🏛 The agents are thinking...')}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {session?.phase !== 'concluded' && (
            <div className="border-t border-[var(--line)] p-2 flex gap-2">
              <input
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEmperor()}
                placeholder={pickLocaleText(locale, '朕有话说...', 'Share your guidance...')}
                className="flex-1 bg-[var(--panel2)] rounded-lg px-3 py-1.5 text-sm border border-[var(--line)] outline-none focus:border-amber-600"
              />
              <button
                onClick={handleEmperor}
                disabled={!userInput.trim() || loading}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold border-0 disabled:opacity-40"
                style={{
                  background: userInput.trim() ? 'linear-gradient(135deg, #e8a040, #f5c842)' : 'var(--panel2)',
                  color: userInput.trim() ? '#000' : 'var(--muted)',
                }}
              >
                {pickLocaleText(locale, '👑 发言', '👑 Speak')}
              </button>
              <button
                onClick={() => handleAdvance()}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-xs border border-[var(--acc)]40 text-[var(--acc)] hover:bg-[var(--acc)]10 disabled:opacity-40 transition"
              >
                {pickLocaleText(locale, '▶ 下一轮', '▶ Next Round')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  agents,
  locale,
}: {
  msg: CourtMessage;
  agents: Array<{ id: string; name: string; emoji: string }>;
  locale: Locale;
}) {
  const speakerId = msg.agent_id || (msg as CourtMessage & { official_id?: string }).official_id || '';
  const speakerName = msg.agent_name || (msg as CourtMessage & { official_name?: string }).official_name || 'Agent';
  const color = deptMeta(speakerId, locale).color;
  const agent = agents.find((o) => o.id === speakerId);

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

  if (msg.type === 'emperor') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-gradient-to-br from-amber-900/40 to-amber-800/20 rounded-xl px-3 py-2 border border-amber-700/30">
          <div className="text-[10px] text-amber-400 mb-0.5">{pickLocaleText(locale, '👤 用户', '👤 User')}</div>
          <div className="text-sm">{msg.content}</div>
        </div>
      </div>
    );
  }

  if (msg.type === 'decree') {
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
        {agent?.emoji || '💬'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[11px] font-semibold" style={{ color }}>
            {speakerName}
          </span>
          {msg.emotion && EMOTION_EMOJI[msg.emotion] && (
            <span className="text-xs">{EMOTION_EMOJI[msg.emotion]}</span>
          )}
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
