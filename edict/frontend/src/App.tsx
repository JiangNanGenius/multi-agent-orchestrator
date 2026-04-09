import { useEffect, useMemo, useState } from 'react';
import { useStore, TAB_DEFS, startPolling, stopPolling, isEdict, isArchived, tabLabel } from './store';
import { api } from './api';
import { localeLabels, pickLocaleText } from './i18n';
import EdictBoard from './components/EdictBoard';
import MonitorPanel from './components/MonitorPanel';
import AgentOverviewPanel from './components/OfficialPanel';
import ModelConfig from './components/ModelConfig';
import SkillsConfig from './components/SkillsConfig';
import SessionsPanel from './components/SessionsPanel';
import ArchivePanel from './components/MemorialPanel';
import TemplatePanel from './components/TemplatePanel';
import WebSearchPanel from './components/WebSearchPanel';
import AutomationPanel from './components/AutomationPanel';
import TaskModal from './components/TaskModal';
import Toaster from './components/Toaster';
import StartupTransition from './components/CourtCeremony'; // 待同步文件名为 StartupTransition
import CollaborationDiscussion from './components/CourtDiscussion'; // 待同步文件名为 CollaborationDiscussion
import SystemSettingsPanel from './components/SystemSettingsPanel';

type AuthBootState = 'loading' | 'ready';

type AuthView = {
  authenticated: boolean;
  mustChangePassword: boolean;
  currentUser: string;
  configuredUsername: string;
};

const DEFAULT_AUTH: AuthView = {
  authenticated: false,
  mustChangePassword: false,
  currentUser: '',
  configuredUsername: 'admin',
};

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
      <div className="auth-card">
        <div className="auth-badge">{pickLocaleText(locale, '欢迎回来', 'Welcome Back')}</div>
        <h1 className="auth-title">{pickLocaleText(locale, '智能协作工作台', 'Smart Workspace')}</h1>
        <p className="auth-desc">
          {pickLocaleText(locale, '请输入你的账号信息后继续。首次进入时需要先设置一个新密码；如需调整用户名，也可以现在或稍后修改。', 'Sign in with your account to continue. The first time you sign in, you will be asked to set a new password. You can also update your username now or later.')}
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
          <button
            className="auth-primary"
            disabled={loading}
            onClick={() => onSubmit(username.trim(), password)}
          >
            {loading ? pickLocaleText(locale, '登录中…', 'Signing in...') : pickLocaleText(locale, '进入工作台', 'Continue')}
          </button>
        </div>
        <div className="auth-footnote">
          {pickLocaleText(locale, '如果忘记了登录信息，可以联系负责同事帮你协助处理。', 'If you forget your sign-in details, contact the person in charge for help.')}
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
      <div className="auth-card auth-card-wide">
        <div className="auth-badge warn">{pickLocaleText(locale, '请先完善登录信息', 'One More Step')}</div>
        <h1 className="auth-title">{pickLocaleText(locale, '先完成安全设置', 'Complete Security Setup')}</h1>
        <p className="auth-desc">
          {pickLocaleText(locale, '你已成功进入账号 ', 'You have signed in to ')}<strong>{currentUser || 'admin'}</strong>{pickLocaleText(locale, '。为了保护账号安全，请先设置一个新密码。用户名', '. For your account safety, please set a new password before continuing. Changing the username is ')}<strong>{pickLocaleText(locale, '可选的', 'optional')}</strong>{pickLocaleText(locale, '，密码更新', ', while the password update is ')}<strong>{pickLocaleText(locale, '必须完成', 'required')}</strong>。
        </p>
        <div className="auth-form two-col">
          <label className="auth-label">
            <span>{pickLocaleText(locale, '新用户名（可选修改）', 'New username (optional)')}</span>
            <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={pickLocaleText(locale, '不改可保持当前用户名', 'Leave unchanged to keep current username')} />
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
            {loading ? pickLocaleText(locale, '保存中…', 'Saving...') : pickLocaleText(locale, '保存并继续', 'Save and Continue')}
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
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newUsername, setNewUsername] = useState(currentUser);
  const [pwdMsg, setPwdMsg] = useState('');
  const [nameMsg, setNameMsg] = useState('');
  const [busy, setBusy] = useState<'password' | 'username' | 'logout' | ''>('');

  useEffect(() => {
    setNewUsername(currentUser);
  }, [currentUser]);

  return (
    <div className="modal-bg">
      <div className="modal auth-settings-modal">
        <button className="modal-close" onClick={onClose}>×</button>
        <div className="modal-id">{pickLocaleText(locale, '我的设置', 'My Settings')}</div>
        <div className="modal-title">{pickLocaleText(locale, '账号与登录', 'Account & Sign-in')}</div>
        <div className="auth-settings-meta">
          <span className="chip ok">{pickLocaleText(locale, '当前用户：', 'Current user: ')}{currentUser}</span>
        </div>

        <div className="auth-settings-grid">
          <div className="auth-settings-panel">
            <div className="m-sec-label">{pickLocaleText(locale, '更改用户名', 'Change Username')}</div>
            <label className="auth-label">
              <span>当前密码</span>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="请输入当前密码" />
            </label>
            <label className="auth-label">
              <span>{pickLocaleText(locale, '新用户名', 'New username')}</span>
              <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={pickLocaleText(locale, '请输入新用户名', 'Enter new username')} />
            </label>
            {nameMsg ? <div className="auth-tip">{nameMsg}</div> : null}
            <button
              className="btn-refresh"
              disabled={busy !== ''}
              onClick={async () => {
                setBusy('username');
                const msg = await onChangeUsername(currentPassword, newUsername.trim());
                setNameMsg(msg || pickLocaleText(locale, '用户名已更新', 'Username updated'));
                setBusy('');
              }}
            >
              {busy === 'username' ? pickLocaleText(locale, '保存中…', 'Saving...') : pickLocaleText(locale, '保存用户名', 'Save Username')}
            </button>
          </div>

          <div className="auth-settings-panel">
            <div className="m-sec-label">{pickLocaleText(locale, '更改密码', 'Change Password')}</div>
            <label className="auth-label">
              <span>新密码</span>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="请输入新密码" />
            </label>
            <label className="auth-label">
              <span>确认新密码</span>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="请再次输入新密码" />
            </label>
            {pwdMsg ? <div className="auth-tip">{pwdMsg}</div> : null}
            <button
              className="btn-refresh"
              disabled={busy !== ''}
              onClick={async () => {
                if (newPassword !== confirmPassword) {
                  setPwdMsg(pickLocaleText(locale, '两次输入的新密码不一致', 'The two new passwords do not match'));
                  return;
                }
                setBusy('password');
                const msg = await onChangePassword(currentPassword, newPassword);
                setPwdMsg(msg || pickLocaleText(locale, '密码已更新', 'Password updated'));
                setBusy('');
                setNewPassword('');
                setConfirmPassword('');
              }}
            >
              {busy === 'password' ? pickLocaleText(locale, '保存中…', 'Saving...') : pickLocaleText(locale, '保存密码', 'Save Password')}
            </button>
          </div>
        </div>

        <div className="auth-settings-actions">
          <button
            className="btn-refresh"
            disabled={busy !== ''}
            onClick={async () => {
              setBusy('logout');
              await onLogout();
              setBusy('');
            }}
          >
            {busy === 'logout' ? pickLocaleText(locale, '退出中…', 'Signing out...') : pickLocaleText(locale, '退出登录', 'Sign Out')}
          </button>
          <button className="btn-refresh" onClick={onClose}>{pickLocaleText(locale, '关闭', 'Close')}</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const liveStatus = useStore((s) => s.liveStatus);
  const countdown = useStore((s) => s.countdown);
  const loadAll = useStore((s) => s.loadAll);
  const locale = useStore((s) => s.locale);
  const toggleLocale = useStore((s) => s.toggleLocale);

  const [bootState, setBootState] = useState<AuthBootState>('loading');
  const [auth, setAuth] = useState<AuthView>(DEFAULT_AUTH);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [firstChangePending, setFirstChangePending] = useState(false);
  const [firstChangeError, setFirstChangeError] = useState('');
  const [showAccountModal, setShowAccountModal] = useState(false);

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

  const tasks = liveStatus?.tasks || [];
  const taskBoardItems = tasks.filter(isEdict);
  const activeTaskBoardItems = taskBoardItems.filter((t) => !isArchived(t));
  const sync = liveStatus?.syncStatus;
  const syncOk = sync?.ok;

  const tabBadge = (key: string): string => {
    if (key === 'tasks') return String(activeTaskBoardItems.length);
    if (key === 'sessions') return String(tasks.filter((t) => !isEdict(t)).length);
    if (key === 'archives') return String(taskBoardItems.filter((t) => ['Done', 'Cancelled'].includes(t.state)).length);
    if (key === 'monitor') {
      const activeDepts = tasks.filter((t) => isEdict(t) && t.state === 'Doing').length;
      return locale === 'en' ? `${activeDepts} active` : activeDepts + '活跃';
    }
    if (key === 'automation') {
      const enabled = tasks.filter((t) => isEdict(t) && !isArchived(t) && (t as { _scheduler?: { enabled?: boolean } })._scheduler?.enabled !== false).length;
      return locale === 'en' ? `${enabled} auto` : enabled + '自动';
    }
    return '';
  };

  const authSubtitle = useMemo(() => {
    if (auth.currentUser) return locale === 'en' ? `${auth.currentUser} is signed in` : `${auth.currentUser} 已进入工作台`;
    return locale === 'en' ? `Welcome` : `欢迎使用`;
  }, [auth.currentUser, auth.configuredUsername, locale]);

  if (bootState === 'loading') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-title">{pickLocaleText(locale, '正在检查登录状态…', 'Checking sign-in status...')}</div>
          <p className="auth-desc">{pickLocaleText(locale, '正在确认当前登录状态与账号安全设置。', 'Checking your current sign-in status and account security settings.')}</p>
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

  const renderActivePanel = () => {
    if (activeTab === 'tasks') return <EdictBoard />;
    if (activeTab === 'collaboration') return <CollaborationDiscussion />;
    if (activeTab === 'monitor') return <MonitorPanel />;
    if (activeTab === 'automation') return <AutomationPanel />;
    if (activeTab === 'agents') return <AgentOverviewPanel />;
    if (activeTab === 'models') return <ModelConfig />;
    if (activeTab === 'skills') return <SkillsConfig />;
    if (activeTab === 'sessions') return <SessionsPanel />;
    if (activeTab === 'archives') return <ArchivePanel />;
    if (activeTab === 'templates') return <TemplatePanel />;
    if (activeTab === 'web_search') return <WebSearchPanel />;
    if (activeTab === 'system_settings') {
      return (
        <SystemSettingsPanel
          currentUser={auth.currentUser || auth.configuredUsername || 'admin'}
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
            setAuth({
              authenticated: false,
              mustChangePassword: false,
              currentUser: '',
              configuredUsername: auth.configuredUsername,
            });
            await refreshAuth();
          }}
        />
      );
    }
    return null;
  };

  return (
    <div className="app-shell">
      <div className="scene-backdrop" aria-hidden="true">
        <div className="scene-grid" />
        <div className="scene-orb orb-a" />
        <div className="scene-orb orb-b" />
        <div className="scene-orb orb-c" />
        <div className="scene-noise" />
      </div>
      <div className="wrap">
      <div className="hdr">
        <div>
          <div className="logo">{pickLocaleText(locale, '智能协作工作台', 'Smart Workspace')}</div>
          <div className="sub-text">{pickLocaleText(locale, '把搜索、讨论、处理和结果整理放到同一个工作台里', 'Search, discuss, handle work, and organize results in one place')}</div>
        </div>
        <div className="hdr-r">
          <span className={`chip ${syncOk ? 'ok' : syncOk === false ? 'err' : ''}`}>
            {syncOk ? pickLocaleText(locale, '✅ 连接正常', '✅ Connected') : syncOk === false ? pickLocaleText(locale, '❌ 当前暂不可用', '❌ Currently unavailable') : pickLocaleText(locale, '⏳ 连接中…', '⏳ Connecting...')}
          </span>
          <span className="chip">{locale === 'en' ? `${activeTaskBoardItems.length} tasks` : `${activeTaskBoardItems.length} 个任务`}</span>
          <span className="chip">{authSubtitle}</span>
          <button className="btn-refresh" onClick={toggleLocale} title={localeLabels[locale].switchTo}>
            {localeLabels[locale].short}
          </button>
          <button className="btn-refresh" onClick={() => loadAll()}>
            {pickLocaleText(locale, '⟳ 刷新', '⟳ Refresh')}
          </button>
          <button className="btn-refresh" onClick={() => setActiveTab('system_settings')}>
            {pickLocaleText(locale, '我的设置', 'My Settings')}
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>⟳ {countdown}s</span>
        </div>
      </div>

      <div className="tabs tabs-glass">
        {TAB_DEFS.map((t) => (
          <div
            key={t.key}
            className={`tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.icon} {tabLabel(t, locale)}
            {tabBadge(t.key) && <span className="tbadge">{tabBadge(t.key)}</span>}
          </div>
        ))}
      </div>

      <div key={activeTab} className="page-stage">
        {renderActivePanel()}
      </div>

      <TaskModal />
      <Toaster />
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
      </div>
    </div>
  );
}
