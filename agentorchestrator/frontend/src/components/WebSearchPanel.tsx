import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api, type CollabAgentBusyEntry, type SearchResultItem, type SubConfig } from '../api';
import { pickLocaleText, formatCount, type Locale } from '../i18n';
import { deptMeta, normalizeAgentId, useStore } from '../store';

type ResultWithMeta = SearchResultItem & {
  category: string;
  score: number;
  kwHits: number;
  publishedAtMs: number | null;
};

type SearchAdvancedConfig = SubConfig & {
  custom_topics?: string[];
  freshness_days?: number;
  ranking_mode?: 'balanced' | 'relevance' | 'freshness';
  search_depth?: 'focused' | 'standard' | 'broad';
  result_limit?: number;
};

type SearchHistoryItem = {
  id: string;
  query: string;
  createdAt: string;
};

const SEARCH_HISTORY_KEY = 'agentorchestrator_web_search_history';
const SEARCH_HISTORY_LIMIT = 8;

function readSearchHistory(): SearchHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is SearchHistoryItem => Boolean(item && typeof item.id === 'string' && typeof item.query === 'string' && typeof item.createdAt === 'string'))
      .slice(0, SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveSearchHistory(items: SearchHistoryItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(items.slice(0, SEARCH_HISTORY_LIMIT)));
  } catch {
    // ignore local cache write failures
  }
}

const PRESET_TOPICS = [
  { name: '政治', enabled: true },
  { name: '军事', enabled: true },
  { name: '经济', enabled: true },
  { name: 'AI大模型', enabled: true },
  { name: '科技', enabled: false },
  { name: '能源', enabled: false },
  { name: '金融', enabled: false },
  { name: '公司', enabled: false },
  { name: '监管', enabled: false },
  { name: '出海', enabled: false },
];

const CAT_META: Record<string, { icon: string; color: string; descZh: string; descEn: string }> = {
  政治: { icon: '🏛️', color: '#6a9eff', descZh: '追踪全球政策、地缘关系与公共议题变化', descEn: 'Track policy, geopolitics, and public affairs updates' },
  军事: { icon: '🛰️', color: '#ff6b81', descZh: '关注军事动态、冲突态势与安全风险', descEn: 'Monitor military updates, conflicts, and security risks' },
  经济: { icon: '📈', color: '#2ecc8a', descZh: '覆盖市场、企业、资本与宏观经济信号', descEn: 'Cover markets, companies, capital, and macro signals' },
  AI大模型: { icon: '🧠', color: '#a07aff', descZh: '聚焦模型发布、应用落地与 AI 产业趋势', descEn: 'Focus on model launches, adoption, and AI industry trends' },
  科技: { icon: '🧪', color: '#33c3ff', descZh: '关注科技产品、技术平台与产业创新动态', descEn: 'Track technology products, platforms, and innovation signals' },
  能源: { icon: '⚡', color: '#f5c842', descZh: '覆盖油气、电力、新能源与基础资源供需变化', descEn: 'Cover oil, power, renewables, and resource supply signals' },
  金融: { icon: '💹', color: '#00c2a8', descZh: '关注利率、汇率、资本市场与金融机构动向', descEn: 'Monitor rates, FX, capital markets, and financial institutions' },
  公司: { icon: '🏢', color: '#7fd1ff', descZh: '聚焦企业经营、产品发布、融资并购与组织变化', descEn: 'Focus on company operations, launches, funding, and M&A' },
  监管: { icon: '🧾', color: '#ff9f43', descZh: '追踪政策落地、监管通告、处罚与合规变化', descEn: 'Track regulations, notices, penalties, and compliance shifts' },
  出海: { icon: '🌍', color: '#5dd39e', descZh: '关注跨境市场、海外扩张、本地化与国际竞争', descEn: 'Track overseas expansion, localization, and global competition' },
};

const DEFAULT_CATS = PRESET_TOPICS.filter((item) => item.enabled).map((item) => item.name);
const SEARCH_OWNER_ZH = 'AI 搜索引擎';
const SEARCH_OWNER_EN = 'AI Search Engine';
const FRESHNESS_OPTIONS = [0, 1, 3, 7, 30, 90];

function getCategoryLabel(locale: Locale, cat: string) {
  const labels: Record<string, string> = {
    政治: 'Politics',
    军事: 'Security',
    经济: 'Economy',
    AI大模型: 'AI Models',
    科技: 'Technology',
    能源: 'Energy',
    金融: 'Finance',
    公司: 'Companies',
    监管: 'Regulation',
    出海: 'Global Expansion',
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
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function renderBusyStateLabel(entry: CollabAgentBusyEntry, locale: Locale): string {
  const source = entry.occupancy_kind || entry.source_type || '';
  if (locale === 'en') {
    if (source === 'task_active') return 'Handling a task';
    if (source === 'task_reserved') return 'Reserved for a task';
    if (source === 'task_paused') return 'Task paused';
    if (source === 'task_blocked') return 'Task blocked';
    if (source === 'meeting') return 'In collaboration';
    if (source === 'chat') return 'In discussion';
    return entry.label || 'Busy';
  }
  if (source === 'task_active') return '任务执行中';
  if (source === 'task_reserved') return '任务预占中';
  if (source === 'task_paused') return '任务暂停中';
  if (source === 'task_blocked') return '任务阻塞中';
  if (source === 'meeting') return '协作处理中';
  if (source === 'chat') return '讨论占用中';
  return entry.label || '忙碌中';
}

function buildSearchTaskTitle(locale: Locale, query: string) {
  return locale === 'en' ? `AI Search: ${query}` : `AI 搜索：${query}`;
}

function normalizeSearchConfig(config?: SubConfig | null): SearchAdvancedConfig {
  const baseCategories = PRESET_TOPICS.map((item) => ({ ...item }));
  if (Array.isArray(config?.categories)) {
    config.categories.forEach((item) => {
      const existing = baseCategories.find((entry) => entry.name === item.name);
      if (existing) {
        existing.enabled = item.enabled !== false;
      } else if (item?.name) {
        baseCategories.push({ name: item.name, enabled: item.enabled !== false });
      }
    });
  }
  return {
    categories: baseCategories,
    keywords: Array.isArray(config?.keywords) ? config.keywords : [],
    custom_feeds: Array.isArray(config?.custom_feeds) ? config.custom_feeds : [],
    feishu_webhook: String(config?.feishu_webhook || ''),
    custom_topics: Array.isArray((config as SearchAdvancedConfig | null)?.custom_topics)
      ? (config as SearchAdvancedConfig).custom_topics
      : [],
    freshness_days: Number((config as SearchAdvancedConfig | null)?.freshness_days ?? 7),
    ranking_mode: ((config as SearchAdvancedConfig | null)?.ranking_mode as SearchAdvancedConfig['ranking_mode']) || 'balanced',
    search_depth: ((config as SearchAdvancedConfig | null)?.search_depth as SearchAdvancedConfig['search_depth']) || 'standard',
    result_limit: Number((config as SearchAdvancedConfig | null)?.result_limit ?? 60),
  };
}

function parsePublishedAtMs(raw?: string) {
  if (!raw) return null;
  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) return direct;
  const normalized = raw
    .replace(/年|\//g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/\./g, '-')
    .trim();
  const fallback = Date.parse(normalized);
  return Number.isNaN(fallback) ? null : fallback;
}

function getFreshnessLabel(locale: Locale, days: number) {
  if (locale === 'en') {
    if (!days) return 'All time';
    if (days === 1) return 'Past 24 hours';
    return `Past ${days} days`;
  }
  if (!days) return '不限时间';
  if (days === 1) return '近 24 小时';
  return `近 ${days} 天`;
}

function getRankingLabel(locale: Locale, mode: SearchAdvancedConfig['ranking_mode']) {
  if (mode === 'relevance') return pickLocaleText(locale, '相关度优先', 'Relevance First');
  if (mode === 'freshness') return pickLocaleText(locale, '鲜度优先', 'Freshness First');
  return pickLocaleText(locale, '平衡排序', 'Balanced');
}

function getDepthLabel(locale: Locale, depth: SearchAdvancedConfig['search_depth']) {
  if (depth === 'focused') return pickLocaleText(locale, '聚焦模式', 'Focused');
  if (depth === 'broad') return pickLocaleText(locale, '扩展模式', 'Broad');
  return pickLocaleText(locale, '标准模式', 'Standard');
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
  const [localConfig, setLocalConfig] = useState<SearchAdvancedConfig>(normalizeSearchConfig(null));
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [submittingTask, setSubmittingTask] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [isCompactViewport, setIsCompactViewport] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 900 : false));

  useEffect(() => {
    loadWebSearch();
    loadCollabBusy();
  }, [loadWebSearch, loadCollabBusy]);

  useEffect(() => {
    setLocalConfig(normalizeSearchConfig(subConfig));
  }, [subConfig]);

  useEffect(() => {
    setSearchHistory(readSearchHistory());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const syncViewport = () => setIsCompactViewport(window.innerWidth <= 900);
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  const patchConfig = (patch: Partial<SearchAdvancedConfig>) => {
    setLocalConfig((prev) => ({ ...prev, ...patch }));
  };

  const toggleCat = (name: string) => {
    setLocalConfig((prev) => {
      const categories = [...(prev.categories || [])];
      const existing = categories.find((item) => item.name === name);
      if (existing) {
        existing.enabled = !existing.enabled;
      } else {
        categories.push({ name, enabled: true });
      }
      return { ...prev, categories };
    });
  };

  const addKeyword = (kw: string) => {
    const next = kw.trim();
    if (!next) return;
    setLocalConfig((prev) => ({
      ...prev,
      keywords: uniqueStrings([...(prev.keywords || []), next]),
    }));
  };

  const removeKeyword = (index: number) => {
    setLocalConfig((prev) => {
      const keywords = [...(prev.keywords || [])];
      keywords.splice(index, 1);
      return { ...prev, keywords };
    });
  };

  const addTopic = (topic: string) => {
    const next = topic.trim();
    if (!next) return;
    setLocalConfig((prev) => {
      const categories = [...(prev.categories || [])];
      if (!categories.find((item) => item.name === next)) {
        categories.push({ name: next, enabled: true });
      }
      return {
        ...prev,
        categories,
        custom_topics: uniqueStrings([...(prev.custom_topics || []), next]),
      };
    });
  };

  const removeTopic = (topic: string) => {
    setLocalConfig((prev) => ({
      ...prev,
      categories: (prev.categories || []).filter((item) => item.name !== topic),
      custom_topics: (prev.custom_topics || []).filter((item) => item !== topic),
    }));
    if (activeCategory === topic) setActiveCategory('all');
  };

  const saveConfig = async () => {
    try {
      const payload = {
        ...localConfig,
      };
      const r = await api.saveSearchConfig(payload);
      if (r.ok) {
        toast(pickLocaleText(locale, '高级搜索设置已保存', 'Advanced search settings saved'), 'ok');
        loadSubConfig();
        loadWebSearch();
      } else {
        toast(r.error || pickLocaleText(locale, '保存失败', 'Failed to save settings'), 'err');
      }
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    }
  };

  const enabledSet = useMemo(
    () => new Set((localConfig.categories || []).filter((item) => item.enabled).map((item) => item.name)),
    [localConfig.categories],
  );

  const userKeywords = localConfig.keywords || [];
  const loweredKeywords = userKeywords.map((item) => normalizeText(item));
  const freshnessDays = Number(localConfig.freshness_days || 0);
  const rankingMode = localConfig.ranking_mode || 'balanced';
  const resultLimit = Math.max(10, Math.min(200, Number(localConfig.result_limit || 60)));
  const dateStr = formatBriefDate(locale, searchBrief?.date);
  const categories = searchBrief?.categories || {};
  const nowMs = Date.now();

  const flatResults = useMemo<ResultWithMeta[]>(() => {
    return Object.entries(categories).flatMap(([category, items]) => {
      if (!enabledSet.has(category)) return [];
      return (items || []).map((item, idx) => {
        const text = normalizeText(`${item.title || ''} ${item.summary || ''} ${item.desc || ''} ${item.source || ''}`);
        const kwHits = loweredKeywords.filter((kw) => text.includes(kw)).length;
        const queryHit = query ? (text.includes(normalizeText(query)) ? 1 : 0) : 0;
        const publishedAtMs = parsePublishedAtMs(item.pub_date);
        const ageDays = publishedAtMs ? Math.max(0, (nowMs - publishedAtMs) / 86400000) : 365;
        const freshnessBoost = Math.max(0, 12 - Math.min(12, ageDays));
        return {
          ...item,
          category,
          kwHits,
          publishedAtMs,
          score: kwHits * 12 + queryHit * 9 + freshnessBoost + Math.max(0, 4 - idx),
        };
      });
    });
  }, [categories, enabledSet, loweredKeywords, nowMs, query]);

  const filteredResults = useMemo(() => {
    const q = normalizeText(query);
    const freshnessMs = freshnessDays > 0 ? freshnessDays * 86400000 : 0;
    const rows = flatResults.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) return false;
      if (q) {
        const haystack = normalizeText(`${item.title || ''} ${item.summary || ''} ${item.desc || ''} ${item.source || ''}`);
        if (!haystack.includes(q)) return false;
      }
      if (freshnessMs > 0 && item.publishedAtMs && nowMs - item.publishedAtMs > freshnessMs) return false;
      return true;
    });
    rows.sort((a, b) => {
      if (rankingMode === 'freshness') {
        return (b.publishedAtMs || 0) - (a.publishedAtMs || 0) || b.score - a.score;
      }
      if (rankingMode === 'relevance') {
        return b.score - a.score || (b.publishedAtMs || 0) - (a.publishedAtMs || 0);
      }
      const freshnessDelta = ((b.publishedAtMs || 0) - (a.publishedAtMs || 0)) / 86400000;
      return (b.score - a.score) + freshnessDelta * 0.35;
    });
    return rows.slice(0, resultLimit);
  }, [activeCategory, flatResults, freshnessDays, nowMs, query, rankingMode, resultLimit]);

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
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [filteredResults]);

  const suggestionChips = useMemo(() => {
    return uniqueStrings([
      ...userKeywords,
      ...Object.keys(categories),
      ...filteredResults.slice(0, 6).map((item) => item.title).filter(Boolean),
    ]).slice(0, 8);
  }, [categories, filteredResults, userKeywords]);

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
  const allTopicScopes = uniqueStrings([
    ...DEFAULT_CATS,
    ...(localConfig.categories || []).map((item) => item.name),
    ...(localConfig.custom_topics || []),
  ]);

  const advancedSummary = useMemo(() => {
    const topicCount = enabledSet.size;
    const keywordCount = (localConfig.keywords || []).length;
    const customTopicCount = (localConfig.custom_topics || []).length;
    return [
      getFreshnessLabel(locale, freshnessDays),
      getRankingLabel(locale, rankingMode),
      getDepthLabel(locale, localConfig.search_depth || 'standard'),
      formatCount(locale, resultLimit, '条结果', 'results'),
      pickLocaleText(locale, `${topicCount} 个主题范围`, `${topicCount} topic scopes`),
      keywordCount
        ? pickLocaleText(locale, `${keywordCount} 个重点关键词`, `${keywordCount} focus keywords`)
        : pickLocaleText(locale, '未设置重点关键词', 'No focus keywords'),
      customTopicCount
        ? pickLocaleText(locale, `${customTopicCount} 个自定义主题`, `${customTopicCount} custom topics`)
        : pickLocaleText(locale, '使用默认主题集', 'Using default topic set'),
    ];
  }, [enabledSet.size, freshnessDays, localConfig.custom_topics, localConfig.keywords, localConfig.search_depth, locale, rankingMode, resultLimit]);

  const rememberSearch = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setSearchHistory((prev) => {
      const next: SearchHistoryItem[] = [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          query: trimmed,
          createdAt: new Date().toISOString(),
        },
        ...prev.filter((item) => normalizeText(item.query) !== normalizeText(trimmed)),
      ].slice(0, SEARCH_HISTORY_LIMIT);
      saveSearchHistory(next);
      return next;
    });
  };

  const removeHistoryItem = (id: string) => {
    setSearchHistory((prev) => {
      const next = prev.filter((item) => item.id !== id);
      saveSearchHistory(next);
      return next;
    });
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    saveSearchHistory([]);
  };

  const submitSearchTask = async () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      toast(pickLocaleText(locale, '请先输入要搜索的问题或线索', 'Please enter a search question or lead first'), 'err');
      return;
    }
    rememberSearch(trimmedQuery);
    setSubmittingTask(true);
    try {
      const payload = {
        title: buildSearchTaskTitle(locale, trimmedQuery),
        org: searchSpecialistMeta.label,
        owner: pickLocaleText(locale, SEARCH_OWNER_ZH, SEARCH_OWNER_EN),
        priority: 'low',
        templateId: 'web_search',
        params: {
          query: trimmedQuery,
          topic_scope: activeCategory === 'all' ? Array.from(enabledSet).join('、') : activeCategory,
          keywords: userKeywords.join('、'),
          freshness_days: String(freshnessDays),
          ranking_mode: String(rankingMode),
          search_depth: String(localConfig.search_depth || 'standard'),
          result_limit: String(resultLimit),
        },
        targetDept: 'search_specialist',
        targetDepts: ['search_specialist'],
      };
      const result = await api.createTask(payload);
      if (!result.ok) {
        toast(result.error || pickLocaleText(locale, '搜索任务创建失败', 'Failed to create search task'), 'err');
        return;
      }
      toast(
        result.message || pickLocaleText(locale, `已提交新的搜索请求 ${result.taskId || ''}`.trim(), `New search request submitted ${result.taskId || ''}`.trim()),
        'ok',
      );
      loadCollabBusy();
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    } finally {
      setSubmittingTask(false);
    }
  };

  return (
    <div className="search-panel-shell" style={{ gap: isCompactViewport ? 10 : 18 }}>
      <div className="search-panel-hero" style={{ padding: isCompactViewport ? 12 : 20, borderRadius: isCompactViewport ? 16 : 24 }}>
        <div className="search-panel-hero__top" style={{ gridTemplateColumns: isCompactViewport ? '1fr' : 'minmax(0, 1fr) auto' }}>
          <div className="search-panel-hero__copy">
            {!isCompactViewport ? (
              <div className="search-panel-hero__eyebrow">{pickLocaleText(locale, '搜索', 'Search')}</div>
            ) : null}
            <div className="search-panel-hero__title" style={{ fontSize: isCompactViewport ? 18 : 30 }}>
              {pickLocaleText(locale, '搜索', 'Search')}
            </div>
            <div className="search-panel-hero__summary">
              {pickLocaleText(
                locale,
                '将查询、筛选与状态信息压缩到同一工作台，减少空白与跳视，让桌面端更聚焦。',
                'Compress query, filters, and status into one workbench so the desktop view feels tighter and easier to scan.',
              )}
            </div>
          </div>
          <div className="search-panel-hero__actions" style={{ justifyItems: isCompactViewport ? 'stretch' : 'end' }}>
            <button className="btn btn-g" onClick={() => setShowAdvanced((value) => !value)} style={{ width: isCompactViewport ? '100%' : 'auto', fontSize: 12, padding: isCompactViewport ? '8px 10px' : '8px 14px' }}>
              {showAdvanced
                ? pickLocaleText(locale, '收起高级搜索', 'Hide Advanced Search')
                : pickLocaleText(locale, '高级搜索', 'Advanced Search')}
            </button>
          </div>
        </div>

        <div className="search-panel-hero__chips" style={{ marginTop: isCompactViewport ? 10 : 14 }}>
          {advancedSummary.slice(0, 4).map((item) => (
            <span key={item} className="chip">{item}</span>
          ))}
        </div>

        <div className="search-panel-workbench" style={{ marginTop: isCompactViewport ? 12 : 18, padding: isCompactViewport ? 10 : 16, borderRadius: isCompactViewport ? 12 : 20 }}>
          <div className="search-panel-form" style={{ gridTemplateColumns: isCompactViewport ? '1fr 1fr' : 'minmax(0, 1fr) auto auto' }}>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitSearchTask();
                }
              }}
              placeholder={pickLocaleText(locale, '搜索问题、主题、公司、事件或关键词', 'Search topics, companies, events, or keywords')}
              className="search-panel-input"
              style={{ gridColumn: isCompactViewport ? '1 / -1' : undefined }}
            />
            <button className="btn-refresh search-panel-clear-btn" onClick={() => setQuery('')} style={{ width: isCompactViewport ? '100%' : 'auto', minWidth: 0 }}>
              {pickLocaleText(locale, '清空查询', 'Clear Query')}
            </button>
            <button className="auth-primary search-panel-submit-btn" disabled={submittingTask} onClick={submitSearchTask} style={{ width: '100%', minWidth: isCompactViewport ? 0 : 132 }}>
              {submittingTask ? pickLocaleText(locale, '搜索中…', 'Searching...') : pickLocaleText(locale, '搜索', 'Search')}
            </button>
          </div>

          <div className="search-panel-suggestions">
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

          <div className="search-panel-meta-grid" style={{ gridTemplateColumns: isCompactViewport ? '1fr' : 'minmax(300px, 1.18fr) minmax(280px, 0.92fr)' }}>
            <div className="search-panel-meta-card search-panel-meta-card--setup">
              <div className="search-panel-meta-card__head">
                <div>
                  <div className="search-panel-meta-card__title">{pickLocaleText(locale, '当前配置', 'Current Setup')}</div>
                  <div className="search-panel-meta-card__desc">
                    {pickLocaleText(locale, '当前检索参数一目了然，无需大块空白容器。', 'Keep the active retrieval parameters readable without oversized empty blocks.')}
                  </div>
                </div>
              </div>
              <div className="search-panel-meta-card__chips">
                <span className="chip">{getFreshnessLabel(locale, freshnessDays)}</span>
                <span className="chip">{getRankingLabel(locale, rankingMode)}</span>
                <span className="chip">{getDepthLabel(locale, localConfig.search_depth || 'standard')}</span>
                <span className="chip">{formatCount(locale, resultLimit, '条', 'results')}</span>
              </div>
            </div>

            <div className="search-panel-meta-card search-panel-meta-card--status">
              <div className="search-panel-meta-card__head">
                <div>
                  <div className="search-panel-meta-card__title">{pickLocaleText(locale, '当前状态', 'Current Status')}</div>
                  <div className="search-panel-meta-card__desc">
                    {pickLocaleText(locale, '将执行主体、负载状态与说明收敛为一张状态卡。', 'Unify operator, workload state, and guidance into one concise status card.')}
                  </div>
                </div>
                <button className="chip" onClick={loadCollabBusy} style={{ cursor: 'pointer' }}>
                  {pickLocaleText(locale, '刷新状态', 'Refresh Status')}
                </button>
              </div>

              <div className="search-panel-status-row">
                <div className="search-panel-status-actor">
                  <span className="search-panel-status-actor__emoji">{searchSpecialistMeta.emoji}</span>
                  <div>
                    <div className="search-panel-status-actor__title">{searchSpecialistMeta.label}</div>
                    <div className="search-panel-status-actor__meta">{pickLocaleText(locale, '搜索协作', 'Search Collaboration')}</div>
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
                  {searchSpecialistBusy ? pickLocaleText(locale, '忙碌中', 'Busy') : pickLocaleText(locale, '空闲', 'Idle')}
                </span>
              </div>

              <div className="search-panel-status-copy">
                {searchSpecialistBusy
                  ? pickLocaleText(locale, '正在处理检索任务，可稍后刷新状态。', 'A search task is in progress. Refresh the status in a moment.')
                  : pickLocaleText(locale, '可发起新搜索', 'Ready for a new search')}
              </div>
            </div>
          </div>

          <div className="search-panel-topic-row">
            <button className={`chip ${activeCategory === 'all' ? 'ok' : ''}`} onClick={() => setActiveCategory('all')} style={{ cursor: 'pointer' }}>
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

      {showAdvanced ? (
        <SearchSettingsPanel
          locale={locale}
          isCompactViewport={isCompactViewport}
          config={localConfig}
          enabledSet={enabledSet}
          allTopicScopes={allTopicScopes}
          onToggleCat={toggleCat}
          onAddKeyword={addKeyword}
          onRemoveKeyword={removeKeyword}
          onAddTopic={addTopic}
          onRemoveTopic={removeTopic}
          onPatch={patchConfig}
          onSave={saveConfig}
        />
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: isCompactViewport ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(180px, 1fr))', gap: isCompactViewport ? 10 : 12 }}>
        <MetricCard
          title={pickLocaleText(locale, '结果规模', 'Result Coverage')}
          value={formatCount(locale, totalResults, '条', 'results')}
          hint={pickLocaleText(locale, '结果总数', 'Total results')}
        />
        <MetricCard
          title={pickLocaleText(locale, '重点命中', 'Focus Matches')}
          value={formatCount(locale, focusMatches, '条', 'matches')}
          hint={pickLocaleText(locale, '关键词命中', 'Keyword matches')}
        />
        <MetricCard
          title={pickLocaleText(locale, '来源数量', 'Sources')}
          value={formatCount(locale, sourceCount, '个', 'sources')}
          hint={pickLocaleText(locale, '来源域名', 'Source domains')}
        />
        <MetricCard
          title={pickLocaleText(locale, '最近更新', 'Last Updated')}
          value={searchBrief?.generated_at || '--'}
          hint={dateStr || pickLocaleText(locale, '暂无更新时间', 'No update time yet')}
        />
      </div>

      {!totalResults ? (
        <div className="mb-empty">
          {pickLocaleText(
            locale,
            query
              ? '当前查询没有命中结果。'
              : '暂无搜索结果。',
            query
              ? 'No results match the current query.'
              : 'No search results yet.',
          )}
        </div>
      ) : (
        <div className="web-search-results-layout" style={{ display: 'grid', gridTemplateColumns: isCompactViewport ? '1fr' : 'minmax(0, 1.4fr) minmax(280px, 0.8fr)', gap: isCompactViewport ? 12 : 16, alignItems: 'start' }}>
          <div className="web-search-results-list" style={{ display: 'grid', gap: 12 }}>
            {filteredResults.map((item, idx) => {
              const meta = CAT_META[item.category] || { icon: '📰', color: 'var(--acc)', descZh: item.category, descEn: item.category };
              const host = hostnameOf(item.link);
              const hasImg = !!(item.image && item.image.startsWith('http'));
              return (
                <div
                  key={`${item.link}-${idx}`}
                  className="mb-card web-search-result-card"
                  onClick={() => window.open(item.link, '_blank', 'noopener,noreferrer')}
                  style={{
                    cursor: 'pointer',
                      padding: isCompactViewport ? 12 : 14,
                      borderRadius: isCompactViewport ? 14 : 16,

                    border: '1px solid var(--line)',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: isCompactViewport ? 'column' : 'row', gap: isCompactViewport ? 10 : 14, alignItems: 'stretch' }}>
                    <div
                      style={{
                        width: isCompactViewport ? '100%' : 112,
                        minWidth: isCompactViewport ? 0 : 112,
                        height: isCompactViewport ? 150 : 88,
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
                          onError={(event) => {
                            (event.target as HTMLImageElement).style.display = 'none';
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
                        {item.kwHits > 0 ? <span className="chip ok">{pickLocaleText(locale, `命中 ${item.kwHits} 个重点词`, `${item.kwHits} focus match(es)`)}</span> : null}
                        {idx < 3 ? <span className="chip">Top {idx + 1}</span> : null}
                      </div>
                      <div style={{ fontSize: isCompactViewport ? 15 : 17, fontWeight: 800, lineHeight: 1.45, marginBottom: 8 }}>{item.title}</div>
                      <div style={{ fontSize: isCompactViewport ? 12 : 13, color: 'var(--muted)', lineHeight: isCompactViewport ? 1.6 : 1.7, marginBottom: 10 }}>
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

          <div className="web-search-insight-rail" style={{ display: 'grid', gap: 12, position: isCompactViewport ? 'static' : 'sticky', top: isCompactViewport ? undefined : 14 }}>
            <InsightPanel title={pickLocaleText(locale, 'AI 检索摘要', 'AI Search Snapshot')}>
              <div style={{ display: 'grid', gap: 10, fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
                <div>
                  {pickLocaleText(
                    locale,
                    `当前结果覆盖 ${totalResults} 条记录，聚焦 ${categoryCounts.size || 0} 个主题；其中 ${focusMatches} 条与重点关键词直接相关。`,
                    `Current results cover ${totalResults} records across ${categoryCounts.size || 0} topics, with ${focusMatches} directly matching your focus keywords.`,
                  )}
                </div>
                <div>
                  {pickLocaleText(
                    locale,
                    topSources.length ? `高频信源主要包括 ${topSources.map(([name]) => name).join('、')}。` : '当前结果中还没有稳定的高频信源。',
                    topSources.length ? `High-frequency sources currently include ${topSources.map(([name]) => name).join(', ')}.` : 'No dominant sources are detected in the current result set.',
                  )}
                </div>
                <div>
                  {pickLocaleText(
                    locale,
                    query ? `当前查询为“${query}”，结果已按 ${getRankingLabel(locale, rankingMode)} 重新排序。` : '你可以直接输入问题、公司名、事件或主题词，让结果按当前排序策略重排。',
                    query ? `The current query is “${query}”, and results are re-ranked by ${getRankingLabel(locale, rankingMode).toLowerCase()}.` : 'Enter a question, company, event, or topic to re-rank the result set with the current strategy.',
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

      {searchHistory.length ? (
        <div style={{ marginTop: 8 }}>
          <InsightPanel title={pickLocaleText(locale, '最近搜索记录', 'Recent Search History')}>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{pickLocaleText(locale, '最近搜索', 'Recent Searches')}</div>
                  <span className="chip ok">
                    {pickLocaleText(locale, `${searchHistory.length} 条`, `${searchHistory.length}`)}
                  </span>
                </div>
                <button className="chip" onClick={clearSearchHistory} style={{ cursor: 'pointer' }}>
                  {pickLocaleText(locale, '清空记录', 'Clear')}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {searchHistory.map((item) => (
                  <span key={item.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', maxWidth: '100%' }}>
                    <button
                      className="chip"
                      onClick={() => setQuery(item.query)}
                      style={{ cursor: 'pointer', maxWidth: '100%', textAlign: 'left' }}
                      title={item.query}
                    >
                      {item.query}
                    </button>
                    <button
                      className="chip"
                      onClick={() => removeHistoryItem(item.id)}
                      style={{ cursor: 'pointer', color: 'var(--muted)' }}
                      title={pickLocaleText(locale, '删除该记录', 'Delete this history item')}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </InsightPanel>
        </div>
      ) : null}

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
  isCompactViewport,
  config,
  enabledSet,
  allTopicScopes,
  onToggleCat,
  onAddKeyword,
  onRemoveKeyword,
  onAddTopic,
  onRemoveTopic,
  onPatch,
  onSave,
}: {
  locale: Locale;
  isCompactViewport: boolean;
  config: SearchAdvancedConfig;
  enabledSet: Set<string>;
  allTopicScopes: string[];
  onToggleCat: (name: string) => void;
  onAddKeyword: (kw: string) => void;
  onRemoveKeyword: (i: number) => void;
  onAddTopic: (topic: string) => void;
  onRemoveTopic: (topic: string) => void;
  onPatch: (patch: Partial<SearchAdvancedConfig>) => void;
  onSave: () => void;
}) {
  const [newKw, setNewKw] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const customTopicSet = new Set(config.custom_topics || []);

  return (
    <div style={{ padding: isCompactViewport ? 14 : 18, background: 'var(--panel2)', borderRadius: isCompactViewport ? 16 : 18, border: '1px solid var(--line)', display: 'grid', gap: isCompactViewport ? 14 : 18 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{pickLocaleText(locale, '高级搜索', 'Advanced Search')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
          {pickLocaleText(locale, '这里可以像搜索引擎一样补充主题范围、鲜度、相关度、搜索深度、结果规模等设置。搜索任务会固定交给搜索助手处理；系统级设置请前往“系统设置”。', 'Use this area like a search engine to refine scope, freshness, ranking, search depth, and result size. Search requests are always handled by the search assistant, while system-level options live in System Settings.')}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '主题范围', 'Topic Scope')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {allTopicScopes.map((cat) => {
            const meta = CAT_META[cat] || { icon: '📰', color: 'var(--acc)', descZh: cat, descEn: cat };
            const on = enabledSet.has(cat);
            const isCustom = customTopicSet.has(cat);
            return (
              <span key={cat} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <button
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
                {isCustom ? (
                  <button className="chip" onClick={() => onRemoveTopic(cat)} style={{ cursor: 'pointer', color: 'var(--danger)' }}>
                    {pickLocaleText(locale, '移除', 'Remove')}
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={newTopic}
            onChange={(event) => setNewTopic(event.target.value)}
            placeholder={pickLocaleText(locale, '添加自定义主题范围，例如：半导体、能源、出海', 'Add custom topics such as semiconductor, energy, or expansion')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onAddTopic(newTopic.trim());
                setNewTopic('');
              }
            }}
            style={{ flex: 1, minWidth: isCompactViewport ? '100%' : 260, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12, outline: 'none' }}
          />
          <button className="btn btn-g" onClick={() => { onAddTopic(newTopic.trim()); setNewTopic(''); }} style={{ fontSize: 12, padding: '8px 14px' }}>
            {pickLocaleText(locale, '添加主题', 'Add Topic')}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '重点关键词', 'Focus Keywords')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(config.keywords || []).map((kw, index) => (
            <span key={`${kw}-${index}`} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {kw}
              <span style={{ cursor: 'pointer', color: 'var(--danger)' }} onClick={() => onRemoveKeyword(index)}>✕</span>
            </span>
          ))}
          {!(config.keywords || []).length ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pickLocaleText(locale, '暂未设置重点关键词', 'No focus keywords yet')}</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={newKw}
            onChange={(event) => setNewKw(event.target.value)}
            placeholder={pickLocaleText(locale, '输入要重点关注的主题词', 'Enter a keyword to prioritize')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onAddKeyword(newKw.trim());
                setNewKw('');
              }
            }}
            style={{ flex: 1, minWidth: isCompactViewport ? '100%' : 240, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12, outline: 'none' }}
          />
          <button className="btn btn-g" onClick={() => { onAddKeyword(newKw.trim()); setNewKw(''); }} style={{ fontSize: 12, padding: '8px 14px' }}>
            {pickLocaleText(locale, '添加关键词', 'Add Keyword')}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isCompactViewport ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '鲜度范围', 'Freshness')}</div>
          <select
            value={String(config.freshness_days || 0)}
            onChange={(event) => onPatch({ freshness_days: Number(event.target.value) })}
            style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12 }}
          >
            {FRESHNESS_OPTIONS.map((days) => (
              <option key={days} value={days}>{getFreshnessLabel(locale, days)}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '排序方式', 'Ranking')}</div>
          <select
            value={config.ranking_mode || 'balanced'}
            onChange={(event) => onPatch({ ranking_mode: event.target.value as SearchAdvancedConfig['ranking_mode'] })}
            style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12 }}
          >
            <option value="balanced">{pickLocaleText(locale, '平衡排序', 'Balanced')}</option>
            <option value="relevance">{pickLocaleText(locale, '相关度优先', 'Relevance First')}</option>
            <option value="freshness">{pickLocaleText(locale, '鲜度优先', 'Freshness First')}</option>
          </select>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '搜索深度', 'Search Depth')}</div>
          <select
            value={config.search_depth || 'standard'}
            onChange={(event) => onPatch({ search_depth: event.target.value as SearchAdvancedConfig['search_depth'] })}
            style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12 }}
          >
            <option value="focused">{pickLocaleText(locale, '聚焦模式', 'Focused')}</option>
            <option value="standard">{pickLocaleText(locale, '标准模式', 'Standard')}</option>
            <option value="broad">{pickLocaleText(locale, '扩展模式', 'Broad')}</option>
          </select>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '结果规模', 'Result Size')}</div>
          <input
            type="number"
            min={10}
            max={200}
            step={10}
            value={String(config.result_limit || 60)}
            onChange={(event) => onPatch({ result_limit: Number(event.target.value || 60) })}
            style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontSize: 12 }}
          />
        </div>


      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="tpl-go" onClick={onSave} style={{ fontSize: 12, padding: '8px 16px' }}>
          {pickLocaleText(locale, '保存高级搜索设置', 'Save Advanced Search Settings')}
        </button>
      </div>
    </div>
  );
}
