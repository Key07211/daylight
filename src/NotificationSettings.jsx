import { useEffect, useRef, useState } from 'react';
import { Bell, ExternalLink, LoaderCircle, Send } from 'lucide-react';
import { useI18n } from './i18n.jsx';
import './notification-settings.css';

export default function NotificationSettings({ enabled, onChange }) {
  const { lang, t } = useI18n();
  const bridge = window.daylightDesktop;
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [tested, setTested] = useState(false);
  const alive = useRef(false);
  const actionPending = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!bridge?.getNotificationStatus) return;
    let active = true;
    const refresh = () => bridge.getNotificationStatus()
      .then(next => { if (active) setStatus(next); })
      .catch(() => { if (active) setStatus(null); });
    const unsubscribe = bridge.onNotificationStatus?.(next => { if (active) setStatus(next); });
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; unsubscribe?.(); window.removeEventListener('focus', refresh); };
  }, [bridge, enabled]);

  async function perform(action, callback) {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(action);
    setError('');
    try { await callback(); }
    catch { if (alive.current) setError(t('操作未完成，请重试。', 'Could not complete this action. Please try again.')); }
    finally {
      actionPending.current = false;
      if (alive.current) setBusy(null);
    }
  }

  const state = !enabled ? 'off' : status?.state || 'unknown';
  const labels = {
    off: t('已关闭', 'Off'), ready: t('Windows 已允许', 'Allowed by Windows'),
    blocked: t('Windows 已关闭通知', 'Blocked by Windows'),
    unsupported: t('此环境不支持通知', 'Notifications unavailable'),
    disabled: status?.mode === 'development'
      ? t('请在 Windows 安装版中测试', 'Test in the installed Windows app')
      : t('预览中不发送通知', 'Disabled in preview'),
    unknown: t('系统状态待确认', 'System status unconfirmed'),
  };
  const delivery = tested && status?.lastDelivery?.kind === 'test' ? status.lastDelivery.state : null;
  const feedback = delivery === 'shown'
    ? t('已交给 Windows 显示。若未见横幅，请检查通知中心或勿扰模式。', 'Windows accepted the notification. If no banner appears, check Notification Center or Do Not Disturb.')
    : delivery === 'requested'
      ? t('已发送，正在等待 Windows 确认。', 'Sent; waiting for Windows to confirm.')
      : delivery === 'failed'
        ? t('Windows 未能显示通知，请检查系统通知设置。', 'Windows could not display the notification. Check system notification settings.')
        : null;

  return <section className="notification-settings">
    <h3><Bell size={17} />{t('桌面提醒', 'Desktop reminders')}</h3>
    <div className="setting-row">
      <div><strong>{t('Windows 桌面通知', 'Windows notifications')}</strong>
        <p>{t('到达提醒时间时，在桌面显示通知。', 'Show a desktop notification when a reminder is due.')}</p></div>
      <button type="button" role="switch" aria-checked={enabled}
        aria-label={t('Windows 桌面通知', 'Windows notifications')}
        className={`switch ${enabled ? 'on' : ''}`} disabled={!!busy}
        onClick={() => perform('toggle', async () => {
          await onChange(!enabled);
          if (alive.current) setTested(false);
        })}><span /></button>
    </div>
    {bridge?.getNotificationStatus && <>
      <div className="notification-state" data-state={state} role="status">
        <i aria-hidden="true" /><span>{labels[state] || labels.unknown}</span>
      </div>
      <div className="notification-actions">
        <button type="button" className="secondary" data-action="test-notification"
          disabled={!!busy || !enabled || !status?.supported || ['blocked', 'disabled'].includes(state)}
          onClick={() => perform('test', async () => {
            setTested(true);
            const next = await bridge.testNotification(lang);
            if (alive.current) setStatus(next);
          })}>
          {busy === 'test' ? <LoaderCircle size={15} className="notification-spinner" /> : <Send size={15} />}
          {t('发送测试通知', 'Send test notification')}
        </button>
        {status?.canOpenSettings && <button type="button" className="secondary"
          data-action="notification-settings" disabled={!!busy}
          onClick={() => perform('settings', () => bridge.openNotificationSettings())}>
          <ExternalLink size={15} />{t('Windows 通知设置', 'Windows notification settings')}
        </button>}
      </div>
      {state === 'blocked' && <p className="hint">{status?.systemState === 'disabled-policy'
        ? t('通知被系统策略关闭，请联系设备管理员。', 'Notifications are disabled by system policy. Contact your device administrator.')
        : t('请在 Windows 通知设置中开启通知，并允许 Daylight。', 'Enable notifications and allow Daylight in Windows notification settings.')}</p>}
    </>}
    {(feedback || error) && <p className={`notification-feedback ${error || delivery === 'failed' ? 'is-error' : ''}`}
      role={error || delivery === 'failed' ? 'alert' : 'status'}>{error || feedback}</p>}
    <p className="hint">{bridge
      ? t('关闭窗口后，托盘中的 Daylight 仍会提醒；电脑需保持唤醒。', 'Daylight can remind you from the system tray after the window closes. Keep your computer awake.')
      : t('提醒需要本地服务运行、电脑保持唤醒。', 'Reminders require the local service to be running and the computer to be awake.')}</p>
  </section>;
}
