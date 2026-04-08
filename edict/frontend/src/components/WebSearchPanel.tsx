import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { api, type CollabAgentBusyEntry, type SearchResultItem, type SubConfig } from '../api';
import { pickLocaleText, formatCount, type Locale } from '../i18n';
import { DEPTS, deptMeta, normalizeAgentId, useStore } from '../store';

type ResultWithMeta = SearchResultItem & {
  category: string;
  score: number;
  kwHits: number;
};

const CAT_META: Record<string, { icon: string; color: string; descZh: string; descEn: string }> = {
  政治: { icon: '🏛️', color: '#6a9eff', descZh: '追踪全球政策、地缘关系与公共议题变化', descEn: 'Track policy, geopolitics, and public affairs updates' },
  军事: { icon: '🛰️', color: '#ff6b81', descZh: '关注军事动态、冲突态势与安全风险', descEn: 'Monitor military updates, conflicts, and security risks' },
  经济: { icon: '📈', color: '#2ecc8a', descZh: '覆盖市场、企业、资本与宏观经济信号', descEn: 'Cover markets, companies, capital, and macro signals' },
  AI大模型: { icon: '🧠', color: '#a07aff', descZh: '聚焦模型发布、应用落地与 AI 产业趋势', descEn: 'Focus on model launches, adoption, and AI industry trends' },
};

const DEFAULT_CATS = ['政治', '军事', '经济', 'AI大模型'];
const SEARCH_OWNER_ZH = 'AI 搜索引擎';
const SEARCH_OWNER_EN = 'AI Search Engine';
const EXECUTION_TARGET_IDS = new Set([
  'docs_specialist',
  'data_specialist',
  'code_specialist',
  'audit_specialist',
  'deploy_specialist',
  'admin_specialist',
  'expert_curator',
  'search_specialist',
]);

function getCategoryLabel(locale: Locale, cat: string) {
  const labels: Record<string, string> = {
    政治: 'Politics',
    军事: 'Security',
    经济: 'Economy',
    AI大模型: 'AI Models',
  };
  return locale === 'en' ? labels[cat] || cat : cat;
}

function formatBriefDate(locale: Locale, raw?: string) {
  if (!raw) return '';
  if (locale === 'en') return raw.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  return raw.replace(/(\d{4})(\d{2})(\d{2})/, '$1年$2月$3日');
}

function normalizeText(value?: string) {
  return (value || '').toLowerCase().trim();
}

function hostnameOf(link?: string) {
  if (!link) return '';
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function renderBusyStateLabel(entry: CollabAgentBusyEntry, locale: Locale): string {
  const source = entry.occupancy_kind || entry.source_type || '';
  if (locale === 'en') {
    if (source === 'task_active') return 'Handling a task';
    if (source === 'task_reserved') return 'Reserved for a task';
    if (source === 'task_paused') return 'Task paused';
    if (source === 'task_blocked') return 'Task blocked';
    if (source === 'meeting') return 'In meeting';
    if (source === 'chat') return 'In discussion';
    return entry.label || 'Busy';
  }
  if (source === 'task_active') return '任务执行中';
  if (source === 'task_reserved') return '任务预占中';
  if (source === 'task_paused') return '任务暂停中';
  if (source === 'task_blocked') return '任务阻塞中';
  if (source === 'meeting') return '会议占用中';
  if (source === 'chat') return '讨论占用中';
  return entry.label || '忙碌中';
}

function buildSearchTaskTitle(locale: Locale, query: string) {
  return locale === 'en' ? `AI Search: ${query}` : `AI 搜索：${query}`;
}

export default function WebSearchPanel() {
  const locale = useStore((s) => s.locale);
  const searchBrief = useStore((s) => s.searchBrief);
  const subConfig = useStore((s) => s.subConfig);
  const collabAgentBusyData = useStore((s) => s.collabAgentBusyData);
  const loadWebSearch = useStore((s) => s.loadWebSearch);
  const loadSubConfig = useStore((s) => s.loadSubConfig);
  const loadCollabBusy = useStore((s) => s.loadCollabBusy);
  const toast = useStore((s) => s.toast);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localConfig, setLocalConfig] = useState<SubConfig | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLabel, setRefreshLabel] = useState(pickLocaleText(locale, '更新索引', 'Refresh Index'));
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [manualTargets, setManualTargets] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [submittingTask, setSubmittingTask] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadWebSearch();
    loadCollabBusy();
  }, [loadWebSearch, loadCollabBusy]);

  useEffect(() => {
    if (subConfig) setLocalConfig(JSON.parse(JSON.stringify(subConfig)));
  }, [subConfig]);

  useEffect(() => {
    setRefreshLabel(
      refreshing
        ? pickLocaleText(locale, '更新中…', 'Refreshing...')
        : pickLocaleText(locale, '更新索引', 'Refresh Index')
    );
  }, [locale, refreshing]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const refreshSearchResults = async () => {
    setRefreshing(true);
    setRefreshLabel(pickLocaleText(locale, '更新中…', 'Refreshing...'));
    const lastDate = searchBrief?.generated_at || null;
    try {
      await api.refreshSearch();
      toast(
        pickLocaleText(locale, '已触发搜索索引更新，系统正在等待新结果…', 'Search index refresh started. Waiting for new results...'),
        'ok'
      );
      let count = 0;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        count += 1;
        if (count > 24) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setRefreshing(false);
          setRefreshLabel(pickLocaleText(locale, '更新索引', 'Refresh Index'));
          toast(pickLocaleText(locale, '更新超时，请稍后重试', 'Refresh timed out. Please try again later'), 'err');
          return;
        }
        try {
          const fresh = await api.searchBrief();
          if (fresh.generated_at && fresh.generated_at !== lastDate) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setRefreshing(false);
            setRefreshLabel(pickLocaleText(locale, '更新索引', 'Refresh Index'));
            loadWebSearch();
            loadCollabBusy();
            toast(pickLocaleText(locale, 'AI 搜索结果已更新', 'AI search results are updated'), 'ok');
          } else {
            setRefreshLabel(locale === 'en' ? `Refreshing... (${count * 5}s)` : `更新中… (${count * 5}s)`);
          }
        } catch {
          /* ignore */
        }
      }, 5000);
    } catch {
      toast(pickLocaleText(locale, '触发搜索更新失败', 'Failed to refresh search results'), 'err');
      setRefreshing(false);
      setRefreshLabel(pickLocaleText(locale, '更新索引', 'Refresh Index'));
    }
  };

  const toggleCat = (name: string) => {
    if (!localConfig) return;
    const cats = [...(localConfig.categories || [])];
    const existing = cats.find((c) => c.name === name);
    if (existing) existing.enabled = !existing.enabled;
    else cats.push({ name, enabled: true });
    setLocalConfig({ ...localConfig, categories: cats });
  };

  const addKeyword = (kw: string) => {
    if (!localConfig || !kw) return;
    const kws = [...(localConfig.keywords || [])];
    if (!kws.includes(kw)) kws.push(kw);
    setLocalConfig({ ...localConfig, keywords: kws });
  };

  const removeKeyword = (i: number) => {
    if (!localConfig) return;
    const kws = [...(localConfig.keywords || [])];
    kws.splice(i, 1);
    setLocalConfig({ ...localConfig, keywords: kws });
  };

  const saveConfig = async () => {
    if (!localConfig) return;
    try {
      const r = await api.saveSearchConfig(localConfig);
      if (r.ok) {
        toast(pickLocaleText(locale, '搜索设置已保存', 'Search settings saved'), 'ok');
        loadSubConfig();
        loadWebSearch();
      } else {
        toast(r.error || pickLocaleText(locale, '保存失败', 'Failed to save settings'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    }
  };

  const toggleTarget = (targetId: string) => {
    setSelectedTargets((prev) => (
      prev.includes(targetId) ? prev.filter((item) => item !== targetId) : [...prev, targetId]
    ));
    setManualTargets(true);
  };

  const submitSearchTask = async () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      toast(pickLocaleText(locale, '请先输入要搜索的问题或线索', 'Please enter a search question or lead first'), 'err');
      return;
    }
    if (manualTargets && !selectedTargets.length) {
      toast(pickLocaleText(locale, '请至少选择一位目标专家，或切回自动分配', 'Select at least one target specialist, or switch back to auto assign'), 'err');
      return;
    }

    setSubmittingTask(true);
    try {
      const payload = {
        title: buildSearchTaskTitle(locale, trimmedQuery),
        org: pickLocaleText(locale, '调度中心', 'Dispatch Center'),
        owner: pickLocaleText(locale, SEARCH_OWNER_ZH, SEARCH_OWNER_EN),
        priority: 'low',
        templateId: 'web_search',
        params: {
          query: trimmedQuery,
          category: activeCategory === 'all' ? '' : activeCategory,
          keywords: (localConfig?.keywords || []).join('、'),
        },
        ...(manualTargets && selectedTargets.length
          ? {
              targetDept: selectedTargets[0],
              targetDepts: selectedTargets,
            }
          : {}),
      };
      const result = await api.createTask(payload);
      if (!result.ok) {
        toast(result.error || pickLocaleText(locale, '搜索任务创建失败', 'Failed to create search task'), 'err');
        return;
      }
      toast(
        result.message || pickLocaleText(locale, `已创建低优先级搜索任务 ${result.taskId || ''}`.trim(), `Low-priority search task created ${result.taskId || ''}`.trim()),
        'ok'
      );
      loadCollabBusy();
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
    } finally {
      setSubmittingTask(false);
    }
  };

  const enabledSet = localConfig
    ? new Set((localConfig.categories || []).filter((c) => c.enabled).map((c) => c.name))
    : new Set(DEFAULT_CATS);

  const userKeywords = localConfig?.keywords || [];
  const loweredKeywords = userKeywords.map((k) => k.toLowerCase());
  const dateStr = formatBriefDate(locale, searchBrief?.date);
  const categories = searchBrief?.categories || {};

  const flatResults = useMemo<ResultWithMeta[]>(() => {
    return Object.entries(categories).flatMap(([category, items]) => {
      if (!enabledSet.has(category)) return [];
      return (items || []).map((item, idx) => {
        const text = normalizeText(`${item.title || ''} ${item.summary || ''} ${item.desc || ''} ${item.source || ''}`);
        const kwHits = loweredKeywords.filter((kw) => text.includes(kw)).length;
        const queryHit = query ? (text.includes(normalizeText(query)) ? 1 : 0) : 0;
        return {
          ...item,
          category,
          kwHits,
          score: kwHits * 10 + queryHit * 8 + Math.max(0, 5 - idx),
        };
      });
    });
  }, [categories, enabledSet, loweredKeywords, query]);

  const filteredResults = useMemo(() => {
    const q = normalizeText(query);
    return flatResults
      .filter((item) => {
        const matchesCategory = activeCategory === 'all' || item.category === activeCategory;
        if (!matchesCategory) return false;
        if (!q) return true;
        const haystack = normalizeText(`${item.title} ${item.summary || ''} ${item.desc || ''} ${item.source || ''}`);
        return haystack.includes(q);
      })
      .sort((a, b) => b.score - a.score);
  }, [activeCategory, flatResults, query]);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    filteredResults.forEach((item) => {
      map.set(item.category, (map.get(item.category) || 0) + 1);
    });
    return map;
  }, [filteredResults]);

  const topSources = useMemo(() => {
    const counts = new Map<string, number>();
    filteredResults.forEach((item) => {
      const key = item.source || hostnameOf(item.link) || 'Unknown';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [filteredResults]);

  const suggestionChips = useMemo(() => {
    return uniqueStrings([
      ...userKeywords,
      ...Object.keys(categories),
      ...flatResults.slice(0, 6).map((item) => item.title).filter(Boolean),
    ]).slice(0, 8);
  }, [userKeywords, categories, flatResults]);

  const featured = filteredResults.slice(0, 3);
  const totalResults = filteredResults.length;
  const focusMatches = filteredResults.filter((item) => item.kwHits > 0).length;
  const sourceCount = uniqueStrings(filteredResults.map((item) => item.source || hostnameOf(item.link))).length;

  const searchSpecialistEntries = useMemo(
    () => (collabAgentBusyData?.busy || []).filter((entry) => normalizeAgentId(entry.agent_id) === 'search_specialist'),
    [collabAgentBusyData],
  );
  const searchSpecialistBusy = searchSpecialistEntries[0] || null;
  const searchSpecialistMeta = deptMeta('search_specialist', locale);
  const targetOptions = useMemo(
    () => DEPTS.filter((dept) => EXECUTION_TARGET_IDS.has(dept.id)),
    [],
  );

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div
        style={{
          padding: 20,
          borderRadius: 20,
          border: '1px solid var(--line)',
          background: 'linear-gradient(135deg, rgba(68,110,255,0.14), rgba(58,208,182,0.08) 50%, rgba(160,122,255,0.12))',
          boxShadow: '0 18px 50px rgba(0,0,0,0.16)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 760 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
              {pickLocaleText(locale, 'AI 搜索引擎', 'AI Search Engine')}
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.2, marginBottom: 10 }}>
              {pickLocaleText(locale, '从全网信号里直接定位你要的答案与线索', 'Find answers and signals across the web with AI-ranked results')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 760, lineHeight: 1.7 }}>
              {pickLocaleText(
                locale,
                '这里是一个由 Agent 驱动的搜索工作台：你可以直接输入问题、按主题筛选、标记重点关键词，并把搜索请求作为低优先级任务交给系统持续处理。',
                'This is an agent-driven search workspace. Enter a question, filter by topic, mark focus keywords, and dispatch follow-up search requests as low-priority tasks.'
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-g" onClick={() => setShowAdvanced((v) => !v)} style={{ fontSize: 12, padding: '8px 14px' }}>
              {showAdvanced
                ? pickLocaleText(locale, '收起高级搜索', 'Hide Advanced Search')
                : pickLocaleText(locale, '高级搜索', 'Advanced Search')}
            </button>
            <button className="tpl-go" disabled={refreshing} onClick={refreshSearchResults} style={{ fontSize: 12, padding: '8px 14px' }}>
              {refreshLabel}
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            padding: 12,
            borderRadius: 16,
            background: 'rgba(8,12,24,0.55)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'grid',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={pickLocaleText(locale, '搜索问题、主题、公司、事件或关键词', 'Search topics, companies, events, or keywords')}
              style={{
                flex: 1,
                minWidth: 260,
                padding: '12px 14px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.04)',
                color: 'var(--text)',
                outline: 'none',
                fontSize: 14,
              }}
            />
            <button className="btn-refresh" onClick={() => setQuery('')} style={{ padding: '10px 14px', fontSize: 12 }}>
              {pickLocaleText(locale, '清空查询', 'Clear Query')}
            </button>
            <button className="auth-primary" disabled={submittingTask} onClick={submitSearchTask} style={{ width: 'auto', minWidth: 168, height: 44 }}>
              {submittingTask
                ? pickLocaleText(locale, '提交中…', 'Submitting...')
                : pickLocaleText(locale, '发起低优先级搜索任务', 'Create Low-Priority Search Task')}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {suggestionChips.map((chip) => (
              <button
                key={chip}
                className="chip"
                onClick={() => setQuery(chip)}
                style={{ cursor: 'pointer', background: normalizeText(query) === normalizeText(chip) ? 'rgba(122,162,255,0.24)' : undefined }}
              >
                {chip}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1.35fr) minmax(280px, 1fr)', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{pickLocaleText(locale, '搜索任务路由', 'Search Task Routing')}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    {pickLocaleText(locale, '搜索任务默认以低优先级进入调度中心，不挤占普通执行任务。', 'Search tasks enter the dispatch workflow with low priority by default so they do not crowd regular execution tasks.')}
                  </div>
                </div>
                <span className="chip">{pickLocaleText(locale, '默认优先级：低', 'Default Priority: Low')}</span>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`chip ${!manualTargets ? 'ok' : ''}`}
                  onClick={() => {
                    setManualTargets(false);
                    setSelectedTargets([]);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {pickLocaleText(locale, '自动分配', 'Auto Assign')}
                </button>
                <button
                  type="button"
                  className={`chip ${manualTargets ? 'ok' : ''}`}
                  onClick={() => setManualTargets(true)}
                  style={{ cursor: 'pointer' }}
                >
                  {pickLocaleText(locale, '指定专家（多选）', 'Specify Specialists (Multi-select)')}
                </button>
              </div>

              {manualTargets ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {targetOptions.map((dept) => {
                    const active = selectedTargets.includes(dept.id);
                    return (
                      <button
                        key={dept.id}
                        type="button"
                        className="chip"
                        onClick={() => toggleTarget(dept.id)}
                        style={{
                          cursor: 'pointer',
                          borderColor: active ? 'var(--acc)' : 'var(--line)',
                          color: active ? 'var(--acc)' : 'var(--text)',
                          background: active ? 'rgba(122,162,255,0.14)' : 'transparent',
                        }}
                      >
                        {dept.emoji} {dept.label} {active ? '✓' : ''}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
                {!manualTargets
                  ? pickLocaleText(locale, '当前为自动分配模式，系统会优先按搜索问题内容自动路由到最合适的专家。', 'Auto-assign mode is active. The system will route the search request to the most suitable specialist based on the query.')
                  : selectedTargets.length
                    ? pickLocaleText(locale, `已指定 ${selectedTargets.length} 位目标专家：${selectedTargets.map((id) => deptMeta(id, locale).label).join('、')}`, `Selected ${selectedTargets.length} specialist(s): ${selectedTargets.map((id) => deptMeta(id, locale).label).join(', ')}`)
                    : pickLocaleText(locale, '请至少勾选一位具体专家，或切回自动分配。', 'Select at least one specialist, or switch back to auto assign.')}
              </div>
            </div>

            <div style={{ padding: 12, borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{pickLocaleText(locale, '搜索专家状态', 'Search Specialist Status')}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    {pickLocaleText(locale, '这里会显示搜索专家当前是否正被任务、讨论或会议占用。', 'This shows whether the search specialist is currently occupied by a task, discussion, or meeting.')}
                  </div>
                </div>
                <button className="chip" onClick={loadCollabBusy} style={{ cursor: 'pointer' }}>
                  {pickLocaleText(locale, '刷新状态', 'Refresh Status')}
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 24 }}>{searchSpecialistMeta.emoji}</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>{searchSpecialistMeta.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{searchSpecialistMeta.role}</div>
                  </div>
                </div>
                <span
                  className="chip"
                  style={{
                    borderColor: searchSpecialistBusy ? 'rgba(255,120,120,0.5)' : 'rgba(76,195,138,0.5)',
                    color: searchSpecialistBusy ? '#ff9a9a' : '#7ff0a8',
                    background: searchSpecialistBusy ? 'rgba(255,120,120,0.12)' : 'rgba(76,195,138,0.12)',
                  }}
                >
                  {searchSpecialistBusy
                    ? pickLocaleText(locale, '忙碌中', 'Busy')
                    : pickLocaleText(locale, '空闲', 'Idle')}
                </span>
              </div>

              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                {searchSpecialistBusy ? (
                  <>
                    {renderBusyStateLabel(searchSpecialistBusy, locale)}
                    {searchSpecialistBusy.task_title
                      ? pickLocaleText(locale, ` · 当前任务：${searchSpecialistBusy.task_title}`, ` · Current task: ${searchSpecialistBusy.task_title}`)
                      : ''}
                  </>
                ) : pickLocaleText(locale, '当前没有检测到搜索专家被占用，可以直接发起新的搜索请求。', 'No active occupancy is detected for the search specialist. You can dispatch a new search request now.')}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className={`chip ${activeCategory === 'all' ? 'ok' : ''}`}
              onClick={() => setActiveCategory('all')}
              style={{ cursor: 'pointer' }}
            >
              {pickLocaleText(locale, '全部主题', 'All Topics')}
            </button>
            {Array.from(enabledSet).map((cat) => {
              const meta = CAT_META[cat] || { icon: '📰', color: 'var(--acc)', descZh: cat, descEn: cat };
              const isOn = activeCategory === cat;
              return (
                <button
                  key={cat}
                  className="chip"
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    cursor: 'pointer',
                    borderColor: isOn ? meta.color : undefined,
                    color: isOn ? meta.color : undefined,
                    background: isOn ? `${meta.color}22` : undefined,
                  }}
                >
                  {meta.icon} {getCategoryLabel(locale, cat)}
                  <span style={{ marginLeft: 4, opacity: 0.7 }}>{categoryCounts.get(cat) || 0}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showAdvanced && localConfig ? (
        <SearchSettingsPanel
          locale={locale}
          config={localConfig}
          enabledSet={enabledSet}
          onToggleCat={toggleCat}
          onAddKeyword={addKeyword}
          onRemoveKeyword={removeKeyword}
          onSave={saveConfig}
        />
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <MetricCard
          title={pickLocaleText(locale, '结果规模', 'Result Coverage')}
          value={formatCount(locale, totalResults, '条', 'results')}
          hint={pickLocaleText(locale, '当前筛选条件下的结果总数', 'Total results under current filters')}
        />
        <MetricCard
          title={pickLocaleText(locale, '重点命中', 'Focus Matches')}
          value={formatCount(locale, focusMatches, '条', 'matches')}
          hint={pickLocaleText(locale, '包含重点关键词的结果数量', 'Results matching your focus keywords')}
        />
        <MetricCard
          title={pickLocaleText(locale, '信源数量', 'Source Diversity')}
          value={String(sourceCount)}
          hint={pickLocaleText(locale, '当前结果涉及的独立来源', 'Distinct sources represented in current results')}
        />
        <MetricCard
          title={pickLocaleText(locale, '最近更新', 'Last Updated')}
          value={searchBrief?.generated_at || '--'}
          hint={dateStr || pickLocaleText(locale, '等待首次抓取', 'Waiting for first indexing run')}
        />
      </div>

      {!totalResults ? (
        <div className="mb-empty">
          {pickLocaleText(
            locale,
            query
              ? '当前查询没有命中结果。你可以换一个问题、切换主题，或者更新搜索索引。'
              : '当前还没有可展示的搜索结果。请先更新索引，或在高级搜索里调整主题范围与重点关键词。',
            query
              ? 'No result matches your current query. Try another question, switch topics, or refresh the index.'
              : 'There are no search results yet. Refresh the index first, or refine the topic coverage and focus keywords in Advanced Search.'
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(320px, 0.9fr)', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 12 }}>
            {filteredResults.map((item, idx) => {
              const meta = CAT_META[item.category] || { icon: '📰', color: 'var(--acc)', descZh: item.category, descEn: item.category };
              const host = hostnameOf(item.link);
              const hasImg = !!(item.image && item.image.startsWith('http'));
              return (
                <div
                  key={`${item.link}-${idx}`}
                  className="mb-card"
                  onClick={() => window.open(item.link, '_blank', 'noopener,noreferrer')}
                  style={{
                    cursor: 'pointer',
                    padding: 14,
                    borderRadius: 16,
                    border: '1px solid var(--line)',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))',
                  }}
                >
                  <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
                    <div
                      style={{
                        width: 112,
                        minWidth: 112,
                        height: 88,
                        borderRadius: 12,
                        overflow: 'hidden',
                        background: `${meta.color}18`,
                        border: `1px solid ${meta.color}22`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 28,
                      }}
                    >
                      {hasImg ? (
                        <img
                          src={item.image}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <span>{meta.icon}</span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        <span className="chip" style={{ color: meta.color, borderColor: `${meta.color}55`, background: `${meta.color}16` }}>
                          {meta.icon} {getCategoryLabel(locale, item.category)}
                        </span>
                        {item.kwHits > 0 ? (
                          <span className="chip ok">{pickLocaleText(locale, `命中 ${item.kwHits} 个重点词`, `${item.kwHits} focus match(es)`)}</span>
                        ) : null}
                        {idx < 3 ? <span className="chip">Top {idx + 1}</span> : null}
                      </div>
                      <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.45, marginBottom: 8 }}>{item.title}</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 10 }}>
                        {item.summary || item.desc || pickLocaleText(locale, '暂无摘要', 'No summary available')}
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }}>
                        <span>{pickLocaleText(locale, '来源', 'Source')}: {item.source || host || '--'}</span>
                        {host ? <span>{pickLocaleText(locale, '域名', 'Host')}: {host}</span> : null}
                        {item.pub_date ? <span>{pickLocaleText(locale, '发布时间', 'Published')}: {item.pub_date.substring(0, 16)}</span> : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'grid', gap: 12, position: 'sticky', top: 14 }}>
            <InsightPanel
              title={pickLocaleText(locale, 'AI 检索摘要', 'AI Search Snapshot')}
            >
              <div style={{ display: 'grid', gap: 10, fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
                <div>
                  {pickLocaleText(
                    locale,
                    `当前结果覆盖 ${totalResults} 条记录，聚焦 ${categoryCounts.size || 0} 个主题；其中 ${focusMatches} 条与重点关键词直接相关。`,
                    `Current results cover ${totalResults} records across ${categoryCounts.size || 0} topics, with ${focusMatches} directly matching your focus keywords.`
                  )}
                </div>
                <div>
                  {pickLocaleText(
                    locale,
                    topSources.length
                      ? `高频信源主要包括 ${topSources.map(([name]) => name).join('、')}。`
                      : '当前结果中还没有稳定的高频信源。',
                    topSources.length
                      ? `High-frequency sources currently include ${topSources.map(([name]) => name).join(', ')}.`
                      : 'No dominant sources are detected in the current result set.'
                  )}
                </div>
                <div>
                  {pickLocaleText(
                    locale,
                    query
                      ? `当前查询为“${query}”，结果已按相关性重新排序。`
                      : '你可以直接输入问题、公司名、事件或主题词，让结果按相关性重排。',
                    query
                      ? `The current query is “${query}”, and results are re-ranked by relevance.`
                      : 'Enter a question, company, event, or topic to re-rank the result set by relevance.'
                  )}
                </div>
              </div>
            </InsightPanel>

            <InsightPanel title={pickLocaleText(locale, '重点结果', 'Featured Results')}>
              <div style={{ display: 'grid', gap: 10 }}>
                {featured.map((item, idx) => (
                  <div key={`${item.link}-featured-${idx}`} style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                      {pickLocaleText(locale, '重点结果', 'Featured')} #{idx + 1}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.6 }}>{item.title}</div>
                  </div>
                ))}
                {!featured.length ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>{pickLocaleText(locale, '暂无重点结果', 'No featured results')}</div> : null}
              </div>
            </InsightPanel>

            <InsightPanel title={pickLocaleText(locale, '搜索提示', 'Query Suggestions')}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {suggestionChips.map((chip) => (
                  <button key={`side-${chip}`} className="chip" onClick={() => setQuery(chip)} style={{ cursor: 'pointer' }}>
                    {chip}
                  </button>
                ))}
              </div>
            </InsightPanel>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 16,
        border: '1px solid var(--line)',
        background: 'rgba(255,255,255,0.025)',
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{hint}</div>
    </div>
  );
}

function InsightPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: 14, borderRadius: 16, border: '1px solid var(--line)', background: 'rgba(255,255,255,0.025)' }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function SearchSettingsPanel({
  locale,
  config,
  enabledSet,
  onToggleCat,
  onAddKeyword,
  onRemoveKeyword,
  onSave,
}: {
  locale: Locale;
  config: SubConfig;
  enabledSet: Set<string>;
  onToggleCat: (name: string) => void;
  onAddKeyword: (kw: string) => void;
  onRemoveKeyword: (i: number) => void;
  onSave: () => void;
}) {
  const [newKw, setNewKw] = useState('');

  const allCats = [...DEFAULT_CATS];
  (config.categories || []).forEach((c) => {
    if (!allCats.includes(c.name)) allCats.push(c.name);
  });

  return (
    <div style={{ padding: 18, background: 'var(--panel2)', borderRadius: 18, border: '1px solid var(--line)', display: 'grid', gap: 18 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{pickLocaleText(locale, '高级搜索设置', 'Advanced Search Settings')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
          {pickLocaleText(locale, '这里只保留搜索本身需要的设置：主题范围与重点关键词。旧的 RSS 订阅、自定义源与外部推送入口已从搜索引擎界面移除。', 'Only search-specific settings remain here: topic coverage and focus keywords. Legacy RSS subscriptions, custom source management, and external push entries have been removed from the search engine interface.')}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '主题范围', 'Topic Coverage')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {allCats.map((cat) => {
            const meta = CAT_META[cat] || { icon: '📰', color: 'var(--acc)', descZh: cat, descEn: cat };
            const on = enabledSet.has(cat);
            return (
              <button
                key={cat}
                onClick={() => onToggleCat(cat)}
                className="chip"
                style={{
                  cursor: 'pointer',
                  borderColor: on ? meta.color : 'var(--line)',
                  color: on ? meta.color : 'var(--text)',
                  background: on ? `${meta.color}18` : 'transparent',
                }}
              >
                {meta.icon} {getCategoryLabel(locale, cat)} {on ? '✓' : ''}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '重点关键词', 'Focus Keywords')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(config.keywords || []).map((kw, i) => (
            <span key={`${kw}-${i}`} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {kw}
              <span style={{ cursor: 'pointer', color: 'var(--danger)' }} onClick={() => onRemoveKeyword(i)}>✕</span>
            </span>
          ))}
          {!(config.keywords || []).length ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '暂未设置重点关键词', 'No focus keywords yet')}</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={newKw}
            onChange={(e) => setNewKw(e.target.value)}
            placeholder={pickLocaleText(locale, '输入要重点关注的主题词', 'Enter a keyword to prioritize')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onAddKeyword(newKw.trim());
                setNewKw('');
              }
            }}
            style={{ flex: 1, minWidth: 240, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12, outline: 'none' }}
          />
          <button className="btn btn-g" onClick={() => { onAddKeyword(newKw.trim()); setNewKw(''); }} style={{ fontSize: 12, padding: '8px 14px' }}>
            {pickLocaleText(locale, '添加关键词', 'Add Keyword')}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="tpl-go" onClick={onSave} style={{ fontSize: 12, padding: '8px 16px' }}>
          {pickLocaleText(locale, '保存搜索设置', 'Save Search Settings')}
        </button>
      </div>
    </div>
  );
}
