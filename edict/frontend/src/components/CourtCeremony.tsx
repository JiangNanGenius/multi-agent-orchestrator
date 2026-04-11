import { useEffect, useState } from 'react';
import { useStore, isEdict } from '../store';
import { pickLocaleText } from '../i18n';

export default function StartupTransition() {
  const locale = useStore((s) => s.locale);
  const liveStatus = useStore((s) => s.liveStatus);
  const [show, setShow] = useState(false);
  const [out, setOut] = useState(false);

  if (import.meta.env.DEV) return null;

  useEffect(() => {
    const lastOpen = localStorage.getItem('openclaw_startup_transition_date');
    const today = new Date().toISOString().substring(0, 10);
    const pref = JSON.parse(localStorage.getItem('openclaw_startup_transition_pref') || '{"enabled":true}');
    if (!pref.enabled || lastOpen === today) return;
    localStorage.setItem('openclaw_startup_transition_date', today);
    setShow(true);
    const timer = setTimeout(() => skip(), 3500);
    return () => clearTimeout(timer);
  }, []);

  const skip = () => {
    setOut(true);
    setTimeout(() => setShow(false), 500);
  };

  if (!show) return null;

  const tasks = liveStatus?.tasks || [];
  const jjc = tasks.filter(isEdict);
  const pending = jjc.filter((t) => !['Done', 'Cancelled'].includes(t.state)).length;
  const done = jjc.filter((t) => t.state === 'Done').length;
  const overdue = jjc.filter(
    (t) => t.state !== 'Done' && t.state !== 'Cancelled' && t.eta && new Date(t.eta.replace(' ', 'T')) < new Date(),
  ).length;

  const d = new Date();
  const daysZh = ['日', '一', '二', '三', '四', '五', '六'];
  const daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dateStr = locale === 'en'
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} · ${daysEn[d.getDay()]}`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${daysZh[d.getDay()]}曜日`;

  const summary = locale === 'en'
    ? `Pending ${pending} · Completed ${done}${overdue > 0 ? ` · ⚠ Overdue ${overdue}` : ''}`
    : `待办 ${pending} 件 · 已完成 ${done} 件${overdue > 0 ? ` · ⚠ 超期 ${overdue} 件` : ''}`;

  return (
    <div className={`startup-overlay${out ? ' out' : ''}`} onClick={skip}>
      <div className="crm-glow" />
      <div className="crm-line1 in">{pickLocaleText(locale, '协作平台已就绪', 'Collaboration platform is ready')}</div>
      <div className="crm-line2 in">{pickLocaleText(locale, '任务与执行角色已同步，可以开始今日协作', 'Tasks and execution roles are synchronized. Today’s collaboration is ready to begin')}</div>
      <div className="crm-line3 in">{summary}</div>
      <div className="crm-date in">{dateStr}</div>
      <div className="crm-skip">{pickLocaleText(locale, '点击任意处跳过', 'Click anywhere to skip')}</div>
    </div>
  );
}
