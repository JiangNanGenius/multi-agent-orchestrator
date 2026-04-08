import { useState } from 'react';
import type { ReplyMeta, SourceMeta, Task } from '../api';
import { useStore, isEdict, stateLabel } from '../store';
import { formatRelativeTime, pickLocaleText, type Locale } from '../i18n';

function useAgentMaps(locale: Locale) {
  const cfg = useStore((s) => s.agentConfig);
  const emojiMap: Record<string, string> = {};
  const labelMap: Record<string, string> = {};
  if (cfg?.agents) {
    cfg.agents.forEach((a) => {
      emojiMap[a.id] = a.emoji || '🏛️';
      labelMap[a.id] = a.label || a.id;
    });
  }
  return { emojiMap, labelMap };
}

function extractAgent(t: Task): string {
  const m = (t.id || '').match(/^OC-(\w+)-/);
  if (m) return m[1];
  const sm = t.sourceMeta || {};
  if (typeof sm.agentId === 'string' && sm.agentId) return sm.agentId;
  return (t.org || '').replace(/省|部/g, '').toLowerCase();
}

function humanTitle(t: Task, labelMap: Record<string, string>, locale: Locale): string {
  const title = t.title || '';
  if (title === 'heartbeat 会话') return pickLocaleText(locale, '💓 心跳检测', '💓 Heartbeat Check');
  const m = title.match(/^agent:(\w+):(\w+)/);
  if (m) {
    const agLabel = labelMap[m[1]] || m[1];
    if (m[2] === 'subagent') return locale === 'en' ? `${agLabel} · Subtask Execution` : `${agLabel} · 子任务执行`;
    if (m[2] === 'cron') return locale === 'en' ? `${agLabel} · Scheduled Task` : `${agLabel} · 定时任务`;
    return `${agLabel} · ${m[2]}`;
  }
  if (locale === 'en') return title.replace(/ 会话$/, '').replace(/会话$/, '') || t.id;
  return title.replace(/ 会话$/, '') || t.id;
}

function cleanAssistantText(text: string): string {
  return (text || '')
    .replace(/^\s*NO_REPLY\b[:：\-\s]*/i, '')
    .replace(/\[\[.*?\]\]/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s/gm, '')
    .trim();
}

function replyPolicyLabel(policy: string | undefined, locale: Locale): string {
  switch (policy) {
    case 'no_reply':
      return pickLocaleText(locale, '禁止自动回复', 'No Auto Reply');
    case 'reply_current':
      return pickLocaleText(locale, '回复当前消息', 'Reply to Current Message');
    case 'reply_thread':
      return pickLocaleText(locale, '在线程内回复', 'Reply in Thread');
    case 'reply_root':
      return pickLocaleText(locale, '回复根消息', 'Reply to Root Message');
    case 'send':
    default:
      return pickLocaleText(locale, '普通发送', 'Direct Send');
  }
}

function replyTone(policy: string | undefined, locale: Locale): { text: string; color: string; border: string; bg: string } {
  switch (policy) {
    case 'no_reply':
      return { text: pickLocaleText(locale, '静默', 'Silent'), color: '#ff5270', border: '#ff527044', bg: '#200a10' };
    case 'reply_current':
    case 'reply_thread':
    case 'reply_root':
      return { text: pickLocaleText(locale, '回帖', 'Reply'), color: '#6a9eff', border: '#6a9eff44', bg: '#0a1428' };
    case 'send':
    default:
      return { text: pickLocaleText(locale, '发送', 'Send'), color: '#2ecc8a', border: '#2ecc8a44', bg: '#0a2018' };
  }
}

function channelLabel(t: Task, locale: Locale): { icon: string; text: string } {
  const sm = t.sourceMeta || {};
  const replyMeta = sm.replyMeta;
  const channel = String(replyMeta?.channel || sm.channel || sm.originChannel || t.now || '').toLowerCase();
  if (channel.includes('feishu/direct')) return { icon: '💬', text: pickLocaleText(locale, '飞书对话', 'Feishu Chat') };
  if (channel.includes('feishu') || channel.includes('lark')) return { icon: '💬', text: 'Feishu' };
  if (channel.includes('wecom')) return { icon: '📱', text: 'WeCom' };
  if (channel.includes('telegram')) return { icon: '✈️', text: 'Telegram' };
  if (channel.includes('discord')) return { icon: '🎮', text: 'Discord' };
  if (channel.includes('slack')) return { icon: '💬', text: 'Slack' };
  if (channel.includes('webchat')) return { icon: '🌐', text: 'WebChat' };
  if (channel.includes('cron')) return { icon: '⏰', text: pickLocaleText(locale, '定时', 'Scheduled') };
  if (channel.includes('direct')) return { icon: '📨', text: pickLocaleText(locale, '直连', 'Direct') };
  return { icon: '🔗', text: pickLocaleText(locale, '会话', 'Session') };
}

function lastMessage(t: Task): string {
  const acts = t.activity || [];
  for (let i = acts.length - 1; i >= 0; i--) {
    const a = acts[i];
    if (a.kind === 'assistant') {
      const txt = cleanAssistantText(a.text || '');
      if (!txt || txt.startsWith('Reasoning:')) continue;
      return txt.substring(0, 120) + (txt.length > 120 ? '…' : '');
    }
  }
  return '';
}

function formatReplyTargets(replyMeta?: ReplyMeta): string[] {
  if (!replyMeta) return [];
  const rows: string[] = [];
  if (replyMeta.targetMessageId) rows.push(`message_id: ${replyMeta.targetMessageId}`);
  if (replyMeta.threadId) rows.push(`thread_id: ${replyMeta.threadId}`);
  if (replyMeta.rootId) rows.push(`root_id: ${replyMeta.rootId}`);
  if (replyMeta.chatId) rows.push(`chat_id: ${replyMeta.chatId}`);
  return rows;
}

function replySummary(replyMeta: ReplyMeta | undefined, locale: Locale): string {
  if (!replyMeta) return '';
  const policy = replyPolicyLabel(replyMeta.effectivePolicy || replyMeta.policy, locale);
  const targets = formatReplyTargets(replyMeta);
  if (targets.length) return `${policy} · ${targets[0]}`;
  if (replyMeta.hasReplyContext) return `${policy} · ${pickLocaleText(locale, '已捕获回复上下文', 'Reply context captured')}`;
  return policy;
}

function formatTimeAgo(value: string, locale: Locale): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  const hours = Math.max(0, Math.floor(diffMs / 3600000));
  return formatRelativeTime(locale, minutes, hours);
}

function ReplyMetaSection({ sourceMeta, locale }: { sourceMeta?: SourceMeta; locale: Locale }) {
  const replyMeta = sourceMeta?.replyMeta;
  if (!replyMeta) return null;

  const policy = replyMeta.effectivePolicy || replyMeta.policy || 'send';
  const tone = replyTone(policy, locale);
  const targets = formatReplyTargets(replyMeta);
  const markers = replyMeta.markers || [];
  const sourcePaths = Object.entries(replyMeta.sourcePaths || {});

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>
        {pickLocaleText(locale, '💬 飞书回复上下文', '💬 Feishu Reply Context')}
      </div>
      <div
        style={{
          background: 'var(--panel2)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 999,
              color: tone.color,
              border: `1px solid ${tone.border}`,
              background: tone.bg,
            }}
          >
            {tone.text}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text)' }}>{replyPolicyLabel(policy, locale)}</span>
          {replyMeta.channel ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pickLocaleText(locale, '渠道：', 'Channel: ')}{replyMeta.channel}</span> : null}
          {replyMeta.fallbackMode && replyMeta.fallbackMode !== 'none' ? (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pickLocaleText(locale, '降级：', 'Fallback: ')}{replyMeta.fallbackMode}</span>
          ) : null}
          {replyMeta.transport ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{pickLocaleText(locale, '传输：', 'Transport: ')}{replyMeta.transport}</span> : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>
          <div style={{ background: 'var(--panel)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{pickLocaleText(locale, '回复策略', 'Reply Policy')}</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{replyPolicyLabel(replyMeta.policy, locale)}</div>
          </div>
          <div style={{ background: 'var(--panel)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{pickLocaleText(locale, '生效策略', 'Effective Policy')}</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{replyPolicyLabel(replyMeta.effectivePolicy || replyMeta.policy, locale)}</div>
          </div>
          <div style={{ background: 'var(--panel)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{pickLocaleText(locale, '上下文状态', 'Context Status')}</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              {replyMeta.hasReplyContext ? pickLocaleText(locale, '已捕获回复目标', 'Reply target captured') : pickLocaleText(locale, '未捕获回复目标', 'Reply target not captured')}
            </div>
          </div>
        </div>

        {targets.length ? (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{pickLocaleText(locale, '回复目标', 'Reply Targets')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {targets.map((item) => (
                <div key={item} style={{ fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all', background: 'var(--panel)', borderRadius: 8, padding: '8px 10px' }}>
                  {item}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {markers.length ? (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{pickLocaleText(locale, '意图标记', 'Intent Markers')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {markers.map((marker) => (
                <span key={marker} style={{ fontSize: 10, color: 'var(--acc)', border: '1px solid #6a9eff44', background: '#0a1228', borderRadius: 999, padding: '3px 8px' }}>
                  {marker}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {sourcePaths.length ? (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{pickLocaleText(locale, '字段来源', 'Field Sources')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sourcePaths.map(([key, value]) => (
                <div key={key} style={{ fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all', background: 'var(--panel)', borderRadius: 8, padding: '8px 10px' }}>
                  {key}: {value}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function SessionsPanel() {
  const locale = useStore((s) => s.locale);
  const liveStatus = useStore((s) => s.liveStatus);
  const sessFilter = useStore((s) => s.sessFilter);
  const setSessFilter = useStore((s) => s.setSessFilter);
  const { emojiMap, labelMap } = useAgentMaps(locale);
  const [detailTask, setDetailTask] = useState<Task | null>(null);

  const tasks = liveStatus?.tasks || [];
  const sessions = tasks.filter((t) => !isEdict(t));

  let filtered = sessions;
  if (sessFilter === 'active') filtered = sessions.filter((t) => !['Done', 'Cancelled'].includes(t.state));
  else if (sessFilter !== 'all') filtered = sessions.filter((t) => extractAgent(t) === sessFilter);

  const agentIds = [...new Set(sessions.map(extractAgent))];

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: locale === 'en' ? `All (${sessions.length})` : `全部 (${sessions.length})` },
          { key: 'active', label: pickLocaleText(locale, '活跃', 'Active') },
          ...agentIds.slice(0, 8).map((id) => ({ key: id, label: labelMap[id] || id })),
        ].map((f) => (
          <span
            key={f.key}
            className={`sess-filter${sessFilter === f.key ? ' active' : ''}`}
            onClick={() => setSessFilter(f.key)}
          >
            {f.label}
          </span>
        ))}
      </div>

      <div className="sess-grid">
        {!filtered.length ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', padding: 24, textAlign: 'center', gridColumn: '1/-1' }}>
            {pickLocaleText(locale, '暂无小任务/会话数据', 'No quick-task or session data yet')}
          </div>
        ) : (
          filtered.map((t) => {
            const agent = extractAgent(t);
            const emoji = emojiMap[agent] || '🏛️';
            const agLabel = labelMap[agent] || t.org || agent;
            const hb = t.heartbeat || { status: 'unknown' as const, label: '' };
            const ch = channelLabel(t, locale);
            const title = humanTitle(t, labelMap, locale);
            const msg = lastMessage(t);
            const sm = t.sourceMeta || {};
            const replyMeta = sm.replyMeta;
            const totalTk = sm.totalTokens;
            const updatedAt = t.eta || '';
            const hbDot = hb.status === 'active' ? '🟢' : hb.status === 'warn' ? '🟡' : hb.status === 'stalled' ? '🔴' : '⚪';
            const st = t.state || 'Unknown';
            const policy = replyMeta?.effectivePolicy || replyMeta?.policy;
            const tone = replyTone(policy, locale);
            const summary = replySummary(replyMeta, locale);

            return (
              <div className="sess-card" key={t.id} onClick={() => setDetailTask(t)}>
                <div className="sc-top">
                  <span className="sc-emoji">{emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="sc-agent">{agLabel}</span>
                      <span style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--panel2)', padding: '2px 6px', borderRadius: 4 }}>
                        {ch.icon} {ch.text}
                      </span>
                      {policy ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: tone.color,
                            background: tone.bg,
                            border: `1px solid ${tone.border}`,
                            padding: '2px 6px',
                            borderRadius: 999,
                          }}
                        >
                          {tone.text}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span title={hb.label || ''}>{hbDot}</span>
                    <span className={`tag st-${st}`} style={{ fontSize: 10 }}>{stateLabel(t, locale)}</span>
                  </div>
                </div>
                <div className="sc-title">{title}</div>
                {msg && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 8, borderLeft: '2px solid var(--line)', paddingLeft: 8, maxHeight: 40, overflow: 'hidden' }}>
                    {msg}
                  </div>
                )}
                {summary ? (
                  <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 8 }}>
                    💬 {summary}
                  </div>
                ) : null}
                <div className="sc-meta">
                  {totalTk ? <span style={{ fontSize: 10, color: 'var(--muted)' }}>🪙 {totalTk.toLocaleString()} tokens</span> : null}
                  {updatedAt ? <span className="sc-time">{formatTimeAgo(updatedAt, locale)}</span> : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {detailTask && (
        <SessionDetailModal task={detailTask} labelMap={labelMap} emojiMap={emojiMap} locale={locale} onClose={() => setDetailTask(null)} />
      )}
    </div>
  );
}

function SessionDetailModal({
  task: t,
  labelMap,
  emojiMap,
  locale,
  onClose,
}: {
  task: Task;
  labelMap: Record<string, string>;
  emojiMap: Record<string, string>;
  locale: Locale;
  onClose: () => void;
}) {
  const agent = extractAgent(t);
  const agLabel = labelMap[agent] || t.org || agent;
  const emoji = emojiMap[agent] || '🏛️';
  const title = humanTitle(t, labelMap, locale);
  const ch = channelLabel(t, locale);
  const hb = t.heartbeat || { status: 'unknown' as const, label: '' };
  const sm = t.sourceMeta || {};
  const acts = t.activity || [];
  const st = t.state || 'Unknown';

  const totalTokens = sm.totalTokens;
  const inputTokens = sm.inputTokens;
  const outputTokens = sm.outputTokens;

  return (
    <div className="modal-bg open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-body">
          <div style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 700, letterSpacing: '.04em', marginBottom: 4 }}>{t.id}</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>{emoji} {title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            <span className={`tag st-${st}`}>{stateLabel(t, locale)}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{ch.icon} {ch.text}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{agLabel}</span>
            {hb.label && <span style={{ fontSize: 11 }}>{hb.label}</span>}
          </div>

          <div style={{ display: 'flex', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
            {totalTokens != null && (
              <div style={{ background: 'var(--panel2)', padding: '10px 16px', borderRadius: 8, fontSize: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--acc)' }}>{totalTokens.toLocaleString()}</div>
                <div style={{ color: 'var(--muted)', fontSize: 10 }}>{pickLocaleText(locale, '总 Tokens', 'Total Tokens')}</div>
              </div>
            )}
            {inputTokens != null && (
              <div style={{ background: 'var(--panel2)', padding: '10px 16px', borderRadius: 8, fontSize: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{inputTokens.toLocaleString()}</div>
                <div style={{ color: 'var(--muted)', fontSize: 10 }}>{pickLocaleText(locale, '输入', 'Input')}</div>
              </div>
            )}
            {outputTokens != null && (
              <div style={{ background: 'var(--panel2)', padding: '10px 16px', borderRadius: 8, fontSize: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{outputTokens.toLocaleString()}</div>
                <div style={{ color: 'var(--muted)', fontSize: 10 }}>{pickLocaleText(locale, '输出', 'Output')}</div>
              </div>
            )}
          </div>

          <ReplyMetaSection sourceMeta={sm} locale={locale} />

          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
            {locale === 'en' ? `📋 Recent Activity (${acts.length})` : `📋 最近活动 (${acts.length} 条)`}
          </div>
          <div style={{ maxHeight: 350, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel2)' }}>
            {!acts.length ? (
              <div style={{ padding: 16, color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>{pickLocaleText(locale, '暂无活动记录', 'No activity records yet')}</div>
            ) : (
              acts.slice(-15).reverse().map((a, i) => {
                const kind = a.kind || '';
                const kIcon = kind === 'assistant' ? '🤖' : kind === 'tool' ? '🔧' : kind === 'user' ? '👤' : '📝';
                const kLabel = kind === 'assistant'
                  ? pickLocaleText(locale, '回复', 'Assistant')
                  : kind === 'tool'
                    ? pickLocaleText(locale, '工具', 'Tool')
                    : kind === 'user'
                      ? pickLocaleText(locale, '用户', 'User')
                      : pickLocaleText(locale, '事件', 'Event');
                let txt = cleanAssistantText(a.text || '');
                if (txt.length > 200) txt = `${txt.substring(0, 200)}…`;
                const time = String(a.at || '').substring(11, 19);
                return (
                  <div key={i} style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', fontSize: 12, lineHeight: 1.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span>{kIcon}</span>
                      <span style={{ fontWeight: 600, fontSize: 11 }}>{kLabel}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 10, marginLeft: 'auto' }}>{time}</span>
                    </div>
                    <div style={{ color: 'var(--muted)' }}>{txt}</div>
                  </div>
                );
              })
            )}
          </div>

          {t.output && t.output !== '-' && (
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 12, wordBreak: 'break-all', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              📂 {t.output}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
