import { useState } from 'react';
import { useStore, isEdict, STATE_LABEL, normalizeDeptLabel, normalizeFlowRemark } from '../store';
import type { Task, FlowEntry } from '../api';

export default function MemorialPanel() {
  const liveStatus = useStore((s) => s.liveStatus);
  const [filter, setFilter] = useState('all');
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const toast = useStore((s) => s.toast);

  const tasks = liveStatus?.tasks || [];
  let mems = tasks.filter((t) => isEdict(t) && ['Done', 'Cancelled'].includes(t.state));
  if (filter !== 'all') mems = mems.filter((t) => t.state === filter);

  const exportMemorial = (t: Task) => {
    const fl = t.flow_log || [];
    let md = `# 📦 结果报告 · ${t.title}\n\n`;
    md += `- **任务编号**: ${t.id}\n`;
    md += `- **状态**: ${t.state}\n`;
    md += `- **负责部门**: ${normalizeDeptLabel(t.org || '')}\n`;
    if (fl.length) {
      const startAt = fl[0].at ? fl[0].at.substring(0, 19).replace('T', ' ') : '未知';
      const endAt = fl[fl.length - 1].at ? fl[fl.length - 1].at.substring(0, 19).replace('T', ' ') : '未知';
      md += `- **开始时间**: ${startAt}\n`;
      md += `- **完成时间**: ${endAt}\n`;
    }
    md += `\n## 流转记录\n\n`;
    for (const f of fl) {
      md += `- **${normalizeDeptLabel(f.from || '')}** → **${normalizeDeptLabel(f.to || '')}**  \n  ${normalizeFlowRemark(f.remark || '')}  \n  _${(f.at || '').substring(0, 19)}_\n\n`;
    }
    if (t.output && t.output !== '-') md += `## 产出物\n\n\`${t.output}\`\n`;
    navigator.clipboard.writeText(md).then(
      () => toast('✅ 结果报告已复制为 Markdown', 'ok'),
      () => toast('复制失败', 'err')
    );
  };

  return (
    <div>
      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>筛选：</span>
        {[
          { key: 'all', label: '全部' },
          { key: 'Done', label: '✅ 已完成' },
          { key: 'Cancelled', label: '🚫 已取消' },
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

      {/* List */}
      <div className="mem-list">
        {!mems.length ? (
          <div className="mem-empty">暂无结果报告 — 任务完成后自动生成</div>
        ) : (
          mems.map((t) => {
            const fl = t.flow_log || [];
            const hiddenLabels = new Set(['任务发起人', '总控中心', '任务入口']);
            const depts = [...new Set(fl.map((f) => f.from).concat(fl.map((f) => f.to)).map((x) => normalizeDeptLabel(x || '')).filter((x) => x && !hiddenLabels.has(x)))];
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
                    {t.id} · {t.org || ''} · 流转 {fl.length} 步
                  </div>
                  <div className="mem-tags">
                    {depts.slice(0, 5).map((d) => (
                      <span className="mem-tag" key={d}>{normalizeDeptLabel(d)}</span>
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

      {/* Detail Modal */}
      {detailTask && (
        <MemorialDetailModal task={detailTask} onClose={() => setDetailTask(null)} onExport={exportMemorial} />
      )}
    </div>
  );
}

function MemorialDetailModal({
  task: t,
  onClose,
  onExport,
}: {
  task: Task;
  onClose: () => void;
  onExport: (t: Task) => void;
}) {
  const fl = t.flow_log || [];
  const st = t.state || 'Unknown';
  const stIcon = st === 'Done' ? '✅' : st === 'Cancelled' ? '🚫' : '🔄';
  const hiddenLabels = new Set(['任务发起人', '总控中心', '任务入口']);
  const depts = [...new Set(fl.map((f) => f.from).concat(fl.map((f) => f.to)).map((x) => normalizeDeptLabel(x || '')).filter((x) => x && !hiddenLabels.has(x)))];
  const planLabels = new Set(['规划中心']);
  const reviewLabels = new Set(['评审中心']);

  // Reconstruct phases
  const originLog: FlowEntry[] = [];
  const planLog: FlowEntry[] = [];
  const reviewLog: FlowEntry[] = [];
  const execLog: FlowEntry[] = [];
  const resultLog: FlowEntry[] = [];
  for (const f of fl) {
    const fromLabel = normalizeDeptLabel(f.from || '');
    const toLabel = normalizeDeptLabel(f.to || '');
    const remark = normalizeFlowRemark(f.remark || '');
    if (hiddenLabels.has(fromLabel)) originLog.push(f);
    else if (planLabels.has(fromLabel) || planLabels.has(toLabel)) planLog.push(f);
    else if (reviewLabels.has(fromLabel) || reviewLabels.has(toLabel)) reviewLog.push(f);
    else if (remark.includes('完成') || remark.includes('结果报告') || remark.includes('交付')) resultLog.push(f);
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
                  <span className="md-tl-from">{normalizeDeptLabel(f.from || '')}</span>
                  <span className="md-tl-to">→ {normalizeDeptLabel(f.to || '')}</span>
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
            <span className={`tag st-${st}`}>{STATE_LABEL[st] || st}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{normalizeDeptLabel(t.org || '')}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>流转 {fl.length} 步</span>
            {depts.map((d) => (
              <span className="mem-tag" key={d}>{d}</span>
            ))}
          </div>

          {t.now && (
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: 12, color: 'var(--muted)' }}>
              {t.now}
            </div>
          )}

          {renderPhase('任务提交与受理', '👤', originLog)}
          {renderPhase('规划拆解', '📋', planLog)}
          {renderPhase('评审核验', '🔍', reviewLog)}
          {renderPhase('专业执行阶段', '⚙️', execLog)}
          {renderPhase('汇总交付', '📨', resultLog)}

          {t.output && t.output !== '-' && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>📦 产出物</div>
              <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{t.output}</code>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn btn-g" onClick={() => onExport(t)} style={{ fontSize: 12, padding: '6px 16px' }}>
              📋 复制结果报告
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
