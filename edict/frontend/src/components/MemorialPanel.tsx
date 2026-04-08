import { useState } from 'react';
import { useStore, isEdict, normalizeDeptLabel, normalizeFlowRemark, stateLabel, deptMeta, normalizeAgentId } from '../store';
import type { Task, FlowEntry } from '../api';
import { pickLocaleText, type Locale } from '../i18n';

function flowCountText(locale: Locale, count: number): string {
  return locale === 'en' ? `${count} step${count === 1 ? '' : 's'}` : `流转 ${count} 步`;
}

function phaseTitle(locale: Locale, key: 'origin' | 'plan' | 'review' | 'exec' | 'result'): string {
  const map = {
    origin: pickLocaleText(locale, '任务提交与受理', 'Task Intake & Acceptance'),
    plan: pickLocaleText(locale, '规划拆解', 'Planning Breakdown'),
    review: pickLocaleText(locale, '评审核验', 'Review & Validation'),
    exec: pickLocaleText(locale, '专业执行阶段', 'Execution Stage'),
    result: pickLocaleText(locale, '汇总交付', 'Delivery & Wrap-up'),
  };
  return map[key];
}

const ARCHIVE_HIDDEN_AGENT_IDS = new Set(['control_center']);
const PLAN_PHASE_AGENT_IDS = new Set(['plan_center']);
const REVIEW_PHASE_AGENT_IDS = new Set(['review_center']);

function isArchiveHiddenLabel(label: string): boolean {
  const normalized = normalizeAgentId(label);
  return ARCHIVE_HIDDEN_AGENT_IDS.has(normalized) || label === '任务发起人' || label === '任务入口';
}

function isPlanPhaseLabel(label: string): boolean {
  return PLAN_PHASE_AGENT_IDS.has(normalizeAgentId(label));
}

function isReviewPhaseLabel(label: string): boolean {
  return REVIEW_PHASE_AGENT_IDS.has(normalizeAgentId(label));
}

function taskOwnerLabel(org: string, locale: Locale): string {
  if (!org) return org;
  const meta = deptMeta(org, locale);
  return meta.label || normalizeDeptLabel(org);
}

export default function ArchivePanel() {
  const locale = useStore((s) => s.locale);
  const liveStatus = useStore((s) => s.liveStatus);
  const [filter, setFilter] = useState('all');
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const toast = useStore((s) => s.toast);

  const tasks = liveStatus?.tasks || [];
  let archivedTasks = tasks.filter((t) => isEdict(t) && ['Done', 'Cancelled'].includes(t.state));
  if (filter !== 'all') archivedTasks = archivedTasks.filter((t) => t.state === filter);

  const exportMemorial = (t: Task) => {
    const fl = t.flow_log || [];
    const title = t.title || t.id || pickLocaleText(locale, '(无标题)', '(Untitled)');
    let md = locale === 'en' ? `# 📦 Result Archive · ${title}\n\n` : `# 📦 结果归档 · ${title}\n\n`;
    md += locale === 'en' ? `- **Task ID**: ${t.id}\n` : `- **任务编号**: ${t.id}\n`;
    md += locale === 'en' ? `- **Status**: ${stateLabel(t, locale)}\n` : `- **状态**: ${stateLabel(t, locale)}\n`;
      md += locale === 'en'
      ? `- **Owner Team**: ${taskOwnerLabel(t.org || '', locale)}\n`
      : `- **负责团队**: ${taskOwnerLabel(t.org || '', locale)}\n`;

    if (fl.length) {
      const startAt = fl[0].at ? fl[0].at.substring(0, 19).replace('T', ' ') : pickLocaleText(locale, '未知', 'Unknown');
      const endAt = fl[fl.length - 1].at ? fl[fl.length - 1].at.substring(0, 19).replace('T', ' ') : pickLocaleText(locale, '未知', 'Unknown');
      md += locale === 'en' ? `- **Started At**: ${startAt}\n` : `- **开始时间**: ${startAt}\n`;
      md += locale === 'en' ? `- **Completed At**: ${endAt}\n` : `- **完成时间**: ${endAt}\n`;
    }
    md += locale === 'en' ? `\n## Workflow Log\n\n` : `\n## 流转记录\n\n`;
    for (const f of fl) {
      md += `- **${taskOwnerLabel(f.from || '', locale)}** → **${taskOwnerLabel(f.to || '', locale)}**  \n  ${normalizeFlowRemark(f.remark || '')}  \n  _${(f.at || '').substring(0, 19)}_\n\n`;
    }
    if (t.output && t.output !== '-') {
      md += locale === 'en' ? `## Output Artifact\n\n\`${t.output}\`\n` : `## 产出物\n\n\`${t.output}\`\n`;
    }
    navigator.clipboard.writeText(md).then(
      () => toast(pickLocaleText(locale, '✅ 结果归档已复制为 Markdown', '✅ Result archive copied as Markdown'), 'ok'),
      () => toast(pickLocaleText(locale, '复制失败', 'Copy failed'), 'err')
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '筛选：', 'Filter:')}</span>
        {[
          { key: 'all', label: pickLocaleText(locale, '全部', 'All') },
          { key: 'Done', label: pickLocaleText(locale, '✅ 已完成', '✅ Completed') },
          { key: 'Cancelled', label: pickLocaleText(locale, '🚫 已取消', '🚫 Cancelled') },
        ].map((f) => (
          <span
            key={f.key}
            className={`sess-filter${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </span>
        ))}
      </div>

      <div className="mem-list">
        {!archivedTasks.length ? (
          <div className="mem-empty">{pickLocaleText(locale, '暂无归档结果 — 任务完成后可在此查看归档记录', 'No archived results yet — completed tasks will appear here')}</div>
        ) : (
          archivedTasks.map((t) => {
            const fl = t.flow_log || [];
            const depts = [...new Set(fl.map((f) => f.from).concat(fl.map((f) => f.to)).map((x) => normalizeDeptLabel(x || '')).filter((x) => x && !isArchiveHiddenLabel(x)))];
            const firstAt = fl.length ? (fl[0].at || '').substring(0, 16).replace('T', ' ') : '';
            const lastAt = fl.length ? (fl[fl.length - 1].at || '').substring(0, 16).replace('T', ' ') : '';
            const stIcon = t.state === 'Done' ? '✅' : '🚫';
            return (
              <div className="mem-card" key={t.id} onClick={() => setDetailTask(t)}>
                <div className="mem-icon">📜</div>
                <div className="mem-info">
                  <div className="mem-title">
                    {stIcon} {t.title || t.id}
                  </div>
                  <div className="mem-sub">
                    {t.id} · {taskOwnerLabel(t.org || '', locale)} · {flowCountText(locale, fl.length)}
                  </div>
                  <div className="mem-tags">
                    {depts.slice(0, 5).map((d) => (
                      <span className="mem-tag" key={d}>{taskOwnerLabel(d, locale)}</span>
                    ))}
                  </div>
                </div>
                <div className="mem-right">
                  <span className="mem-date">{firstAt}</span>
                  {lastAt !== firstAt && <span className="mem-date">{lastAt}</span>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {detailTask && (
        <ArchiveDetailModal task={detailTask} locale={locale} onClose={() => setDetailTask(null)} onExport={exportMemorial} />
      )}
    </div>
  );
}

function ArchiveDetailModal({
  task: t,
  locale,
  onClose,
  onExport,
}: {
  task: Task;
  locale: Locale;
  onClose: () => void;
  onExport: (t: Task) => void;
}) {
  const fl = t.flow_log || [];
  const st = t.state || 'Unknown';
  const stIcon = st === 'Done' ? '✅' : st === 'Cancelled' ? '🚫' : '🔄';
  const depts = [...new Set(fl.map((f) => f.from).concat(fl.map((f) => f.to)).map((x) => normalizeDeptLabel(x || '')).filter((x) => x && !isArchiveHiddenLabel(x)))];

  const originLog: FlowEntry[] = [];
  const planLog: FlowEntry[] = [];
  const reviewLog: FlowEntry[] = [];
  const execLog: FlowEntry[] = [];
  const resultLog: FlowEntry[] = [];
  for (const f of fl) {
    const fromLabel = normalizeDeptLabel(f.from || '');
    const toLabel = normalizeDeptLabel(f.to || '');
    const remark = normalizeFlowRemark(f.remark || '');
    if (isArchiveHiddenLabel(fromLabel)) originLog.push(f);
    else if (isPlanPhaseLabel(fromLabel) || isPlanPhaseLabel(toLabel)) planLog.push(f);
    else if (isReviewPhaseLabel(fromLabel) || isReviewPhaseLabel(toLabel)) reviewLog.push(f);
    else if (remark.includes('完成') || remark.includes('结果归档') || remark.includes('Result archive') || remark.includes('交付') || remark.includes('归档')) resultLog.push(f);
    else execLog.push(f);
  }

  const renderPhase = (title: string, icon: string, items: FlowEntry[]) => {
    if (!items.length) return null;
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          {icon} {title}
        </div>
        <div className="md-timeline">
          {items.map((f, i) => {
            const dotCls = f.remark?.includes('✅') ? 'green' : (f.remark?.includes('驳') || f.remark?.includes('退回')) ? 'red' : '';
            return (
              <div className="md-tl-item" key={i}>
                <div className={`md-tl-dot ${dotCls}`} />
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span className="md-tl-from">{taskOwnerLabel(f.from || '', locale)}</span>
                  <span className="md-tl-to">→ {taskOwnerLabel(f.to || '', locale)}</span>
                </div>
                <div className="md-tl-remark">{normalizeFlowRemark(f.remark || '')}</div>
                <div className="md-tl-time">{(f.at || '').substring(0, 19).replace('T', ' ')}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="modal-bg open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-body">
          <div style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 700, letterSpacing: '.04em', marginBottom: 4 }}>{t.id}</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>{stIcon} {t.title || t.id}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            <span className={`tag st-${st}`}>{stateLabel(t, locale)}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{taskOwnerLabel(t.org || '', locale)}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{flowCountText(locale, fl.length)}</span>
            {depts.map((d) => (
              <span className="mem-tag" key={d}>{d}</span>
            ))}
          </div>

          {t.now && (
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: 12, color: 'var(--muted)' }}>
              {t.now}
            </div>
          )}

          {renderPhase(phaseTitle(locale, 'origin'), '👤', originLog)}
          {renderPhase(phaseTitle(locale, 'plan'), '📋', planLog)}
          {renderPhase(phaseTitle(locale, 'review'), '🔍', reviewLog)}
          {renderPhase(phaseTitle(locale, 'exec'), '⚙️', execLog)}
          {renderPhase(phaseTitle(locale, 'result'), '📨', resultLog)}

          {t.output && t.output !== '-' && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{pickLocaleText(locale, '📦 产出物', '📦 Output Artifact')}</div>
              <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{t.output}</code>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn btn-g" onClick={() => onExport(t)} style={{ fontSize: 12, padding: '6px 16px' }}>
              {pickLocaleText(locale, '📋 复制归档摘要', '📋 Copy Archive Summary')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
