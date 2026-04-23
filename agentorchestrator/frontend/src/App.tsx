import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  useStore,
  TAB_DEFS,
  startPolling,
  stopPolling,
  isAgentOrchestrator,
  isArchived,
  type TabKey,
} from './store';
import { api } from './api';
import { localeLabels, pickLocaleText } from './i18n';
import { subscribeThemeChange } from './theme';
import {
  Activity,
  Bot,
  Brain,
  Globe2,
  Languages,
  LayoutDashboard,
  Menu,
  MessageSquareMore,
  RefreshCcw,
  ScrollText,
  Sparkles,
  SunMoon,
  UserCircle2,
  Workflow,
  X,
} from 'lucide-react';
import AgentOrchestratorBoard from './components/AgentOrchestratorBoard';
import MonitorPanel from './components/MonitorPanel';
import AgentOverviewPanel from './components/OfficialPanel';
import SkillsConfig from './components/SkillsConfig';
import MemoryCenterPanel from './components/MemoryCenterPanel';
import WebSearchPanel from './components/WebSearchPanel';
import AutomationPanel from './components/AutomationPanel';
import TaskModal from './components/TaskModal';
import Toaster from './components/Toaster';
import AgentLogModal from './components/AgentLogModal';
import StartupTransition from './components/CourtCeremony';
import CollaborationDiscussion from './components/CourtDiscussion';
import SystemSettingsPanel from './components/SystemSettingsPanel';

type AuthBootState = 'loading' | 'ready';

type AuthView = {
  authenticated: boolean;
  mustChangePassword: boolean;
  currentUser: string;
  configuredUsername: string;
};

type PageMeta = {
  navLabel: string;
  navLabelEn: string;
  eyebrow: string;
  eyebrowEn: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
};

type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'primary' | 'success' | 'warning';
};

type BackdropParticle = {
  top: string;
  left: string;
  size: number;
  delay: string;
  duration: string;
  opacity: number;
};

const BACKDROP_PARTICLES: BackdropParticle[] = [
  { top: '10%', left: '12%', size: 4, delay: '-3s', duration: '18s', opacity: 0.32 },
  { top: '18%', left: '34%', size: 6, delay: '-8s', duration: '22s', opacity: 0.28 },
  { top: '14%', left: '72%', size: 5, delay: '-12s', duration: '19s', opacity: 0.24 },
  { top: '28%', left: '82%', size: 3, delay: '-2s', duration: '17s', opacity: 0.3 },
  { top: '38%', left: '16%', size: 5, delay: '-10s', duration: '24s', opacity: 0.22 },
  { top: '46%', left: '48%', size: 4, delay: '-6s', duration: '20s', opacity: 0.34 },
  { top: '54%', left: '68%', size: 7, delay: '-15s', duration: '26s', opacity: 0.2 },
  { top: '62%', left: '28%', size: 4, delay: '-4s', duration: '18s', opacity: 0.26 },
  { top: '72%', left: '78%', size: 5, delay: '-11s', duration: '23s', opacity: 0.24 },
  { top: '80%', left: '44%', size: 3, delay: '-1s', duration: '16s', opacity: 0.3 },
  { top: '84%', left: '14%', size: 6, delay: '-9s', duration: '21s', opacity: 0.2 },
  { top: '88%', left: '62%', size: 4, delay: '-13s', duration: '25s', opacity: 0.24 },
];

const DEFAULT_AUTH: AuthView = {
  authenticated: false,
  mustChangePassword: false,
  currentUser: '',
  configuredUsername: 'admin',
};

const NAV_ICON_MAP: Record<TabKey, typeof LayoutDashboard> = {
  tasks: LayoutDashboard,
  collaboration: MessageSquareMore,
  monitor: Activity,
  automation: Workflow,
  agents: Bot,
  skills: Sparkles,
  memory: Brain,
  web_search: Globe2,
};

const PAGE_META: Record<TabKey, PageMeta> = {
  tasks: {
    navLabel: '任务中枢',
    navLabelEn: 'Mission Hub',
    eyebrow: '任务总览',
    eyebrowEn: 'Task Overview',
    title: '统一查看状态与待办',
    titleEn: 'Review status and pending work in one place',
    description: '进入处理前先确认任务态势、同步状态与关键入口。',
    descriptionEn: 'Check task status, sync health, and key entry points before taking action.',
  },
  collaboration: {
    navLabel: '协作会议室',
    navLabelEn: 'Collaboration Room',
    eyebrow: '多人会商',
    eyebrowEn: 'Team Collaboration',
    title: '集中查看讨论、分流与会商结论',
    titleEn: 'Review discussion, routing, and meeting outcomes together',
    description: '把讨论上下文、协作负载与处理结论放在同一页面。',
    descriptionEn: 'Keep discussion context, collaboration load, and outcomes on the same page.',
  },
  monitor: {
    navLabel: '实时动态',
    navLabelEn: 'Live Updates',
    eyebrow: '系统态势',
    eyebrowEn: 'System Pulse',
    title: '统一查看系统动态与异常提醒',
    titleEn: 'Track live system updates and exceptions together',
    description: '集中查看活跃任务、同步状态与异常提示。',
    descriptionEn: 'Review active tasks, sync state, and exception alerts in one view.',
  },
  automation: {
    navLabel: '自动化控制台',
    navLabelEn: 'Automation Console',
    eyebrow: '规则与处置',
    eyebrowEn: 'Rules & Actions',
    title: '统一管理规则、触发器与处置动作',
    titleEn: 'Manage rules, triggers, and actions in one place',
    description: '在同一页面查看自动化规则、运行状态与执行入口。',
    descriptionEn: 'Review automation rules, runtime status, and execution entry points in one place.',
  },
  agents: {
    navLabel: 'Agent 管理工作台',
    navLabelEn: 'Agent Management Workbench',
    eyebrow: '组织能力',
    eyebrowEn: 'Organization',
    title: '统一管理角色、职责与编组状态',
    titleEn: 'Manage roles, responsibilities, and group status in one place',
    description: '查看 Agent 配置、模型分配、职责划分与运行状态。',
    descriptionEn: 'Review agent configuration, model assignment, responsibilities, and runtime status.',
  },
  skills: {
    navLabel: 'Skill 管理工作台',
    navLabelEn: 'Skill Management Workbench',
    eyebrow: '能力中枢',
    eyebrowEn: 'Capability Center',
    title: '统一管理 Skill 来源、挂载状态与专属会话',
    titleEn: 'Manage skill sources, mounted status, and dedicated conversations together',
    description: '在同一页面完成 Skill 查看、同步、管理与专属会话处理。',
    descriptionEn: 'Handle skill review, synchronization, management, and dedicated conversations on the same page.',
  },
  memory: {
    navLabel: '记忆中心',
    navLabelEn: 'Memory Center',
    eyebrow: '长期上下文',
    eyebrowEn: 'Long-Term Context',
    title: '统一整理全局记忆与 Agent 长期上下文',
    titleEn: 'Organize global memory and long-term agent context in one place',
    description: '集中维护偏好、规则、协作约束与 Agent 级别记忆。',
    descriptionEn: 'Maintain preferences, rules, collaboration constraints, and agent-level memory centrally.',
  },
  web_search: {
    navLabel: '全网搜索',
    navLabelEn: 'Web Search',
    eyebrow: '外部线索',
    eyebrowEn: 'External Signals',
    title: '统一处理外部检索、线索筛选与结果整理',
    titleEn: 'Handle external search, lead filtering, and result organization in one place',
    description: '在搜索页面完成资料采集、比对与结论沉淀。',
    descriptionEn: 'Collect sources, compare findings, and consolidate conclusions in the search workspace.',
  },
};

function MetricCard({ label, value, detail, tone = 'default' }: MetricCardProps) {
  return (
    <div className={`overview-metric overview-metric--${tone}`}>
      <div className="overview-metric__label">{label}</div>
      <div className="overview-metric__value">{value}</div>
      <div className="overview-metric__detail">{detail}</div>
    </div>
  );
}

function LoginScreen({
  defaultUsername,
  loading,
  error,
  onSubmit,
}: {
  defaultUsername: string;
  loading: boolean;
  error: string;
  onSubmit: (username: string, password: string) => Promise<void>;
}) {
  const locale = useStore((s) => s.locale);
  const [username, setUsername] = useState(defaultUsername || 'admin');
  const [password, setPassword] = useState('');

  useEffect(() => {
    setUsername(defaultUsername || 'admin');
  }, [defaultUsername]);

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card--brand">
        <div className="auth-badge">{pickLocaleText(locale, '账号登录', 'Account Sign-in')}</div>
        <h1 className="auth-title">{pickLocaleText(locale, 'Agent协同管理系统', 'Agent Helm')}</h1>
        <p className="auth-desc">
          {pickLocaleText(locale, '登录后即可进入统一工作空间，查看任务、协作、工作台与系统状态。首次登录需要先完成密码安全设置。', 'Sign in to access the unified workspace for tasks, collaboration, workbenches, and system status. On your first visit, you will need to complete the password security setup first.')}
        </p>
        <div className="auth-form">
          <label className="auth-label">
            <span>{pickLocaleText(locale, '用户名', 'Username')}</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={pickLocaleText(locale, '请输入用户名', 'Enter username')} />
          </label>
          <label className="auth-label">
            <span>{pickLocaleText(locale, '密码', 'Password')}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={pickLocaleText(locale, '请输入密码', 'Enter password')} />
          </label>
          {error ? <div className="auth-error">{error}</div> : null}
          <button className="auth-primary" disabled={loading} onClick={() => onSubmit(username.trim(), password)}>
              {loading ? pickLocaleText(locale, '登录中…', 'Signing in...') : pickLocaleText(locale, '进入工作台', 'Enter Workspace')}
          </button>
        </div>
        <div className="auth-footnote">
          {pickLocaleText(locale, '输入账号后进入工作区。', 'Sign in to enter the workspace.')}
        </div>
      </div>
    </div>
  );
}

function FirstChangeScreen({
  currentUser,
  loading,
  error,
  onSubmit,
}: {
  currentUser: string;
  loading: boolean;
  error: string;
  onSubmit: (currentPassword: string, newPassword: string, confirmPassword: string, newUsername: string) => Promise<void>;
}) {
  const locale = useStore((s) => s.locale);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newUsername, setNewUsername] = useState(currentUser);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    setNewUsername(currentUser);
  }, [currentUser]);

  const finalError = localError || error;

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card-wide auth-card--brand">
        <div className="auth-badge warn">{pickLocaleText(locale, '首次登录安全设置', 'Initial Security Setup')}</div>
        <h1 className="auth-title">{pickLocaleText(locale, '先完成 Agent协同管理系统的安全配置', 'Complete Agent Helm Security Setup')}</h1>
        <p className="auth-desc">
          {pickLocaleText(locale, '你已成功进入账号 ', 'You have signed in as ')}<strong>{currentUser || 'admin'}</strong>{pickLocaleText(locale, '。为了保护工作空间安全，请先设置新密码；如需调整用户名，也可以一并完成。', '. To protect the workspace, please set a new password first. You may also update the username in the same step if needed.')}
        </p>
        <div className="auth-form two-col">
          <label className="auth-label">
            <span>{pickLocaleText(locale, '新用户名（可选）', 'New username (optional)')}</span>
            <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={pickLocaleText(locale, '不修改可保持当前值', 'Leave unchanged to keep current value')} />
          </label>
          <label className="auth-label">
            <span>{pickLocaleText(locale, '当前密码', 'Current password')}</span>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder={pickLocaleText(locale, '请输入当前密码', 'Enter current password')} />
          </label>
          <label className="auth-label">
            <span>{pickLocaleText(locale, '新密码', 'New password')}</span>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={pickLocaleText(locale, '请输入新密码', 'Enter new password')} />
          </label>
          <label className="auth-label">
            <span>{pickLocaleText(locale, '确认新密码', 'Confirm new password')}</span>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={pickLocaleText(locale, '请再次输入新密码', 'Re-enter new password')} />
          </label>
          {finalError ? <div className="auth-error auth-full">{finalError}</div> : null}
          <button
            className="auth-primary auth-full"
            disabled={loading}
            onClick={() => {
              if (newPassword !== confirmPassword) {
                setLocalError(pickLocaleText(locale, '两次输入的新密码不一致', 'The two new passwords do not match'));
                return;
              }
              setLocalError('');
              onSubmit(currentPassword, newPassword, confirmPassword, newUsername.trim());
            }}
          >
            {loading ? pickLocaleText(locale, '保存中…', 'Saving...') : pickLocaleText(locale, '保存并进入中枢', 'Save and Enter Hub')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountModal({
  currentUser,
  onClose,
  onChangePassword,
  onChangeUsername,
  onLogout,
}: {
  currentUser: string;
  onClose: () => void;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  onChangeUsername: (currentPassword: string, newUsername: string) => Promise<string | null>;
  onLogout: () => Promise<void>;
}) {
  const locale = useStore((s) => s.locale);

  return (
    <div className="modal-bg">
      <div
        className="modal auth-settings-modal"
        style={{
          width: 'min(1120px, calc(100vw - 24px))',
          maxHeight: 'min(90vh, 1040px)',
          overflow: 'auto',
          paddingBottom: 20,
        }}
      >
        <button className="modal-close" onClick={onClose}>×</button>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <div className="modal-id">{pickLocaleText(locale, '中枢设置', 'Hub Settings')}</div>
          <SystemSettingsPanel
            currentUser={currentUser}
            onChangePassword={onChangePassword}
            onChangeUsername={onChangeUsername}
            onLogout={onLogout}
          />
          <div className="auth-settings-actions" style={{ justifyContent: 'flex-end' }}>
            <button className="btn-refresh" onClick={onClose}>{pickLocaleText(locale, '关闭', 'Close')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const toast = useStore((s) => s.toast);
  const dismissToast = useStore((s) => s.dismissToast);
  const liveStatus = useStore((s) => s.liveStatus);
  const loadAll = useStore((s) => s.loadAll);
  const locale = useStore((s) => s.locale);
  const toggleLocale = useStore((s) => s.toggleLocale);
  const themeMode = useStore((s) => s.themeMode);
  const resolvedTheme = useStore((s) => s.resolvedTheme);
  const cycleThemeMode = useStore((s) => s.cycleThemeMode);
  const refreshThemeFromSystem = useStore((s) => s.refreshThemeFromSystem);

  const [bootState, setBootState] = useState<AuthBootState>('loading');
  const [auth, setAuth] = useState<AuthView>(DEFAULT_AUTH);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [firstChangePending, setFirstChangePending] = useState(false);
  const [firstChangeError, setFirstChangeError] = useState('');
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showAgentLogModal, setShowAgentLogModal] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileTopbarHidden, setMobileTopbarHidden] = useState(false);
  const [controlCenterChatOpen, setControlCenterChatOpen] = useState(false);
  const [controlCenterDraft, setControlCenterDraft] = useState('');
  const [controlCenterSending, setControlCenterSending] = useState(false);
  const [controlCenterLastTaskId, setControlCenterLastTaskId] = useState('');
  const mainContentRef = useRef<HTMLElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const mobileTopbarVisibleStyle = mobileTopbarHidden
    ? undefined
    : {
        transform: 'translateY(0)',
        opacity: 1,
        pointerEvents: 'auto' as const,
      };

  const refreshAuth = async () => {
    const res = await api.authStatus();
    setAuth({
      authenticated: !!res.authenticated,
      mustChangePassword: !!res.mustChangePassword,
      currentUser: String(res.currentUser || ''),
      configuredUsername: String(res.username || 'admin'),
    });
    setBootState('ready');
    return res;
  };

  const handleManualRefresh = async () => {
    const loadingToastId = toast(
      pickLocaleText(locale, '正在同步最新任务、状态与配置…', 'Syncing the latest tasks, status and configuration…'),
      'loading',
      { title: pickLocaleText(locale, '刷新中', 'Refreshing') },
    );
    try {
      await loadAll();
      dismissToast(loadingToastId);
      toast(
        pickLocaleText(locale, '数据已刷新到最新状态。', 'Data has been refreshed to the latest state.'),
        'success',
        { title: pickLocaleText(locale, '刷新完成', 'Refresh complete') },
      );
    } catch {
      dismissToast(loadingToastId);
      toast(
        pickLocaleText(locale, '刷新失败，请稍后重试或查看 Agent 排错日志。', 'Refresh failed. Please retry later or inspect the Agent diagnostic logs.'),
        'warning',
        { title: pickLocaleText(locale, '刷新未完成', 'Refresh incomplete') },
      );
    }
  };

  const submitControlCenterMessage = async () => {
    const request = controlCenterDraft.trim();
    if (!request || controlCenterSending) return;

    setControlCenterSending(true);
    try {
      const result = await api.createTask({
        title: `${pickLocaleText(locale, '总控中心｜', 'Control Center | ')}${request.replace(/\s+/g, ' ').slice(0, 40)}`,
        org: pickLocaleText(locale, '总控中心', 'Control Center'),
        targetDept: 'admin_specialist',
        targetDepts: ['admin_specialist'],
        priority: 'normal',
        params: {
          source: 'floating_control_center_chat',
          request,
          summary: request,
        },
      });

      if (!result.ok) {
        toast(result.error || pickLocaleText(locale, '消息发送失败，请稍后重试', 'Failed to send the message. Please try again later.'), 'err');
        return;
      }

      const latestTaskId = result.taskId || '';
      setControlCenterLastTaskId(latestTaskId);
      setControlCenterDraft('');
      setControlCenterChatOpen(true);
      toast(
        result.message || pickLocaleText(locale, `已提交到总控中心 ${latestTaskId}`.trim(), `Delivered to the Control Center ${latestTaskId}`.trim()),
        'ok',
      );
      if (latestTaskId) setModalTaskId(latestTaskId);
      await loadAll();
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    } finally {
      setControlCenterSending(false);
    }
  };

  useEffect(() => {
    refreshAuth().catch(() => {
      setBootState('ready');
      setAuth(DEFAULT_AUTH);
    });
  }, []);

  useEffect(() => {
    if (!auth.authenticated || auth.mustChangePassword) {
      stopPolling();
      return;
    }
    startPolling();
    loadAll();
    return () => stopPolling();
  }, [auth.authenticated, auth.mustChangePassword, loadAll]);

  useEffect(() => subscribeThemeChange(() => refreshThemeFromSystem()), [refreshThemeFromSystem]);
  useEffect(() => setMobileNavOpen(false), [activeTab]);
  useEffect(() => {
    if (!mobileNavOpen) return;

    const closeMobileNav = () => setMobileNavOpen(false);
    const handleScroll = () => {
      if (window.innerWidth <= 1180) closeMobileNav();
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [activeTab, mobileNavOpen]);

  useEffect(() => {
    const contentNode = mainContentRef.current;
    const isPhoneViewport = () => window.innerWidth <= 900;
    const readScrollTop = () => {
      const containerScrollTop = contentNode?.scrollTop || 0;
      const pageScrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
      const rootScrollTop = document.scrollingElement?.scrollTop || 0;
      return Math.max(containerScrollTop, pageScrollTop, rootScrollTop);
    };

    const syncTopbar = () => {
      if (!isPhoneViewport()) {
        lastScrollTopRef.current = 0;
        setMobileTopbarHidden(false);
        return;
      }

      const nextScrollTop = readScrollTop();
      const lastScrollTop = lastScrollTopRef.current;
      const delta = nextScrollTop - lastScrollTop;

      if (mobileNavOpen) {
        setMobileTopbarHidden(false);
      } else if (nextScrollTop <= 24 || delta < -6) {
        setMobileTopbarHidden(false);
      } else if (nextScrollTop > 56 && delta > 10) {
        setMobileTopbarHidden(true);
      }

      lastScrollTopRef.current = nextScrollTop;
    };

    const resetTopbar = () => {
      lastScrollTopRef.current = readScrollTop();
      setMobileTopbarHidden(false);
    };

    resetTopbar();
    window.addEventListener('scroll', syncTopbar, { passive: true });
    contentNode?.addEventListener('scroll', syncTopbar, { passive: true });
    window.addEventListener('resize', resetTopbar);

    return () => {
      window.removeEventListener('scroll', syncTopbar);
      contentNode?.removeEventListener('scroll', syncTopbar);
      window.removeEventListener('resize', resetTopbar);
    };
  }, [activeTab, mobileNavOpen]);

  const tasks = liveStatus?.tasks || [];
  const taskBoardItems = tasks.filter(isAgentOrchestrator);
  const activeTaskBoardItems = taskBoardItems.filter((t) => !isArchived(t));
  const sync = liveStatus?.syncStatus;
  const syncOk = sync?.ok;
  const doingTasks = activeTaskBoardItems.filter((t) => t.state === 'Doing').length;
  const blockedTasks = activeTaskBoardItems.filter((t) => t.state === 'Blocked').length;
  const reviewTasks = activeTaskBoardItems.filter((t) => ['Review', 'ReviewCenter'].includes(t.state)).length;
  const doneTasks = taskBoardItems.filter((t) => t.state === 'Done').length;
  const collaborationLoad = activeTaskBoardItems.filter((t) => ['Doing', 'Assigned', 'Review', 'ReviewCenter'].includes(t.state)).length;
  const completionRate = taskBoardItems.length ? Math.round((doneTasks / taskBoardItems.length) * 100) : 0;

  const authSubtitle = useMemo(() => {
    if (auth.currentUser) return locale === 'en' ? `${auth.currentUser} is online in Agent Helm` : `${auth.currentUser} 已进入 Agent协同管理系统`;
    return locale === 'en' ? 'Welcome to Agent Helm' : '欢迎使用 Agent协同管理系统';
  }, [auth.currentUser, locale]);

  const themeBadgeText = useMemo(() => pickLocaleText(
    locale,
    themeMode === 'system' ? `主题：跟随系统 / ${resolvedTheme === 'dark' ? '夜间' : '日间'}` : themeMode === 'dark' ? '主题：夜间' : '主题：日间',
    themeMode === 'system' ? `Theme: System / ${resolvedTheme === 'dark' ? 'Dark' : 'Light'}` : themeMode === 'dark' ? 'Theme: Dark' : 'Theme: Light',
  ), [locale, themeMode, resolvedTheme]);

  const pageMeta = PAGE_META[activeTab] || PAGE_META.tasks;
  const navigationTabs = useMemo(() => TAB_DEFS.filter((tab) => NAV_ICON_MAP[tab.key]), []);
  const ActiveContextIcon = NAV_ICON_MAP[activeTab] || LayoutDashboard;

  const overviewMetrics = [
    {
      label: pickLocaleText(locale, '活跃任务', 'Active Missions'),
      value: String(activeTaskBoardItems.length),
      detail: pickLocaleText(locale, '当前仍在流转或待处理的事项总量', 'Open items still in motion or awaiting action'),
      tone: 'primary' as const,
    },
    {
      label: pickLocaleText(locale, '处理中', 'In Progress'),
      value: String(doingTasks),
      detail: pickLocaleText(locale, '已进入执行环节的任务数量', 'Tasks already in the execution stage'),
      tone: 'default' as const,
    },
    {
      label: pickLocaleText(locale, '待核对', 'Under Review'),
      value: String(reviewTasks),
      detail: pickLocaleText(locale, '等待核对、整理或复核的任务', 'Tasks waiting for checking, wrap-up, or review'),
      tone: 'warning' as const,
    },
    {
      label: pickLocaleText(locale, '已完成率', 'Completion Rate'),
      value: `${completionRate}%`,
      detail: pickLocaleText(locale, '基于全部任务样本统计的完成比例', 'Completion ratio calculated across all mission records'),
      tone: 'success' as const,
    },
  ];

  const renderActivePanel = () => {
    if (activeTab === 'tasks') return <AgentOrchestratorBoard />;
    if (activeTab === 'collaboration') return <CollaborationDiscussion />;
    if (activeTab === 'monitor') return <MonitorPanel />;
    if (activeTab === 'automation') return <AutomationPanel />;
    if (activeTab === 'agents') return <AgentOverviewPanel />;
    if (activeTab === 'skills') return <SkillsConfig />;
    if (activeTab === 'memory') return <MemoryCenterPanel />;
    if (activeTab === 'web_search') return <WebSearchPanel />;
    return null;
  };

  if (bootState === 'loading') {
    return (
      <div className="auth-shell">
        <div className="auth-card auth-card--brand">
          <div className="auth-title">{pickLocaleText(locale, '正在检查登录状态…', 'Checking sign-in status...')}</div>
          <p className="auth-desc">{pickLocaleText(locale, '正在确认当前登录状态与账号安全配置。', 'Checking your current sign-in status and account security configuration.')}</p>
        </div>
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <LoginScreen
        defaultUsername={auth.configuredUsername}
        loading={loginPending}
        error={loginError}
        onSubmit={async (username, password) => {
          setLoginPending(true);
          setLoginError('');
          const res = await api.login(username || auth.configuredUsername || 'admin', password);
          if (!res.ok) {
            setLoginError(res.error || pickLocaleText(locale, '登录失败', 'Login failed'));
            setLoginPending(false);
            return;
          }
          await refreshAuth();
          setLoginPending(false);
        }}
      />
    );
  }

  if (auth.mustChangePassword) {
    return (
      <FirstChangeScreen
        currentUser={auth.currentUser || auth.configuredUsername || 'admin'}
        loading={firstChangePending}
        error={firstChangeError}
        onSubmit={async (currentPassword, newPassword, _confirmPassword, newUsername) => {
          setFirstChangePending(true);
          setFirstChangeError('');
          const res = await api.firstChange(currentPassword, newPassword, newUsername || undefined);
          if (!res.ok) {
            setFirstChangeError(res.error || pickLocaleText(locale, '保存失败', 'Save failed'));
            setFirstChangePending(false);
            return;
          }
          await refreshAuth();
          setFirstChangePending(false);
        }}
      />
    );
  }

  return (
    <div className="app-shell app-shell-modern">
      <div className="scene-backdrop" aria-hidden="true">
        <div className="scene-grid" />
        <div className="scene-particle-layer">
          {BACKDROP_PARTICLES.map((particle, index) => (
            <span
              key={`${particle.top}-${particle.left}-${index}`}
              className="scene-particle"
              style={{
                top: particle.top,
                left: particle.left,
                '--particle-size': `${particle.size}px`,
                '--particle-delay': particle.delay,
                '--particle-duration': particle.duration,
                '--particle-opacity': particle.opacity,
              } as CSSProperties}
            />
          ))}
        </div>
        <div className="scene-ring scene-ring--a" />
        <div className="scene-ring scene-ring--b" />
        <div className="scene-orb orb-a" />
        <div className="scene-orb orb-b" />
        <div className="scene-orb orb-c" />
        <div className="scene-noise" />
      </div>

      <div className={`workspace-frame ${mobileNavOpen ? 'nav-open' : ''}`}>
        <div className={`workspace-overlay ${mobileNavOpen ? 'visible' : ''}`} onClick={() => setMobileNavOpen(false)} />

        <aside id="workspace-mobile-sidebar" className={`workspace-sidebar ${mobileNavOpen ? 'visible' : ''}`}>
          <div className="workspace-brand">
            <div className="workspace-brand__main">
              <div className="workspace-brand__mark-wrap" aria-hidden="true">
                <div className="workspace-brand__halo" />
                <div className="workspace-brand__mark">
                  <span className="workspace-brand__mark-ring" />
                  <span className="workspace-brand__mark-core" />
                  <span className="workspace-brand__mark-dot" />
                </div>
              </div>
              <div className="workspace-brand__copy">
                <div className="workspace-brand__title-row">
                  <div className="workspace-brand__title">{pickLocaleText(locale, 'Agent协同管理系统', 'Agent Helm')}</div>
                  <span className="workspace-brand__status">{pickLocaleText(locale, '在线', 'Online')}</span>
                </div>
                <div className="workspace-brand__subtitle">{pickLocaleText(locale, '统一调度、协作与执行入口', 'Unified hub for control, collaboration, and execution')}</div>
              </div>
            </div>
          </div>

          <nav className="workspace-nav">
            {navigationTabs.map((tab) => {
              const Icon = NAV_ICON_MAP[tab.key];
              const currentMeta = PAGE_META[tab.key] || PAGE_META.tasks;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  className={`workspace-nav__item ${isActive ? 'is-active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <span className="workspace-nav__icon"><Icon size={18} /></span>
                  <span className="workspace-nav__text">
                    <span className="workspace-nav__title">{locale === 'en' ? currentMeta.navLabelEn : currentMeta.navLabel}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="workspace-sidebar__footer">
            <div className={`chip ${syncOk ? 'ok' : syncOk === false ? 'err' : 'warn'}`}>
              {syncOk ? pickLocaleText(locale, '连接正常', 'Connected') : syncOk === false ? pickLocaleText(locale, '连接异常', 'Unavailable') : pickLocaleText(locale, '连接中', 'Connecting')}
            </div>
          </div>
        </aside>

        <div className="workspace-main">
          <header className={`workspace-topbar ${mobileTopbarHidden ? 'is-collapsed' : ''}`} style={mobileTopbarVisibleStyle}>
            <div className="workspace-topbar__left">
              <button
                className={`icon-button icon-button--mobile-nav mobile-nav-toggle mobile-only ${mobileNavOpen ? 'is-active' : ''}`}
                onClick={() => setMobileNavOpen((value) => !value)}
                aria-label={pickLocaleText(locale, '切换导航菜单', 'Toggle navigation menu')}
                aria-expanded={mobileNavOpen}
                aria-controls="workspace-mobile-sidebar"
              >
                <span className="icon-button--mobile-nav__icon" aria-hidden="true">{mobileNavOpen ? <X size={17} /> : <Menu size={17} />}</span>
              </button>
              <div className="workspace-context">
                <div className="workspace-context__logo workspace-context__logo--section" aria-hidden="true"><ActiveContextIcon size={18} /></div>
                <div className="workspace-context__copy">
                  <div className="workspace-context__kicker">{locale === 'en' ? pageMeta.eyebrowEn : pageMeta.eyebrow}</div>
                  <div className="workspace-context__title">{locale === 'en' ? pageMeta.navLabelEn : pageMeta.navLabel}</div>
                  <div className="workspace-context__subtitle workspace-context__subtitle--topbar">{locale === 'en' ? pageMeta.titleEn : pageMeta.title}</div>
                </div>
              </div>
            </div>
            <div className="workspace-topbar__right">
              <button className="icon-button" onClick={() => void handleManualRefresh()} title={pickLocaleText(locale, '刷新数据', 'Refresh data')}><RefreshCcw size={16} /></button>
              <button className="icon-button" onClick={() => setShowAgentLogModal(true)} title={pickLocaleText(locale, '打开 Agent 排错日志', 'Open Agent diagnostic logs')}><ScrollText size={17} /></button>
              <button className="icon-button" onClick={() => setShowAccountModal(true)} title={pickLocaleText(locale, '打开账号与系统设置', 'Open account and system settings')}><UserCircle2 size={18} /></button>
            </div>
          </header>

          <main ref={mainContentRef} className="workspace-content">
            <section key={activeTab} className="workspace-panel-shell page-stage page-stage--enter">
              {renderActivePanel()}
            </section>
          </main>


        </div>
      </div>

      <TaskModal />
      <Toaster />
      <AgentLogModal open={showAgentLogModal} locale={locale} onClose={() => setShowAgentLogModal(false)} />
      <StartupTransition />

      {showAccountModal ? (
        <AccountModal
          currentUser={auth.currentUser || auth.configuredUsername || 'admin'}
          onClose={() => setShowAccountModal(false)}
          onChangePassword={async (currentPassword, newPassword) => {
            const res = await api.changePassword(currentPassword, newPassword);
            if (!res.ok) return res.error || pickLocaleText(locale, '密码修改失败', 'Password update failed');
            return res.message || pickLocaleText(locale, '密码已更新', 'Password updated');
          }}
          onChangeUsername={async (currentPassword, newUsername) => {
            const res = await api.changeUsername(currentPassword, newUsername);
            if (!res.ok) return res.error || pickLocaleText(locale, '用户名修改失败', 'Username update failed');
            await refreshAuth();
            return res.message || pickLocaleText(locale, '用户名已更新', 'Username updated');
          }}
          onLogout={async () => {
            stopPolling();
            await api.logout();
            setShowAccountModal(false);
            setAuth({
              authenticated: false,
              mustChangePassword: false,
              currentUser: '',
              configuredUsername: auth.configuredUsername,
            });
            await refreshAuth();
          }}
        />
      ) : null}

      <div className={`floating-control-chat ${controlCenterChatOpen ? 'is-open' : ''}`}>
        {controlCenterChatOpen ? (
          <section className="floating-control-chat__panel" aria-label={pickLocaleText(locale, '总控中心悬浮消息面板', 'Floating Control Center chat panel')}>
            <div className="floating-control-chat__header">
              <div className="floating-control-chat__identity">
                <div className="floating-control-chat__avatar" aria-hidden="true">
                  <MessageSquareMore size={18} />
                </div>
                <div>
                  <div className="floating-control-chat__eyebrow">{pickLocaleText(locale, '总控中心', 'Control Center')}</div>
                  <div className="floating-control-chat__title">{pickLocaleText(locale, '给总控中心发消息', 'Message the Control Center')}</div>
                </div>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setControlCenterChatOpen(false)}
                aria-label={pickLocaleText(locale, '收起总控中心聊天窗', 'Collapse the Control Center chat window')}
              >
                <X size={16} />
              </button>
            </div>

            <div className="floating-control-chat__body">
              <div className="floating-control-chat__capsules" aria-hidden="true">
                <span className="floating-control-chat__capsule">{pickLocaleText(locale, '调度', 'Routing')}</span>
                <span className="floating-control-chat__capsule">{pickLocaleText(locale, '修正', 'Fix')}</span>
                <span className="floating-control-chat__capsule">{pickLocaleText(locale, '同步', 'Sync')}</span>
              </div>
              <p className="floating-control-chat__hint">
                {pickLocaleText(locale, '直接提交事项。', 'Send a request directly.')}
              </p>
              <textarea
                className="floating-control-chat__textarea"
                value={controlCenterDraft}
                onChange={(e) => setControlCenterDraft(e.target.value)}
                placeholder={pickLocaleText(locale, '输入需要处理的事项', 'Enter the request to handle')}
                rows={5}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void submitControlCenterMessage();
                  }
                }}
              />
            </div>

            <div className="floating-control-chat__footer">
              <div className="floating-control-chat__meta">
                <span className="chip ok">{pickLocaleText(locale, '实时派发', 'Real-time routing')}</span>
                {controlCenterLastTaskId ? (
                  <button type="button" className="chip" onClick={() => setModalTaskId(controlCenterLastTaskId)}>
                    {pickLocaleText(locale, `查看任务 ${controlCenterLastTaskId}`.trim(), `Open task ${controlCenterLastTaskId}`.trim())}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                className="floating-control-chat__send"
                onClick={() => void submitControlCenterMessage()}
                disabled={!controlCenterDraft.trim() || controlCenterSending}
              >
                {controlCenterSending
                  ? pickLocaleText(locale, '发送中…', 'Sending...')
                  : pickLocaleText(locale, '发送', 'Send')}
              </button>
            </div>
          </section>
        ) : null}

        <button
          type="button"
          className="floating-control-chat__launcher"
          onClick={() => setControlCenterChatOpen((value) => !value)}
          aria-expanded={controlCenterChatOpen}
          aria-label={controlCenterChatOpen ? pickLocaleText(locale, '关闭总控中心聊天组件', 'Close the Control Center chat widget') : pickLocaleText(locale, '打开总控中心聊天组件', 'Open the Control Center chat widget')}
        >
          <span className="floating-control-chat__launcher-ping" aria-hidden="true" />
          <span className="floating-control-chat__launcher-icon"><MessageSquareMore size={18} /></span>
        </button>
      </div>
    </div>
  );
}
