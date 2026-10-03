import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, CircleAlert, RefreshCw, Plug, LoaderCircle } from 'lucide-react';
import { useI18n } from './i18n.jsx';
import './mcp-connection.css';

export function useMcpConnection() {
  const [status, setStatus] = useState(null);
  const applyStatus = useCallback(next => setStatus(previous =>
    (next?.revision ?? 0) < (previous?.revision ?? 0) ? previous : next), []);
  useEffect(() => {
    const desktop = window.daylightDesktop;
    if (!desktop?.getMcpStatus) return;
    let active = true;
    const update = next => { if (active) applyStatus(next); };
    const unsubscribe = desktop.onMcpStatus?.(update);
    desktop.getMcpStatus().then(update).catch(() => update({ state: 'error', canConfigure: true }));
    return () => { active = false; unsubscribe?.(); };
  }, [applyStatus]);
  const run = async method => {
    try { const next = await method(); applyStatus(next); }
    catch { setStatus(previous => ({ ...previous, state: 'error', checking: false })); }
  };
  return { status, connect: () => run(() => window.daylightDesktop.installMcp()),
    check: () => run(() => window.daylightDesktop.checkMcp()),
    setAutoConnect: enabled => run(() => window.daylightDesktop.setMcpAutoConnect(enabled)) };
}

export default function McpConnection({ connection, compact = false }) {
  const { t } = useI18n();
  const { status, connect, check, setAutoConnect } = connection;
  const ready = status?.state === 'ready';
  const checking = status?.checking;
  const label = checking ? t('正在检查连接', 'Checking connection') : ready ? t('Codex 工具已就绪', 'Codex tools ready')
    : status?.state === 'disabled' ? t('MCP 已停用', 'MCP disabled')
    : status?.state === 'conflict' ? t('连接配置需调整', 'Connection needs attention')
    : status?.state === 'unavailable' ? t('Codex 暂不可用', 'Codex unavailable')
    : status?.state === 'error' ? t('连接测试未通过', 'Connection test failed') : t('尚未连接 Codex', 'Connect Codex');
  const detail = ready ? t(`已验证 ${status.toolCount} 个任务工具，Codex 可通过 MCP 访问这份清单。`, `${status.toolCount} task tools verified. Codex can access this list through MCP.`)
    : status?.state === 'conflict' ? t('Codex 中已有不同的 Daylight 配置，请在 Codex 的 MCP 设置中调整。', 'A different Daylight entry exists. Review it in Codex MCP settings.')
    : status?.state === 'disabled' ? t('请先在 Codex 的 MCP 设置中启用 Daylight。', 'Enable Daylight in Codex MCP settings first.')
    : status?.state === 'unavailable' ? t('安装或更新本机 Codex 后，重新打开清单即可连接。', 'Install or update local Codex, then reopen Daylight.')
    : status?.state === 'error' ? t('请保持清单运行，然后重新检查连接。', 'Keep Daylight running, then check the connection again.')
    : t('自动配置本机 Codex，让它直接管理这份清单。', 'Connect local Codex to manage this task list directly.');
  return <section className={`mcp-connection ${compact ? 'mcp-compact' : ''}`} data-testid="mcp-connection" data-state={status?.state || 'missing'}>
    <div className="mcp-connection-heading"><span className="mcp-connection-icon"><Bot size={20} /></span>
      <div><h3>{label}</h3><p>{detail}</p></div>
      {checking ? <LoaderCircle size={18} className="spin" /> : ready ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
    </div>
    {ready && !compact && <p className="mcp-session-note">{t('首次连接后，在 Codex 中打开新聊天即可使用。', 'After the first connection, open a new Codex chat to use the tools.')}</p>}
    {status?.preview && <p className="mcp-session-note">{ready ? t('当前连接：桌面预览清单', 'Connected list: desktop preview') : t('示例窗口不修改 Codex 连接配置。', 'The sample window does not change Codex connections.')}</p>}
    <div className="mcp-connection-actions">
      <button type="button" className="secondary" data-mcp-action={ready ? 'check' : 'connect'} disabled={!status?.canConfigure || checking}
        onClick={ready ? check : connect}>{ready ? <RefreshCw size={14} /> : <Plug size={14} />}{ready ? t('检查连接', 'Check connection') : t('连接 Codex', 'Connect Codex')}</button>
      {!compact && <label className="mcp-auto-connect"><input type="checkbox" data-mcp-auto-connect checked={!!status?.autoConnect}
        disabled={!status?.canConfigure || checking} onChange={event => setAutoConnect(event.target.checked)} />{t('启动时自动连接', 'Connect on startup')}</label>}
    </div>
  </section>;
}
