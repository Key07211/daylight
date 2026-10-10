'use strict';

const SIX_HOURS = 6 * 60 * 60 * 1000;

function stableVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value || ''));
  return match && match.slice(1).map(Number);
}

function isNewer(version, currentVersion) {
  const next = stableVersion(version);
  const current = stableVersion(currentVersion);
  if (!next || !current) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  return false;
}

function plainNotes(value) {
  const text = Array.isArray(value) ? value.map((entry) => entry?.note || '').join('\n') : String(value || '');
  return text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity])
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim().slice(0, 4000);
}

function reasonsFrom(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter((item) => ['editing', 'running', 'mcp'].includes(item)))];
}

function createUpdateController(options) {
  const {
    updater,
    currentVersion,
    mode = 'installed',
    notify = () => {},
    getBlockers = async () => [],
    prepareInstall = async () => true,
    releaseInstall = () => {},
    install = () => updater.quitAndInstall(true, true),
    portableCheck,
    openPortable,
    now = Date.now,
    setTimeout: scheduleTimeout = setTimeout,
    clearTimeout: cancelTimeout = clearTimeout,
    setInterval: scheduleInterval = setInterval,
    clearInterval: cancelInterval = clearInterval,
    startupDelayMs = 10000,
  } = options;

  if (!['installed', 'portable', 'disabled'].includes(mode)) throw new TypeError('Unknown update mode');
  if (mode === 'installed' && (!updater?.on || !updater?.checkForUpdates || !updater?.downloadUpdate)) {
    throw new TypeError('Installed updates require an updater');
  }

  let status = {
    revision: 0, state: mode === 'disabled' ? 'disabled' : 'idle', mode,
    currentVersion, version: null, releaseNotes: '', progress: null,
    reasons: [], errorCode: null, checkedAt: null,
  };
  let disposed = false;
  let started = false;
  let checkRun = null;
  let downloadRun = null;
  let resumeRun = null;
  let releaseRun = null;
  let activeCheck = null;
  let activeDownload = null;
  let downloaded = false;
  let authorized = false;
  let installationStarted = false;
  let installAttempt = 0;
  let startupTimer;
  let checkTimer;
  let resumeTimer;
  const listeners = [];

  function getStatus() {
    return { ...status, reasons: [...status.reasons], progress: status.progress && { ...status.progress } };
  }

  function publish(patch) {
    if (disposed) return getStatus();
    status = { ...status, ...patch, revision: status.revision + 1 };
    try { notify(getStatus()); } catch { /* A closed window must not break updating. */ }
    return getStatus();
  }

  function stamp() {
    return new Date(now()).toISOString();
  }

  function releasePreparation() {
    if (releaseRun) return releaseRun;
    releaseRun = Promise.resolve().then(releaseInstall).catch(() => {
      // Keep a retry available if cleanup fails.
    }).finally(() => { releaseRun = null; });
    return releaseRun;
  }

  function installFailed(attempt) {
    if (disposed || attempt !== installAttempt || status.state === 'error') return;
    installationStarted = false;
    void releasePreparation();
    publish({ state: 'error', errorCode: 'install_failed', reasons: [] });
  }

  function addListener(event, handler) {
    updater.on(event, handler);
    listeners.push([event, handler]);
  }

  if (mode === 'installed') {
    // Downloads and installation require a click in this process, even for a cached update.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;

    addListener('update-available', (info) => {
      if (activeCheck && !activeCheck.error) activeCheck.info = info;
    });
    addListener('update-not-available', () => {
      if (activeCheck && !activeCheck.error) activeCheck.notAvailable = true;
    });
    addListener('download-progress', (progress) => {
      if (!activeDownload || activeDownload.failed || downloaded || !authorized || status.state !== 'downloading') return;
      const finite = (value) => Number.isFinite(value) ? Math.max(0, value) : 0;
      publish({ progress: {
        percent: Math.min(100, finite(progress?.percent)),
        transferred: finite(progress?.transferred), total: finite(progress?.total),
        bytesPerSecond: finite(progress?.bytesPerSecond),
      } });
    });
    addListener('update-downloaded', (info) => {
      if (!activeDownload || activeDownload.failed || !authorized || downloaded || installationStarted) return;
      if (info?.version !== status.version) return;
      downloaded = true;
      publish({ state: 'waiting', progress: { ...(status.progress || {}), percent: 100 }, reasons: [], errorCode: null });
      void resume();
    });
    addListener('error', () => {
      if (disposed) return;
      if (status.state === 'installing') {
        installFailed(installAttempt);
      } else if (activeDownload && !downloaded) {
        activeDownload.failed = true;
        authorized = false;
        publish({ state: 'error', errorCode: 'download_failed', reasons: [] });
      } else if (activeCheck) {
        activeCheck.error = true;
      }
    });
  }

  function check() {
    if (disposed || mode === 'disabled') return Promise.resolve(getStatus());
    if (checkRun) return checkRun;
    if (downloadRun || downloaded || ['downloading', 'waiting', 'installing'].includes(status.state)) return Promise.resolve(getStatus());
    checkRun = Promise.resolve().then(async () => {
      if (disposed) return getStatus();
      const operation = { info: null, notAvailable: false, error: false };
      activeCheck = operation;
      publish({ state: 'checking', errorCode: null, reasons: [] });
      try {
        const result = mode === 'portable' ? await portableCheck() : await updater.checkForUpdates();
        if (disposed) return getStatus();
        if (operation.error) throw new Error('Update check failed');
        const info = operation.notAvailable ? null : operation.info || (mode === 'portable' ? result : result?.updateInfo);
        if (info && isNewer(info.version, currentVersion)) {
          publish({ state: 'available', version: info.version, releaseNotes: plainNotes(info.releaseNotes), checkedAt: stamp(), progress: null, errorCode: null });
        } else {
          publish({ state: 'current', version: null, releaseNotes: '', checkedAt: stamp(), progress: null, errorCode: null });
        }
      } catch {
        publish({ state: 'error', errorCode: 'check_failed', checkedAt: stamp() });
      } finally {
        if (activeCheck === operation) activeCheck = null;
      }
      return getStatus();
    }).finally(() => { checkRun = null; });
    return checkRun;
  }

  function resume() {
    if (resumeRun) return resumeRun;
    if (disposed || mode !== 'installed' || !authorized || !downloaded || installationStarted || status.state !== 'waiting') {
      return Promise.resolve(getStatus());
    }
    resumeRun = Promise.resolve().then(async () => {
      const attempt = ++installAttempt;
      try {
        if (releaseRun) await releaseRun;
        if (disposed) return getStatus();
        const blockers = reasonsFrom(await getBlockers());
        if (disposed) return getStatus();
        if (blockers.length) return publish({ state: 'waiting', reasons: blockers });
        const prepared = await prepareInstall();
        if (disposed) { await releasePreparation(); return getStatus(); }
        const blocked = reasonsFrom(Array.isArray(prepared) ? prepared : prepared?.blocked);
        if (prepared === false || blocked.length) {
          await releasePreparation();
          const reasons = blocked.length ? blocked : reasonsFrom(await getBlockers());
          return publish({ state: 'waiting', reasons });
        }
        installationStarted = true;
        publish({ state: 'installing', reasons: [], errorCode: null });
        if (await install() === false) installFailed(attempt);
      } catch {
        installFailed(attempt);
      }
      return getStatus();
    }).finally(() => { resumeRun = null; });
    return resumeRun;
  }

  function download() {
    if (downloadRun) return downloadRun;
    if (disposed || mode === 'disabled' || !status.version || status.state === 'installing') return Promise.resolve(getStatus());
    if (downloaded && authorized) {
      if (status.errorCode === 'install_failed') publish({ state: 'waiting', errorCode: null, reasons: [] });
      return resume();
    }
    if (checkRun) return checkRun.then(download);
    downloadRun = Promise.resolve().then(async () => {
      if (disposed) return getStatus();
      if (mode === 'portable') {
        try {
          if (typeof openPortable !== 'function' || await openPortable(getStatus()) === false) throw new Error('Cannot open release');
          publish({ state: 'available', errorCode: null });
        } catch {
          publish({ state: 'error', errorCode: 'open_failed' });
        }
        return getStatus();
      }
      authorized = true;
      const operation = { failed: false };
      activeDownload = operation;
      publish({ state: 'downloading', progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }, errorCode: null, reasons: [] });
      try {
        await updater.downloadUpdate();
        if (!downloaded || operation.failed) throw new Error('Download did not complete');
        if (resumeRun) await resumeRun;
      } catch {
        if (!downloaded) {
          operation.failed = true;
          authorized = false;
          publish({ state: 'error', errorCode: 'download_failed', reasons: [] });
        }
      } finally {
        if (activeDownload === operation) activeDownload = null;
      }
      return getStatus();
    }).finally(() => { downloadRun = null; });
    return downloadRun;
  }

  function start() {
    if (started || disposed || mode === 'disabled') return getStatus();
    started = true;
    startupTimer = scheduleTimeout(() => { void check(); }, startupDelayMs);
    checkTimer = scheduleInterval(() => { void check(); }, SIX_HOURS);
    resumeTimer = scheduleInterval(() => { void resume(); }, 1000);
    for (const timer of [startupTimer, checkTimer, resumeTimer]) timer?.unref?.();
    return getStatus();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelTimeout(startupTimer);
    cancelInterval(checkTimer);
    cancelInterval(resumeTimer);
    for (const [event, handler] of listeners) updater.removeListener(event, handler);
  }

  return { getStatus, check, download, resume, start, dispose };
}

module.exports = { createUpdateController };
