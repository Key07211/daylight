import { useCallback, useEffect, useState } from 'react';
import { Asterisk, Bot, CheckCircle2, CircleAlert, RefreshCw, Plug, LoaderCircle } from 'lucide-react';
import { useI18n } from './i18n.jsx';
import './mcp-connection.css';

const bridges = {
  codex: { get: 'getMcpStatus', subscribe: 'onMcpStatus', connect: 'installMcp', check: 'checkMcp', auto: 'setMcpAutoConnect' },
  claude: { get: 'getClaudeStatus', subscribe: 'onClaudeStatus', connect: 'connectClaude', check: 'checkClaude', auto: 'setClaudeAutoConnect' },
};

export function useMcpConnection(client = 'codex') {
  const bridge = bridges[client];
  const [status, setStatus] = useState(null);
  const applyStatus = useCallback(next => setStatus(previous =>
    (next?.revision ?? 0) < (previous?.revision ?? 0) ? previous : next), []);
  useEffect(() => {
    const desktop = window.daylightDesktop;
    if (!desktop?.[bridge.get]) return;
    let active = true;
    const update = next => { if (active) applyStatus(next); };
    const unsubscribe = desktop[bridge.subscribe]?.(update);
    desktop[bridge.get]().then(update).catch(() => update({ state: 'error', canConfigure: true }));
    return () => { active = false; unsubscribe?.(); };
  }, [applyStatus, bridge]);
  const run = async method => {
    try { const next = await method(); applyStatus(next); }
    catch { setStatus(previous => ({ ...previous, state: 'error', checking: false })); }
  };
  return { client, status, connect: () => run(() => window.daylightDesktop[bridge.connect]()),
    check: () => run(() => window.daylightDesktop[bridge.check]()),
    setAutoConnect: enabled => run(() => window.daylightDesktop[bridge.auto](enabled)) };
}

function claudeCopy(t, status) {
  const ready = (status?.clients || []).filter(item => item.state === 'ready').map(item => item.label);
  const installed = (status?.clients || []).filter(item => item.state !== 'unavailable').map(item => item.label);
  return {
    icon: <Asterisk size={20} />,
    label: { ready: t('Claude 工具已就绪', 'Claude tools ready'), disabled: t('MCP 已停用', 'MCP disabled'),
      conflict: t('连接配置需调整', 'Connection needs attention'), unavailable: t('未检测到 Claude', 'Claude not found'),
      error: t('连接测试未通过', 'Connection test failed'), missing: t('尚未连接 Claude', 'Connect Claude') },
    detail: { ready: t(`已验证 ${status?.toolCount} 个任务工具，${ready.join('、')} 可通过 MCP 访问这份清单。`, `${status?.toolCount} task tools verified for ${ready.join(' and ')}.`),
      conflict: t('Claude 配置中已有不同的 daylight 连接，未做修改。请在 Claude 的 MCP 设置中核对。', 'A different daylight entry exists in Claude and was left unchanged. Review it in Claude MCP settings.'),
      disabled: t('请先在 Claude 中启用 Daylight。', 'Enable Daylight in Claude first.'),
      unavailable: t('安装 Claude Code 或 Claude Desktop 后，重新打开清单即可连接。', 'Install Claude Code or Claude Desktop, then reopen Daylight.'),
      error: t('请保持清单运行，然后重新检查连接。', 'Keep Daylight running, then check the connection again.'),
      missing: installed.length ? t(`自动配置 ${installed.join('、')}，让 Claude 直接管理这份清单。`, `Connect ${installed.join(' and ')} to manage this task list directly.`)
        : t('自动配置 Claude Code 和 Claude Desktop，让 Claude 直接管理这份清单。', 'Connect Claude Code and Claude Desktop to manage this task list directly.') },
    note: t('Claude Code 新开会话即可使用；Claude Desktop 需从托盘完全退出后重新打开。', 'Start a new Claude Code session; fully quit and reopen Claude Desktop from the tray.'),
    action: t('连接 Claude', 'Connect Claude'),
    preview: t('示例窗口不修改 Claude 连接配置。', 'The sample window does not change Claude connections.'),
  };
}

function codexCopy(t, status) {
  return {
    icon: <Bot size={20} />,
    label: { ready: t('Codex 工具已就绪', 'Codex tools ready'), disabled: t('MCP 已停用', 'MCP disabled'),
      conflict: t('连接配置需调整', 'Connection needs attention'), unavailable: t('Codex 暂不可用', 'Codex unavailable'),
      error: t('连接测试未通过', 'Connection test failed'), missing: t('尚未连接 Codex', 'Connect Codex') },
    detail: { ready: t(`已验证 ${status?.toolCount} 个任务工具，Codex 可通过 MCP 访问这份清单。`, `${status?.toolCount} task tools verified. Codex can access this list through MCP.`),
      conflict: t('Codex 中已有不同的 Daylight 配置，请在 Codex 的 MCP 设置中调整。', 'A different Daylight entry exists. Review it in Codex MCP settings.'),
      disabled: t('请先在 Codex 的 MCP 设置中启用 Daylight。', 'Enable Daylight in Codex MCP settings first.'),
      unavailable: t('安装或更新本机 Codex 后，重新打开清单即可连接。', 'Install or update local Codex, then reopen Daylight.'),
      error: t('请保持清单运行，然后重新检查连接。', 'Keep Daylight running, then check the connection again.'),
      missing: t('自动配置本机 Codex，让它直接管理这份清单。', 'Connect local Codex to manage this task list directly.') },
    note: t('首次连接后，在 Codex 中打开新聊天即可使用。', 'After the first connection, open a new Codex chat to use the tools.'),
    action: t('连接 Codex', 'Connect Codex'),
    preview: t('示例窗口不修改 Codex 连接配置。', 'The sample window does not change Codex connections.'),
  };
}

export default function McpConnection({ connection, compact = false }) {
  const { t } = useI18n();
  const { status, connect, check, setAutoConnect } = connection;
  const claude = connection.client === 'claude';
  const copy = (claude ? claudeCopy : codexCopy)(t, status);
  const ready = status?.state === 'ready';
  const checking = status?.checking;
  const state = ['ready', 'disabled', 'conflict', 'unavailable', 'error'].includes(status?.state) ? status.state : 'missing';
  const label = checking ? t('正在检查连接', 'Checking connection') : copy.label[state];
  const detail = copy.detail[state];
  return <section className={`mcp-connection ${claude ? 'mcp-claude' : ''} ${compact ? 'mcp-compact' : ''}`} data-testid={claude ? 'claude-connection' : 'mcp-connection'}
    data-client={claude ? 'claude' : 'codex'} data-state={status?.state || 'missing'}>
    <div className="mcp-connection-heading"><span className="mcp-connection-icon">{copy.icon}</span>
      <div><h3>{label}</h3><p>{detail}</p></div>
      {checking ? <LoaderCircle size={18} className="spin" /> : ready ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
    </div>
    {ready && !compact && <p className="mcp-session-note">{copy.note}</p>}
    {status?.preview && <p className="mcp-session-note">{ready ? t('当前连接：桌面预览清单', 'Connected list: desktop preview') : copy.preview}</p>}
    <div className="mcp-connection-actions">
      <button type="button" className="secondary" data-mcp-action={ready ? 'check' : 'connect'} disabled={!status?.canConfigure || checking}
        onClick={ready ? check : connect}>{ready ? <RefreshCw size={14} /> : <Plug size={14} />}{ready ? t('检查连接', 'Check connection') : copy.action}</button>
      {!compact && <label className="mcp-auto-connect"><input type="checkbox" {...(claude ? { 'data-claude-auto-connect': '' } : { 'data-mcp-auto-connect': '' })} checked={!!status?.autoConnect}
        disabled={!status?.canConfigure || checking} onChange={event => setAutoConnect(event.target.checked)} />{t('启动时自动连接', 'Connect on startup')}</label>}
    </div>
  </section>;
}
