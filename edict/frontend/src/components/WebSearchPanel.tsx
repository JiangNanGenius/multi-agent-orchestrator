import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import type { SubConfig, SearchResultItem } from '../api';
import { pickLocaleText, formatCount, type Locale } from '../i18n';

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

export default function WebSearchPanel() {
  const locale = useStore((s) => s.locale);
  const searchBrief = useStore((s) => s.searchBrief);
  const subConfig = useStore((s) => s.subConfig);
  const loadWebSearch = useStore((s) => s.loadWebSearch);
  const loadSubConfig = useStore((s) => s.loadSubConfig);
  const toast = useStore((s) => s.toast);

  const [showConfig, setShowConfig] = useState(false);
  const [localConfig, setLocalConfig] = useState<SubConfig | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLabel, setRefreshLabel] = useState(pickLocaleText(locale, '更新索引', 'Refresh Index'));
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadWebSearch();
  }, [loadWebSearch]);

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

  const addFeed = (name: string, url: string, category: string) => {
    if (!localConfig || !name || !url) {
      toast(pickLocaleText(locale, '请填写信息源名称与地址', 'Please fill in source name and URL'), 'err');
      return;
    }
    const feeds = [...(localConfig.custom_feeds || [])];
    feeds.push({ name, url, category });
    setLocalConfig({ ...localConfig, custom_feeds: feeds });
  };

  const removeFeed = (i: number) => {
    if (!localConfig) return;
    const feeds = [...(localConfig.custom_feeds || [])];
    feeds.splice(i, 1);
    setLocalConfig({ ...localConfig, custom_feeds: feeds });
  };

  const saveConfig = async () => {
    if (!localConfig) return;
    try {
      const r = await api.saveSearchConfig(localConfig);
      if (r.ok) {
        toast(pickLocaleText(locale, '搜索策略已保存', 'Search strategy saved'), 'ok');
        loadSubConfig();
      } else {
        toast(r.error || pickLocaleText(locale, '保存失败', 'Failed to save configuration'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '服务器连接失败', 'Server connection failed'), 'err');
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
            <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 720, lineHeight: 1.7 }}>
              {pickLocaleText(
                locale,
                '这里不再只是分类简报，而是一个可搜索、可筛选、可配置信号源的 AI 搜索工作台。你可以输入问题、按主题过滤结果、标记重点关键词，并持续刷新索引。',
                'This is no longer a static brief. It is an AI search workspace where you can query, filter by topic, tune sources, track focus keywords, and continuously refresh the index.'
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-g" onClick={() => setShowConfig((v) => !v)} style={{ fontSize: 12, padding: '8px 14px' }}>
              {pickLocaleText(locale, '搜索策略', 'Search Strategy')}
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
            gap: 10,
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

      {showConfig && localConfig ? (
        <SearchStrategyPanel
          locale={locale}
          config={localConfig}
          enabledSet={enabledSet}
          onToggleCat={toggleCat}
          onAddKeyword={addKeyword}
          onRemoveKeyword={removeKeyword}
          onAddFeed={addFeed}
          onRemoveFeed={removeFeed}
          onSave={saveConfig}
          onSetWebhook={(v) => setLocalConfig({ ...localConfig, feishu_webhook: v })}
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
              : '当前还没有可展示的搜索结果。请先更新索引，或在搜索策略里添加更多信号源与关键词。',
            query
              ? 'No result matches your current query. Try another question, switch topics, or refresh the index.'
              : 'There are no search results yet. Refresh the index first, or add more sources and keywords in Search Strategy.'
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
              children={
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
              }
            />

            <InsightPanel
              title={pickLocaleText(locale, '重点结果', 'Featured Results')}
              children={
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
              }
            />

            <InsightPanel
              title={pickLocaleText(locale, '搜索提示', 'Query Suggestions')}
              children={
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {suggestionChips.map((chip) => (
                    <button key={`side-${chip}`} className="chip" onClick={() => setQuery(chip)} style={{ cursor: 'pointer' }}>
                      {chip}
                    </button>
                  ))}
                </div>
              }
            />
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

function InsightPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 14, borderRadius: 16, border: '1px solid var(--line)', background: 'rgba(255,255,255,0.025)' }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function SearchStrategyPanel({
  locale,
  config,
  enabledSet,
  onToggleCat,
  onAddKeyword,
  onRemoveKeyword,
  onAddFeed,
  onRemoveFeed,
  onSave,
  onSetWebhook,
}: {
  locale: Locale;
  config: SubConfig;
  enabledSet: Set<string>;
  onToggleCat: (name: string) => void;
  onAddKeyword: (kw: string) => void;
  onRemoveKeyword: (i: number) => void;
  onAddFeed: (name: string, url: string, cat: string) => void;
  onRemoveFeed: (i: number) => void;
  onSave: () => void;
  onSetWebhook: (v: string) => void;
}) {
  const [newKw, setNewKw] = useState('');
  const [feedName, setFeedName] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [feedCat, setFeedCat] = useState(DEFAULT_CATS[0]);

  const allCats = [...DEFAULT_CATS];
  (config.categories || []).forEach((c) => {
    if (!allCats.includes(c.name)) allCats.push(c.name);
  });

  return (
    <div style={{ padding: 18, background: 'var(--panel2)', borderRadius: 18, border: '1px solid var(--line)', display: 'grid', gap: 18 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{pickLocaleText(locale, '搜索策略设置', 'Search Strategy Settings')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
          {pickLocaleText(locale, '在这里管理主题范围、重点关键词、自定义信息源和推送地址，让 AI 搜索结果更贴近你的业务场景。', 'Manage topics, priority keywords, custom sources, and push destinations to align AI search with your workflows.')}
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
        <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '重点关键词', 'Priority Keywords')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(config.keywords || []).map((kw, i) => (
            <span key={`${kw}-${i}`} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {kw}
              <span style={{ cursor: 'pointer', color: 'var(--danger)' }} onClick={() => onRemoveKeyword(i)}>✕</span>
            </span>
          ))}
          {!(config.keywords || []).length ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '暂未设置重点关键词', 'No priority keywords yet')}</span> : null}
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

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '自定义信息源', 'Custom Sources')}</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {(config.custom_feeds || []).map((f, i) => (
            <div key={`${f.name}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10, borderRadius: 12, border: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ minWidth: 110, fontWeight: 700 }}>{f.name}</div>
              <div style={{ flex: 1, color: 'var(--muted)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.url}</div>
              <div style={{ fontSize: 12, color: 'var(--acc)' }}>{getCategoryLabel(locale, f.category)}</div>
              <button className="chip" onClick={() => onRemoveFeed(i)} style={{ cursor: 'pointer', color: 'var(--danger)' }}>Remove</button>
            </div>
          ))}
          {!(config.custom_feeds || []).length ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '暂未添加额外信息源', 'No extra sources added')}</div> : null}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 0.8fr auto', gap: 8 }}>
          <input
            placeholder={pickLocaleText(locale, '信息源名称', 'Source name')}
            value={feedName}
            onChange={(e) => setFeedName(e.target.value)}
            style={{ padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12, outline: 'none' }}
          />
          <input
            placeholder={pickLocaleText(locale, 'RSS 或网页地址', 'RSS or source URL')}
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            style={{ padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12, outline: 'none' }}
          />
          <select
            value={feedCat}
            onChange={(e) => setFeedCat(e.target.value)}
            style={{ padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12, outline: 'none' }}
          >
            {allCats.map((c) => <option key={c} value={c}>{getCategoryLabel(locale, c)}</option>)}
          </select>
          <button className="btn btn-g" onClick={() => { onAddFeed(feedName, feedUrl, feedCat); setFeedName(''); setFeedUrl(''); }} style={{ fontSize: 12, padding: '8px 14px' }}>
            {pickLocaleText(locale, '添加源', 'Add Source')}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '外部推送地址', 'External Delivery Webhook')}</div>
        <input
          type="text"
          value={config.feishu_webhook || ''}
          onChange={(e) => onSetWebhook(e.target.value)}
          placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
          style={{ width: '100%', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12, outline: 'none' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="tpl-go" onClick={onSave} style={{ fontSize: 12, padding: '8px 16px' }}>
          {pickLocaleText(locale, '保存搜索策略', 'Save Search Strategy')}
        </button>
      </div>
    </div>
  );
}
