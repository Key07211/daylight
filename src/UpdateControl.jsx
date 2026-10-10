import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, Check, Download, ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useI18n } from './i18n.jsx';
import './update-control.css';

const busyStates = new Set(['checking', 'downloading', 'waiting', 'installing']);
const visibleStates = new Set(['available', 'downloading', 'waiting', 'installing', 'error']);

export function useAppUpdate() {
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(null);
  const statusRef = useRef(null);
  const actionRef = useRef(false);
  const activeRef = useRef(false);
  const bridge = typeof window !== 'undefined' ? window.daylightDesktop : null;
  const supported = !!(bridge?.getUpdateStatus && bridge?.checkForUpdates && bridge?.downloadUpdate);
  const applyStatus = useCallback(next => {
    if (!activeRef.current || !next?.state) return;
    if ((next.revision ?? 0) < (statusRef.current?.revision ?? 0)) return;
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    if (!supported) return () => { activeRef.current = false; };
    const unsubscribe = bridge.onUpdateStatus?.(applyStatus);
    bridge.getUpdateStatus().then(applyStatus).catch(() => {
      if (!statusRef.current) applyStatus({ state: 'error', mode: 'installed', errorCode: 'status', revision: 0 });
    });
    return () => { activeRef.current = false; unsubscribe?.(); };
  }, [bridge, supported, applyStatus]);

  const run = useCallback(async (method, action) => {
    if (!supported || actionRef.current) return;
    const revision = statusRef.current?.revision ?? 0;
    actionRef.current = true;
    setPending(action);
    try {
      applyStatus(await bridge[method]());
    } catch {
      // A newer native event takes precedence over a late IPC failure.
      if ((statusRef.current?.revision ?? 0) <= revision) {
        applyStatus({ ...statusRef.current, state: 'error', errorCode: action, revision });
      }
    } finally {
      actionRef.current = false;
      if (activeRef.current) setPending(null);
    }
  }, [bridge, supported, applyStatus]);

  return {
    status, pending, supported,
    check: useCallback(() => run('checkForUpdates', 'check'), [run]),
    download: useCallback(() => run('downloadUpdate', 'download'), [run]),
  };
}

function progressPercent(status) {
  const value = typeof status?.progress === 'number' ? status.progress : status?.progress?.percent;
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function statusCopy(status, t) {
  switch (status?.state) {
    case 'checking': return t('正在检查更新…', 'Checking for updates…');
    case 'current': return t('已是最新版本', 'You’re up to date');
    case 'available': return status.mode === 'portable'
      ? t('新版本可供下载', 'A new version is available') : t('有可用更新', 'Update available');
    case 'downloading': return t('正在下载更新…', 'Downloading update…');
    case 'waiting': {
      const reasons = status.reasons || [];
      if (reasons.includes('editing') && reasons.includes('running')) {
        return t('更新已下载。保存或关闭编辑，并等待任务结束后立即重启。', 'Update downloaded. Save or close your edit and let the active task finish to restart immediately.');
      }
      if (reasons.includes('editing')) return t('更新已下载。保存或关闭编辑后立即重启。', 'Update downloaded. Save or close your edit to restart immediately.');
      if (reasons.includes('running')) return t('更新已下载。当前任务结束后立即重启。', 'Update downloaded. Restarting as soon as the active task finishes.');
      return t('更新已下载。正在准备重启…', 'Update downloaded. Preparing to restart…');
    }
    case 'installing': return t('正在重启并安装更新…', 'Restarting to install the update…');
    case 'error': return status.errorCode === 'install_failed'
      ? t('安装未完成，请重试。', 'Installation did not finish. Please try again.') : /download/i.test(status.errorCode || '')
      ? t('下载未完成，请重试。', 'Download did not finish. Please try again.')
      : t('暂时无法获取更新，请重试。', 'Updates are unavailable right now. Please try again.');
    case 'disabled': return t('安装版支持自动更新', 'Automatic updates are available in the installed app');
    default: return t('自动检查新版本', 'Automatically checks for new versions');
  }
}

function UpdateProgress({ status, t }) {
  const percent = progressPercent(status);
  return <div className="update-download-progress">
    <div className="update-progress-label"><span>{t('下载进度', 'Download progress')}</span><strong>{percent}%</strong></div>
    <div className="update-progress-track" role="progressbar" aria-label={t('更新下载进度', 'Update download progress')}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span style={{ width: `${percent}%` }} />
    </div>
  </div>;
}

function UpdateAction({ update, t }) {
  const { status, pending, download, check } = update;
  const portable = status?.mode === 'portable';
  if (status?.state !== 'available' && status?.state !== 'error') return null;
  const canDownload = !!status?.version;
  const retryInstall = status?.errorCode === 'install_failed' && !portable;
  return <button type="button" className="update-primary" data-update-action={canDownload ? 'download' : 'check'}
    disabled={!!pending} onClick={canDownload ? download : check}>
    {pending ? <LoaderCircle size={15} className="update-spinner" /> : retryInstall ? <RefreshCw size={15} /> : portable ? <ExternalLink size={15} /> : canDownload ? <Download size={15} /> : <RefreshCw size={15} />}
    {retryInstall ? t('重试安装并重启', 'Retry install & restart') : canDownload ? portable ? t('下载便携版', 'Download portable version')
      : t('下载并立即重启', 'Download & restart immediately') : t('重新检查', 'Check again')}
  </button>;
}

function releaseText(notes) {
  if (typeof notes === 'string') return notes.trim().slice(0, 2400);
  if (Array.isArray(notes)) return notes.map(note => typeof note === 'string' ? note : note?.note || '').join('\n').trim().slice(0, 2400);
  return '';
}

export function UpdateIndicator({ update }) {
  const { t } = useI18n();
  const { status, supported } = update;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 68, left: 12, width: 340 });
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const titleId = useId();
  const panelId = useId();
  const visible = !!(supported && status && status.state !== 'disabled' && status.mode !== 'disabled'
    && (status.state !== 'error' || status.version));
  const label = statusCopy(status, t);
  const downloading = status?.state === 'downloading';
  const spinning = ['checking', 'waiting', 'installing'].includes(status?.state);
  const percent = progressPercent(status);
  const notes = releaseText(status?.releaseNotes);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  useLayoutEffect(() => {
    if (!open || !visible) return;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(340, window.innerWidth - 24);
      const height = panelRef.current?.getBoundingClientRect().height || 200;
      const below = anchor.bottom + 10;
      setPosition({
        width,
        left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)),
        top: Math.max(12, below + height > window.innerHeight - 12 ? anchor.top - height - 10 : below),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, visible]);

  useEffect(() => {
    if (!open || !visible) return;
    panelRef.current?.querySelector('button[data-update-action], button')?.focus();
    const onPointer = event => {
      if (!panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) close();
    };
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, visible, close]);

  if (!visible || (!visibleStates.has(status.state) && !open)) return null;

  return <>
    <button ref={triggerRef} type="button" className={`update-indicator ${downloading ? 'is-downloading' : ''}`}
      data-testid="update-indicator" data-state={status.state} aria-label={downloading ? `${label} ${percent}%` : label}
      title={downloading ? `${label} ${percent}%` : label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => setOpen(value => !value)}>
      {downloading ? <svg className="update-progress-ring" viewBox="0 0 32 32" aria-hidden="true">
        <circle className="update-ring-track" cx="16" cy="16" r="12" />
        <circle className="update-ring-value" cx="16" cy="16" r="12" pathLength="100" strokeDasharray={`${percent} 100`} />
      </svg> : null}
      <span className="update-blue-dot" aria-hidden="true">{spinning ? <LoaderCircle size={13} className="update-spinner" />
        : status.state === 'current' ? <Check size={12} /> : <ArrowDown size={12} />}</span>
    </button>
    <span className="update-sr-only" role="status" aria-live="polite">{label}</span>
    {open && createPortal(<section ref={panelRef} className="update-popover" role="dialog" aria-labelledby={titleId} id={panelId}
      data-testid="update-popover" data-state={status.state} style={position}>
      <div className="update-popover-heading">
        <h3 id={titleId}>{status.version ? `Daylight ${status.version}` : t('Daylight 更新', 'Daylight updates')}</h3>
        <button type="button" className="update-close" aria-label={t('关闭', 'Close')} onClick={() => close(true)}><X size={16} /></button>
      </div>
      <p className="update-status-copy" role="status">{label}</p>
      {notes && status.state === 'available' && <p className="update-release-notes">{notes}</p>}
      {downloading && <UpdateProgress status={status} t={t} />}
      <UpdateAction update={update} t={t} />
      {status.state === 'available' && <p className="update-small-note">{status.mode === 'portable'
        ? t('打开下载页面，手动替换便携版。', 'Open the download page to replace the portable app manually.')
        : t('下载完成后立即重启。任务与设置会保留。', 'Restarts immediately after download. Tasks and settings are kept.')}</p>}
    </section>, document.body)}
  </>;
}

export function UpdateSettings({ update }) {
  const { t } = useI18n();
  const { status, supported, pending, check } = update;
  if (!supported) return null;
  const disabled = !status || status.state === 'disabled' || status.mode === 'disabled';
  const busy = busyStates.has(status?.state) || !!pending;
  return <section className="update-settings" data-testid="update-settings" data-state={status?.state || 'loading'}>
    <div className="update-settings-heading">
      <div><h3>{t('应用更新', 'App updates')}</h3>
        {status?.currentVersion && <span className="update-version">Daylight {status.currentVersion}</span>}</div>
      <button type="button" className="secondary" data-update-action="check" onClick={check} disabled={disabled || busy}>
        <RefreshCw size={14} className={status?.state === 'checking' ? 'update-spinner' : ''} />{t('检查更新', 'Check for updates')}
      </button>
    </div>
    <p className="update-status-copy" role="status">{status ? statusCopy(status, t) : t('正在读取更新状态…', 'Loading update status…')}
      {status?.state === 'available' && status.version ? ` · ${status.version}` : ''}</p>
    {status?.state === 'downloading' && <UpdateProgress status={status} t={t} />}
    <UpdateAction update={update} t={t} />
    {!disabled && !visibleStates.has(status?.state) && <p className="update-small-note">{t('启动后及每 6 小时自动检查。由你点击下载。', 'Checks at startup and every 6 hours. Downloads only when you click.')}</p>}
  </section>;
}
