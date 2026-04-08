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
import CourtCeremony from './components/CourtCeremony';
import CourtDiscussion from './components/CourtDiscussion';

type AuthBootState = 'loading' | 'ready';

type AuthView = {
  authenticated: boolean;
  mustChangePassword: boolean;
  currentUser: string;
  configuredUsername: string;
  authFile?: string;
};

const DEFAULT_AUTH: AuthView = {
  authenticated: false,
  mustChangePassword: false,
  currentUser: '',
  configuredUsername: 'admin',
  authFile: '',
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
        <div className="auth-badge">{pickLocaleText(locale, '看板登录', 'Dashboard Login')}</div>
        <h1 className="auth-title">{pickLocaleText(locale, '多Agent智作中枢', 'Multi-Agent Orchestrator')}</h1>
        <p className="auth-desc">
          {pickLocaleText(locale, '看板已启用账号密码认证。默认账号为 ', 'This dashboard uses username-password authentication. The default account is ')}<strong>admin</strong>{pickLocaleText(locale, '，首次登录必须修改密码；用户名可在首次登录时一并修改，也可稍后再改。', '. You must change the password on first login. The username can be changed during first login or later in account settings.')}
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
            {loading ? pickLocaleText(locale, '登录中…', 'Signing in...') : pickLocaleText(locale, '登录进入看板', 'Sign In')}
          </button>
        </div>
        <div className="auth-footnote">
          {pickLocaleText(locale, '若删除认证文件，系统将恢复默认账号密码 ', 'If the auth file is removed, the system resets to the default credentials ')}<code>admin / admin</code>。
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
        <div className="auth-badge warn">{pickLocaleText(locale, '首次登录强制改密', 'Password Change Required')}</div>
        <h1 className="auth-title">{pickLocaleText(locale, '请先更新登录信息', 'Update Your Credentials')}</h1>
        <p className="auth-desc">
          {pickLocaleText(locale, '当前账号 ', 'The current account ')}<strong>{currentUser || 'admin'}</strong>{pickLocaleText(locale, ' 已通过认证，但系统要求你在首次登录后立即修改密码。用户名为', ' is authenticated, but the system requires an immediate password change on first login. Username change is ')}<strong>{pickLocaleText(locale, '可选修改', 'optional')}</strong>{pickLocaleText(locale, '，密码为', ', while password change is ')}<strong>{pickLocaleText(locale, '必须修改', 'required')}</strong>。
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
            {loading ? pickLocaleText(locale, '保存中…', 'Saving...') : pickLocaleText(locale, '保存并进入看板', 'Save and Continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountModal({
  currentUser,
  authFile,
  onClose,
  onChangePassword,
  onChangeUsername,
  onLogout,
}: {
  currentUser: string;
  authFile?: string;
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
        <div className="modal-id">{pickLocaleText(locale, '账号设置', 'Account Settings')}</div>
        <div className="modal-title">{pickLocaleText(locale, '登录凭据与认证文件管理', 'Credentials and Auth File Management')}</div>
        <div className="auth-settings-meta">
          <span className="chip ok">{pickLocaleText(locale, '当前用户：', 'Current user: ')}{currentUser}</span>
          {authFile ? <span className="chip">{pickLocaleText(locale, '认证文件：', 'Auth file: ')}{authFile}</span> : null}
        </div>

        <div className="auth-settings-grid">
          <div className="auth-settings-panel">
            <div className="m-sec-label">{pickLocaleText(locale, '修改用户名', 'Change Username')}</div>
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
            <div className="m-sec-label">{pickLocaleText(locale, '修改密码', 'Change Password')}</div>
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
      authFile: res.authFile || '',
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
      return locale === 'en' ? `${enabled} automated` : enabled + '托管';
    }
    return '';
  };

  const authSubtitle = useMemo(() => {
    if (auth.currentUser) return locale === 'en' ? `Current user: ${auth.currentUser}` : `当前用户：${auth.currentUser}`;
    return locale === 'en' ? `Configured user: ${auth.configuredUsername || 'admin'}` : `已配置用户：${auth.configuredUsername || 'admin'}`;
  }, [auth.currentUser, auth.configuredUsername, locale]);

  if (bootState === 'loading') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-title">{pickLocaleText(locale, '正在检查登录状态…', 'Checking sign-in status...')}</div>
          <p className="auth-desc">{pickLocaleText(locale, '系统正在确认当前会话与首登改密要求。', 'The system is validating the current session and first-login password policy.')}</p>
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
    <div className="wrap">
      <div className="hdr">
        <div>
          <div className="logo">{pickLocaleText(locale, '多Agent智作中枢', 'Multi-Agent Orchestrator')}</div>
          <div className="sub-text">{pickLocaleText(locale, 'Multi-Agent Orchestrator · 中文默认部署与多阶段任务治理', 'Multi-Agent Orchestrator · AI-assisted deployment and multi-stage task governance')}</div>
        </div>
        <div className="hdr-r">
          <span className={`chip ${syncOk ? 'ok' : syncOk === false ? 'err' : ''}`}>
            {syncOk ? pickLocaleText(locale, '✅ 同步正常', '✅ Sync OK') : syncOk === false ? pickLocaleText(locale, '❌ 服务器未启动', '❌ Server offline') : pickLocaleText(locale, '⏳ 连接中…', '⏳ Connecting...')}
          </span>
          <span className="chip">{locale === 'en' ? `${activeTaskBoardItems.length} tasks` : `${activeTaskBoardItems.length} 个任务`}</span>
          <span className="chip">{authSubtitle}</span>
          <button className="btn-refresh" onClick={toggleLocale} title={localeLabels[locale].switchTo}>
            {localeLabels[locale].short}
          </button>
          <button className="btn-refresh" onClick={() => loadAll()}>
            {pickLocaleText(locale, '⟳ 刷新', '⟳ Refresh')}
          </button>
          <button className="btn-refresh" onClick={() => setShowAccountModal(true)}>
            {pickLocaleText(locale, '账号设置', 'Account')}
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>⟳ {countdown}s</span>
        </div>
      </div>

      <div className="tabs">
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

      {activeTab === 'tasks' && <EdictBoard />}
      {activeTab === 'court' && <CourtDiscussion />}
      {activeTab === 'monitor' && <MonitorPanel />}
      {activeTab === 'automation' && <AutomationPanel />}
      {activeTab === 'agents' && <AgentOverviewPanel />}
      {activeTab === 'models' && <ModelConfig />}
      {activeTab === 'skills' && <SkillsConfig />}
      {activeTab === 'sessions' && <SessionsPanel />}
      {activeTab === 'archives' && <ArchivePanel />}
      {activeTab === 'templates' && <TemplatePanel />}
      {activeTab === 'web_search' && <WebSearchPanel />}

      <TaskModal />
      <Toaster />
      <CourtCeremony />

      {showAccountModal ? (
        <AccountModal
          currentUser={auth.currentUser || auth.configuredUsername || 'admin'}
          authFile={auth.authFile}
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
              authFile: auth.authFile,
            });
            await refreshAuth();
          }}
        />
      ) : null}
    </div>
  );
}
