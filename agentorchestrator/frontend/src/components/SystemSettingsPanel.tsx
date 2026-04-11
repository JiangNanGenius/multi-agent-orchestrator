import { useEffect, useMemo, useState } from 'react';
import { api, type SystemSettings } from '../api';
import { localeLabels, pickLocaleText } from '../i18n';
import { useStore } from '../store';

type Props = {
  currentUser: string;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  onChangeUsername: (currentPassword: string, newUsername: string) => Promise<string | null>;
  onLogout: () => Promise<void>;
};

const DEFAULT_SETTINGS: SystemSettings = {
  scan_record_retention_days: 7,
};

function clampRetentionDays(value: number) {
  if (!Number.isFinite(value)) return 7;
  return Math.max(1, Math.min(30, Math.round(value)));
}

const cardStyle: React.CSSProperties = {
  padding: 18,
  borderRadius: 20,
  border: '1px solid var(--line)',
  background: 'var(--panel2)',
  display: 'grid',
  gap: 16,
  minWidth: 0,
  boxSizing: 'border-box',
};

const subCardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.03)',
  display: 'grid',
  gap: 12,
  minWidth: 0,
  boxSizing: 'border-box',
};

const helperTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--muted)',
  lineHeight: 1.75,
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
};

export default function SystemSettingsPanel({
  currentUser,
  onChangePassword,
  onChangeUsername,
  onLogout,
}: Props) {
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);
  const toast = useStore((s) => s.toast);

  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState(currentUser);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nameMsg, setNameMsg] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [busy, setBusy] = useState<'username' | 'password' | 'logout' | ''>('');

  useEffect(() => {
    setNewUsername(currentUser);
  }, [currentUser]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.systemSettings()
      .then((result) => {
        if (cancelled) return;
        setSettings({
          scan_record_retention_days: clampRetentionDays(Number(result.scan_record_retention_days || 7)),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSettings(DEFAULT_SETTINGS);
        toast(pickLocaleText(locale, '系统设置读取失败，已使用默认值', 'Failed to load system settings. Default values are used.'), 'err');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, toast]);

  const retentionDays = clampRetentionDays(Number(settings.scan_record_retention_days || 7));
  const retentionLabel = useMemo(() => {
    return pickLocaleText(locale, `当前保留 ${retentionDays} 天`, `Currently keeping ${retentionDays} day(s)`);
  }, [locale, retentionDays]);

  const saveSystemSettings = async () => {
    setSavingSettings(true);
    try {
      const payload = {
        scan_record_retention_days: retentionDays,
      };
      const result = await api.saveSystemSettings(payload);
      if (!result.ok) {
        toast(result.error || pickLocaleText(locale, '系统设置保存失败', 'Failed to save system settings'), 'err');
        return;
      }
      setSettings(result.settings || payload);
      toast(result.message || pickLocaleText(locale, '系统设置已保存', 'System settings saved'), 'ok');
    } catch {
      toast(pickLocaleText(locale, '当前连接失败，请稍后再试', 'Connection failed. Please try again later.'), 'err');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 18, minWidth: 0 }}>
      <section
        style={{
          padding: 22,
          borderRadius: 24,
          border: '1px solid rgba(126, 146, 255, 0.24)',
          background: 'linear-gradient(135deg, rgba(68,110,255,0.14), rgba(160,122,255,0.12) 55%, rgba(58,208,182,0.09))',
          display: 'grid',
          gap: 16,
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'rgba(232,236,255,0.72)', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }}>
            {pickLocaleText(locale, '系统设置中枢', 'System Settings Command')}
          </div>
          <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.2 }}>
            {pickLocaleText(locale, '统一管理系统偏好、记录策略与账号安全', 'Manage system preferences, record policy, and account security from one command layer')}
          </div>
          <div style={{ ...helperTextStyle, maxWidth: 920 }}>
            {pickLocaleText(
              locale,
              '在这里统一管理语言、记录策略、用户名、密码和会话控制。',
              'Manage language, record policy, username, password, and session controls here.',
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, minWidth: 0 }}>
          <div className="kpi" style={{ minWidth: 0 }}>
            <div className="kpi-v" style={{ color: 'var(--acc)' }}>{retentionDays}</div>
            <div className="kpi-l">{pickLocaleText(locale, '巡检保留天数', 'Retention Days')}</div>
          </div>
          <div className="kpi" style={{ minWidth: 0 }}>
            <div className="kpi-v" style={{ color: '#7be0ff', fontSize: 18, paddingTop: 6 }}>{localeLabels[locale].current}</div>
            <div className="kpi-l">{pickLocaleText(locale, '当前界面语言', 'Current Language')}</div>
          </div>
          <div className="kpi" style={{ minWidth: 0 }}>
            <div className="kpi-v" style={{ color: '#c4b5fd', fontSize: 18, paddingTop: 6 }}>{currentUser || 'admin'}</div>
            <div className="kpi-l">{pickLocaleText(locale, '当前账号', 'Current Account')}</div>
          </div>
        </div>

        <div style={actionRowStyle}>
          <span className="chip ok">{retentionLabel}</span>
          <span className="chip">{pickLocaleText(locale, `当前用户：${currentUser || 'admin'}`, `Current user: ${currentUser || 'admin'}`)}</span>
          <span className="chip">{pickLocaleText(locale, '移动端布局已优化', 'Mobile layout optimized')}</span>
        </div>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          alignItems: 'start',
          minWidth: 0,
        }}
      >
        <section style={cardStyle}>
          <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{pickLocaleText(locale, '系统偏好', 'System Preferences')}</div>
            <div style={helperTextStyle}>
              {pickLocaleText(locale, '优先处理界面语言和巡检记录策略。所有控件均采用自然换行与自适应栅格，避免窄屏下出现横向滚动。', 'This section focuses on interface language and scan retention policy. Controls now use natural wrapping and adaptive grids to avoid horizontal scrolling on narrow screens.')}
            </div>
          </div>

          <div style={subCardStyle}>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{pickLocaleText(locale, '界面语言', 'Interface Language')}</div>
              <div style={helperTextStyle}>
                {pickLocaleText(locale, '切换主界面、导航和控制台的核心文案。当前偏好会即时生效，并在下次进入时继续保留。', 'Switch the core copy across the workspace, navigation, and command surfaces. The preference takes effect immediately and persists for the next session.')}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, minWidth: 0 }}>
              {(['zh', 'en'] as const).map((option) => {
                const active = locale === option;
                return (
                  <button
                    key={option}
                    className="btn-refresh"
                    onClick={() => {
                      setLocale(option);
                      toast(option === 'en' ? 'Language switched to English' : '语言已切换为中文', 'ok');
                    }}
                    style={{
                      width: '100%',
                      fontSize: 12,
                      padding: '11px 14px',
                      borderColor: active ? 'rgba(104, 130, 255, 0.7)' : undefined,
                      boxShadow: active ? '0 0 0 1px rgba(104, 130, 255, 0.25) inset' : undefined,
                      background: active ? 'rgba(104, 130, 255, 0.12)' : undefined,
                    }}
                  >
                    {localeLabels[option].current}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={subCardStyle}>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{pickLocaleText(locale, '巡检记录策略', 'Scan Record Policy')}</div>
              <div style={helperTextStyle}>
                {pickLocaleText(locale, '控制“检查进度”产生的巡检记录默认保留多久。该策略属于系统级行为，因此集中在这里维护。', 'Control how long scan records generated by “Check Progress” are kept by default. This is a system-level policy and is therefore maintained here.')}
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{pickLocaleText(locale, '巡检记录保留天数', 'Scan record retention days')}</div>
              <input
                type="number"
                min={1}
                max={30}
                step={1}
                value={String(retentionDays)}
                onChange={(event) => setSettings((prev) => ({ ...prev, scan_record_retention_days: clampRetentionDays(Number(event.target.value || 7)) }))}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '12px 14px',
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  color: 'var(--text)',
                  fontSize: 13,
                  minWidth: 0,
                }}
              />
              <div style={helperTextStyle}>
                {pickLocaleText(locale, '默认保留 7 天；最少 1 天，最多 30 天。超过保留期的历史记录会在本地展示时自动清理。', 'The default is 7 days; the minimum is 1 day and the maximum is 30 days. Records older than the retention window are automatically cleaned up when rendered locally.')}
              </div>
            </div>
          </div>

          <div style={{ ...actionRowStyle, justifyContent: 'flex-end' }}>
            <button className="tpl-go" onClick={saveSystemSettings} disabled={savingSettings || loading} style={{ fontSize: 12, padding: '10px 18px' }}>
              {savingSettings ? pickLocaleText(locale, '保存中…', 'Saving...') : pickLocaleText(locale, '保存系统设置', 'Save System Settings')}
            </button>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{pickLocaleText(locale, '账号与安全', 'Account and Security')}</div>
            <div style={helperTextStyle}>
              {pickLocaleText(locale, '把用户名、密码与退出登录动作整合在一块安全面板里，并通过分段卡片减少视觉拥挤。', 'Username, password, and sign-out controls are grouped into one security surface with segmented cards to reduce visual crowding.')}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
            <div style={subCardStyle}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{pickLocaleText(locale, '修改用户名', 'Change Username')}</div>
              <label className="auth-label">
                <span>{pickLocaleText(locale, '当前密码', 'Current password')}</span>
                <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={pickLocaleText(locale, '请输入当前密码', 'Enter current password')} />
              </label>
              <label className="auth-label">
                <span>{pickLocaleText(locale, '新用户名', 'New username')}</span>
                <input value={newUsername} onChange={(event) => setNewUsername(event.target.value)} placeholder={pickLocaleText(locale, '请输入新用户名', 'Enter new username')} />
              </label>
              {nameMsg ? <div className="auth-tip">{nameMsg}</div> : null}
              <div style={{ ...actionRowStyle, justifyContent: 'flex-end' }}>
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
            </div>

            <div style={subCardStyle}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{pickLocaleText(locale, '修改密码与会话', 'Password and Session')}</div>
              <label className="auth-label">
                <span>{pickLocaleText(locale, '新密码', 'New password')}</span>
                <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={pickLocaleText(locale, '请输入新密码', 'Enter new password')} />
              </label>
              <label className="auth-label">
                <span>{pickLocaleText(locale, '确认新密码', 'Confirm new password')}</span>
                <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={pickLocaleText(locale, '请再次输入新密码', 'Re-enter new password')} />
              </label>
              {pwdMsg ? <div className="auth-tip">{pwdMsg}</div> : null}
              <div style={{ ...actionRowStyle, justifyContent: 'space-between' }}>
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
          </div>
        </section>
      </div>
    </div>
  );
}
