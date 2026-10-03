const assert = require('node:assert/strict');
const fs = require('node:fs');
const { nativeTheme } = require('electron');

// Runs only against the desktop smoke profile and its isolated local service.
module.exports = async function testInterface(window, origin, output) {
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const loadUI = async () => {
    await window.loadURL(origin);
    // The test window is hidden. Exercise the visible-window motion path without
    // showing a second desktop window or changing production visibility handling.
    await evaluate(`(() => {
      Object.defineProperty(document, 'visibilityState', {configurable:true,get:()=>'visible'});
      Object.defineProperty(document, 'hidden', {configurable:true,get:()=>false});
      document.dispatchEvent(new Event('visibilitychange'));
      window.__themeTransitions = 0;
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = callback => { window.__themeTransitions++; return start(callback); };
    })()`);
    // A reload must not leave a process-once startup layer over ordinary UI checks.
    await waitFor("Boolean(document.querySelector('.app-shell')) && !document.querySelector('.startup-scene') && !document.querySelector('.app-shell').inert", 'startup settled after renderer reload');
  };
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`UI check timed out: ${label}`);
  };
  const click = selector => evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button) throw new Error('Button not found: ' + ${JSON.stringify(selector)});
    button.focus(); button.click();
  })()`);
  const clickText = (selector, label) => evaluate(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => item.textContent.trim() === ${JSON.stringify(label)});
    if (!button) throw new Error('Button not found: ' + ${JSON.stringify(label)});
    button.click();
  })()`);
  const setVisibility = visible => evaluate(`(() => {
    Object.defineProperty(document, 'visibilityState', {configurable:true,get:()=>${JSON.stringify(visible ? 'visible' : 'hidden')}});
    Object.defineProperty(document, 'hidden', {configurable:true,get:()=>${!visible}});
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  const replayStartup = async () => {
    await click('.workspace');
    await waitFor("Boolean(document.querySelector('[data-replay-startup]'))", 'startup replay settings');
    await click('[data-replay-startup]');
    await waitFor("document.querySelector('.startup-scene')?.dataset.motion === 'on'", 'startup replay enters');
  };
  const startupFinished = () => waitFor("!document.querySelector('.startup-scene') && !document.querySelector('.app-shell')?.inert", 'startup releases the app');
  const bootstrap = () => fetch(`${origin}/api/bootstrap`).then(response => response.json());
  const state = await bootstrap();
  const request = async (route, method, value = {}) => {
    const response = await fetch(`${origin}/api${route}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Daylight-Token': state.csrfToken },
      body: JSON.stringify(value),
    });
    assert.ok(response.ok, `Smoke API ${method} ${route}: ${response.status}`);
    return response.json();
  };
  const day = offset => {
    const date = new Date(); date.setDate(date.getDate() + offset); date.setHours(23, 59, 0, 0);
    return date.toISOString();
  };
  const ids = [];
  const screenshots = {};
  const capture = async name => {
    await waitFor("!document.documentElement.dataset.themeTransition", 'theme transition settled for capture');
    // Hidden Chromium windows can pause CSS timelines; freeze motion for a stable still.
    const frozenMotion = await window.webContents.insertCSS('*, *::before, *::after { animation: none !important; transition: none !important; }');
    try {
      await window.webContents.capturePage();
      await new Promise(resolve => setTimeout(resolve, 400));
      const filename = output.replace(/\.json$/i, '') + `-${name}.png`;
      fs.writeFileSync(filename, (await window.webContents.capturePage()).toPNG());
      screenshots[name] = filename;
    } finally {
      await window.webContents.removeInsertedCSS(frozenMotion);
    }
  };
  const checks = {};
  const confirmDialog = '[role="dialog"][aria-label="确认完成任务"]';
  try {
    const fixtures = [
      { title: '整理今天的课堂笔记', notes: '回顾课堂重点，整理需要进一步理解的问题。', priority: 'high', dueAt: day(0) },
      { title: '完成本周学习计划', notes: '列出重点安排，确认每项任务的下一步。', priority: 'high', dueAt: day(0) },
      { title: '准备小组讨论提纲', notes: '整理讨论主题，记录想与小组分享的观点。', priority: 'medium', dueAt: day(0) },
      { title: '复查项目进度', notes: '示例任务，可自由编辑、完成和删除。', priority: 'low', dueAt: day(1) },
    ];
    for (const fixture of fixtures) ids.push((await request('/tasks', 'POST', fixture)).id);
    await evaluate("localStorage.setItem('daylight-theme', 'day'); sessionStorage.removeItem('daylight-theme-override'); localStorage.setItem('daylight-language', 'zh'); localStorage.removeItem('daylight-glass'); localStorage.setItem('daylight-weather', JSON.stringify({mode:'live',locationMode:'auto',preview:{condition:'clear',minutes:720}})); sessionStorage.setItem('daylight-weather-preview-session', JSON.stringify({mode:'preview',preview:{condition:'clear',minutes:720}})); localStorage.removeItem('daylight-weather-cache'); localStorage.removeItem('daylight-weather-location')");
    window.setContentSize(1360, 900);
    await loadUI();
    await waitFor("document.querySelectorAll('.task-checkbox').length >= 3 && document.querySelector('.theme-toggle')", 'tasks loaded');
    // Exercise the shipped UI to select day even when the local clock starts at night.
    // Packaged smoke tests must not import unbundled renderer source or copy its schedule logic.
    if (await evaluate("document.documentElement.dataset.theme === 'night'")) await click('button.theme-toggle');
    await waitFor("document.documentElement.dataset.theme === 'day' && !document.documentElement.dataset.themeTransition", 'initial day theme');
    const tasksBeforeStartup = JSON.stringify((await bootstrap()).tasks);
    const startupStarted = Date.now();
    await replayStartup();
    checks.startupReplayUsesDayArtwork = await evaluate("document.querySelector('.startup-scene').dataset.theme === 'day' && Boolean(document.querySelector('.startup-scene .startup-sun')) && !document.querySelector('.app-shell [role=dialog]')");
    checks.startupBlocksWorkspaceInteraction = await evaluate(`(() => {
      const scene = document.querySelector('.startup-scene');
      const rect = scene.getBoundingClientRect();
      document.querySelector('.task-checkbox').focus();
      return document.querySelector('.app-shell').inert && scene.contains(document.activeElement)
        && rect.width >= innerWidth && rect.height >= innerHeight
        && scene.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2));
    })()`);
    await evaluate(`(() => {
      for (const options of [{key:'n'}, {key:'k',ctrlKey:true}, {key:'Tab'}, {key:'Tab',shiftKey:true}]) {
        document.dispatchEvent(new KeyboardEvent('keydown', {...options,bubbles:true,cancelable:true}));
      }
    })()`);
    checks.startupTrapsFocusAndShortcuts = await evaluate("document.activeElement === document.querySelector('.startup-skip') && !document.querySelector('.task-form') && document.querySelector('.app-shell').inert");
    await waitFor("document.querySelector('.startup-scene')?.dataset.phase === 'hold'", 'startup hold phase');
    await waitFor("document.querySelector('.startup-scene')?.dataset.phase === 'exit'", 'startup exit phase');
    await startupFinished();
    // Allow the full celestial sequence plus settings entry and renderer scheduling.
    checks.startupCompletesAllPhases = Date.now() - startupStarted < 6500;
    checks.startupRestoresUsableFocus = await evaluate("document.activeElement !== document.body && document.querySelector('.app-shell').contains(document.activeElement) && !document.activeElement.closest('[inert]')");
    await replayStartup();
    await click('.startup-skip');
    await waitFor("document.querySelector('.startup-scene')?.dataset.phase === 'exit'", 'skip starts startup exit');
    await startupFinished();
    checks.startupSkipWorks = true;
    await replayStartup();
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}))");
    await startupFinished();
    checks.startupEscapeWorks = true;
    await replayStartup();
    await setVisibility(false);
    await startupFinished();
    await setVisibility(true);
    await new Promise(resolve => setTimeout(resolve, 100));
    checks.startupHideEndsWithoutReplay = await evaluate("!document.querySelector('.startup-scene') && !document.querySelector('.app-shell').inert");
    await replayStartup();
    await loadUI();
    await waitFor("document.querySelectorAll('.task-checkbox').length >= 3", 'tasks survive startup reload');
    checks.startupReloadDoesNotReplay = await evaluate("!document.querySelector('.startup-scene') && !document.querySelector('.app-shell').inert");
    checks.startupClaimIsProcessScoped = await evaluate("(async () => (await window.daylightDesktop.claimStartup()) === false && (await window.daylightDesktop.claimStartup()) === false)()");
    checks.startupDoesNotMutateTasks = JSON.stringify((await bootstrap()).tasks) === tasksBeforeStartup;
    checks.weatherPreviewSurvivesSessionReload = await evaluate("document.querySelector('.weather-badge').dataset.weatherMode === 'preview' && JSON.parse(localStorage.getItem('daylight-weather')).mode === 'live' && JSON.parse(sessionStorage.getItem('daylight-weather-preview-session')).preview.minutes === 720");
    await evaluate('window.__themeTransitions = 0');
    checks.dayLoaded = await evaluate("document.documentElement.dataset.theme === 'day'");
    checks.enlargedType = await evaluate("parseFloat(getComputedStyle(document.querySelector('.task-title')).fontSize) >= 16 && parseFloat(getComputedStyle(document.querySelector('.nav-item')).fontSize) >= 15");
    checks.fillerRemoved = await evaluate("!['从容安排', '每一步，都算数。', '新的一天，慢慢来。'].some(text => document.body.innerText.includes(text))");
    checks.dayNoOverflow = await evaluate('document.documentElement.scrollWidth <= innerWidth');
    await click('button[aria-controls="task-filters"]');
    await waitFor("document.querySelector('#task-filters').getBoundingClientRect().height > 25", 'filters expand');
    checks.filterDisclosureExpands = await evaluate("!document.querySelector('#task-filters').inert && document.querySelector('button[aria-controls=task-filters]').getAttribute('aria-expanded') === 'true'");
    await click('button[aria-controls="task-filters"]');
    await waitFor("document.querySelector('#task-filters').getBoundingClientRect().height < 1", 'filters collapse');
    checks.collapsedFiltersCannotReceiveFocus = await evaluate("document.querySelector('#task-filters select').focus(); document.querySelector('#task-filters').inert && !document.querySelector('#task-filters').contains(document.activeElement)");
    checks.glassRibbonPresent = await evaluate("Boolean(document.querySelector('.sidebar-atmosphere .liquid-ribbon[data-renderer=\"projected-glass-sheet\"]'))");
    checks.daySunflowersVisible = await evaluate("Boolean(document.querySelector('.brand .sunflower-mark')) && getComputedStyle(document.querySelector('.daylight-botanical')).display !== 'none'");
    checks.sunAndDriftingClouds = await evaluate("Boolean(document.querySelector('.sky-sun')) && document.querySelectorAll('.sky-cloud').length >= 2 && getComputedStyle(document.querySelector('.sky-cloud')).animationName !== 'none' && !document.querySelector('.celestial-moon')");
    checks.headingSunflowerRemoved = await evaluate("!document.querySelector('.page-heading .sunflower-mark')");
    checks.skyKeepsHeaderClear = await evaluate(`(() => {
      const sky = document.querySelector('.sky-atmosphere');
      const action = document.querySelector('.page-heading > .primary');
      const rect = action.getBoundingClientRect();
      return sky.getBoundingClientRect().width >= innerWidth && sky.getBoundingClientRect().height >= innerHeight
        && getComputedStyle(sky).pointerEvents === 'none'
        && action.contains(document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2));
    })()`);
    checks.languageCardReplacesCodex = await evaluate("Boolean(document.querySelector('.language-card')) && !document.querySelector('.codex-card')");
    checks.languageCardFullyVisible = await evaluate("document.querySelector('.daily-sidebar .language-card').getBoundingClientRect().bottom <= innerHeight");
    checks.navigationGlass = await evaluate("getComputedStyle(document.querySelector('.nav-item')).backdropFilter.includes('blur') && getComputedStyle(document.querySelector('.nav-item')).boxShadow !== 'none'");
    checks.smallCircularPointerGlow = await evaluate(`(() => {
      const sidebar = document.querySelector('.sidebar');
      const bounds = sidebar.getBoundingClientRect();
      sidebar.dispatchEvent(new PointerEvent('pointermove', {clientX:bounds.left + 90,clientY:bounds.top + 250,bubbles:true}));
      return getComputedStyle(sidebar,'::after').backgroundImage.includes('75px')
        && sidebar.style.getPropertyValue('--light-x') === '90px'
        && sidebar.style.getPropertyValue('--light-y') === '250px';
    })()`);
    await evaluate("document.querySelector('.sidebar').dispatchEvent(new PointerEvent('pointerout',{bubbles:true}))");
    await capture('day');
    await click('button.theme-toggle');
    await waitFor("document.documentElement.dataset.theme === 'night'", 'night theme');
    checks.themeUsesWholeWindowTransition = await evaluate("window.__themeTransitions === 1 && getComputedStyle(document.documentElement,'::view-transition-new(root)').animationDuration === '0.7s' && getComputedStyle(document.documentElement,'::view-transition-new(root)').mixBlendMode === 'normal'");
    checks.nightStored = await evaluate("localStorage.getItem('daylight-theme') === 'night'");
    await waitFor("!document.documentElement.dataset.themeTransition", 'night transition before startup replay');
    await replayStartup();
    checks.startupReplayUsesNightArtwork = await evaluate("document.querySelector('.startup-scene').dataset.theme === 'night' && Boolean(document.querySelector('.startup-scene .startup-moon')) && !document.querySelector('.startup-scene .startup-sun')");
    await click('.startup-skip');
    await startupFinished();
    checks.nightSunflowersHidden = await evaluate("!document.querySelector('.brand .sunflower-mark') && getComputedStyle(document.querySelector('.daylight-botanical')).display === 'none'");
    checks.nightAtmosphere = await evaluate("Boolean(document.querySelector('.sidebar-atmosphere .glass-stars')) && getComputedStyle(document.documentElement).colorScheme === 'dark'");
    checks.milkyWayReplacesPiano = await evaluate("Boolean(document.querySelector('.sidebar-atmosphere .milky-way')) && !document.querySelector('.night-music, .piano-float, .music-note, .sidebar-atmosphere .liquid-ribbon')");
    checks.moonAndHangingStars = await evaluate("Boolean(document.querySelector('.sky-atmosphere .celestial-moon')) && document.querySelectorAll('.sky-atmosphere .star-thread').length >= 3 && document.querySelectorAll('.sky-atmosphere .hanging-star').length >= 3 && !document.querySelector('.celestial-sun')");
    checks.nightArtworkMoves = await evaluate("getComputedStyle(document.querySelector('.hanging-star')).animationName !== 'none' && getComputedStyle(document.querySelector('.galaxy-drift')).animationName !== 'none'");
    checks.artworkDoesNotBlockClicks = await evaluate("['.sky-atmosphere','.milky-way'].every(selector => getComputedStyle(document.querySelector(selector)).pointerEvents === 'none')");
    await capture('night');
    checks.themeTransitionSettles = await evaluate("!document.documentElement.dataset.themeTransition && document.documentElement.dataset.theme === 'night'");
    await click('button.theme-toggle');
    await new Promise(resolve => setTimeout(resolve, 70));
    await click('button.theme-toggle');
    await new Promise(resolve => setTimeout(resolve, 70));
    await click('button.theme-toggle');
    await waitFor("!document.documentElement.dataset.themeTransition && document.documentElement.dataset.theme === 'day'", 'rapid theme switching settles');
    checks.rapidThemeSwitchKeepsLastChoice = await evaluate("localStorage.getItem('daylight-theme') === 'day' && Boolean(document.querySelector('.sky-sun')) && !document.querySelector('.celestial-moon')");
    await click('button.theme-toggle');
    await waitFor("!document.documentElement.dataset.themeTransition && document.documentElement.dataset.theme === 'night'", 'night after rapid switch');
    await evaluate("document.querySelector('button.theme-toggle').click(); document.querySelector('button.theme-toggle').click()");
    await new Promise(resolve => setTimeout(resolve, 80));
    await waitFor("!document.documentElement.dataset.themeTransition && document.documentElement.dataset.theme === 'night'", 'same frame double toggle');
    checks.sameFrameDoubleToggleKeepsIntent = await evaluate("JSON.parse(sessionStorage.getItem('daylight-theme-override')).theme === 'night' && localStorage.getItem('daylight-theme') === 'night'");
    checks.nativeNightTheme = nativeTheme.themeSource === 'dark';
    checks.invalidNativeThemeRejected = await evaluate(`(async () => {
      try { await window.daylightDesktop.setTheme('invalid'); return false; }
      catch { return true; }
    })()`);
    checks.invalidThemePreservesNativeState = nativeTheme.themeSource === 'dark';
    await loadUI();
    await waitFor("document.querySelectorAll('.task-checkbox').length >= 3", 'night reload');
    checks.themeRestoredAfterReload = await evaluate("document.documentElement.dataset.theme === 'night' && document.title.includes('夜')");
    const target = fixtures[0].title;
    const checkbox = `button[aria-label="完成任务：${target}"]`;
    await evaluate(`(() => { window.__taskWrites = 0; window.__actualFetch = window.fetch;
      window.fetch = function(input, init) {
        if (init?.method === 'PATCH' && String(input).includes('/tasks/')) window.__taskWrites++;
        return window.__actualFetch.apply(this, arguments);
      }; })()`);
    await click(checkbox);
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(confirmDialog)}))`, 'completion dialog');
    checks.clickDoesNotComplete = !(await bootstrap()).tasks.find(task => task.id === ids[0]).completed;
    checks.noWriteBeforeConfirmation = await evaluate('window.__taskWrites === 0');
    await capture('confirm');
    await clickText(`${confirmDialog} button`, '取消');
    await waitFor("document.querySelector('.modal[data-closing=true]')", 'completion cancellation animates out');
    checks.modalDismissHasExitMotion = await evaluate("getComputedStyle(document.querySelector('.modal')).animationName === 'interaction-modal-out'");
    await clickText(`${confirmDialog} button`, '确认完成');
    await waitFor(`!document.querySelector(${JSON.stringify(confirmDialog)})`, 'cancel dismissed');
    checks.cancelKeepsTask = !(await bootstrap()).tasks.find(task => task.id === ids[0]).completed;
    checks.closingDialogCannotSubmit = await evaluate('window.__taskWrites === 0');
    checks.cancelRestoresFocus = await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(checkbox)})`);
    await click(checkbox);
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(confirmDialog)}))`, 'escape dialog');
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitFor(`!document.querySelector(${JSON.stringify(confirmDialog)})`, 'escape dismissed');
    checks.escapeKeepsTask = !(await bootstrap()).tasks.find(task => task.id === ids[0]).completed;
    await click(checkbox);
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(confirmDialog)}))`, 'backdrop dialog');
    await evaluate("document.querySelector('.overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))");
    await waitFor(`!document.querySelector(${JSON.stringify(confirmDialog)})`, 'backdrop dismissed');
    checks.backdropKeepsTask = !(await bootstrap()).tasks.find(task => task.id === ids[0]).completed;
    await click(checkbox);
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(confirmDialog)}))`, 'confirm dialog');
    await clickText(`${confirmDialog} button`, '确认完成');
    await waitFor(`!document.querySelector(${JSON.stringify(confirmDialog)})`, 'confirmation saved');
    checks.confirmCompletesTask = (await bootstrap()).tasks.find(task => task.id === ids[0]).completed;
    checks.onlyOneCompletionWrite = await evaluate('window.__taskWrites === 1');
    await click('button[data-dialog-return-focus]');
    await waitFor("Boolean(document.querySelector('.automation-toggle'))", 'task editor');
    await click('.automation-toggle');
    await waitFor("document.querySelector('#codex-task-fields').getBoundingClientRect().height > 60", 'Codex fields expand');
    await evaluate(`(() => {
      const field=document.querySelector('.automation-fields textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Motion check draft');
      field.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await click('.automation-toggle');
    await waitFor("document.querySelector('#codex-task-fields').getBoundingClientRect().height < 1", 'Codex fields collapse');
    checks.collapsedCodexFieldsAreInert = await evaluate("document.querySelector('#codex-task-fields').inert");
    await click('.automation-toggle');
    await waitFor("document.querySelector('#codex-task-fields').getBoundingClientRect().height > 60", 'Codex fields reopen');
    checks.disclosureKeepsDraft = await evaluate("document.querySelector('.automation-fields textarea').value === 'Motion check draft'");
    await clickText('[role="dialog"] button','取消');
    await waitFor("!document.querySelector('[role=dialog]')", 'draft dismissed');
    await click(`[data-task-id="${ids[1]}"] .task-main`);
    await waitFor("Boolean(document.querySelector('.task-form'))", 'existing task editor');
    await evaluate(`(() => {
      window.__beforePendingFetch=window.fetch;
      window.fetch=function(input,init){
        if(init?.method==='PATCH' && String(input).includes('/tasks/')) {
          return new Promise(resolve=>{window.__releaseTaskSave=()=>resolve(window.__beforePendingFetch(input,init));});
        }
        return window.__beforePendingFetch.apply(this,arguments);
      };
    })()`);
    try {
      await clickText('[role="dialog"] button','保存修改');
      await waitFor("typeof window.__releaseTaskSave === 'function'", 'task save pending');
      await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      checks.pendingSaveCannotDismissEditor = await evaluate("Boolean(document.querySelector('.task-form')) && document.querySelector('[data-modal-dismiss]').disabled && !document.querySelector('.modal').dataset.closing");
      await evaluate('window.__releaseTaskSave()');
      await waitFor("!document.querySelector('[role=dialog]')", 'saved editor closes');
    } finally { await evaluate('void (window.fetch=window.__beforePendingFetch)'); }
    window.setContentSize(960, 680);
    await new Promise(resolve => setTimeout(resolve, 200));
    checks.compactNoOverflow = await evaluate('document.documentElement.scrollWidth <= innerWidth');
    await capture('compact');
    await click('button.theme-toggle');
    await waitFor("document.documentElement.dataset.theme === 'day'", 'return to day');
    checks.dayRestored = await evaluate("localStorage.getItem('daylight-theme') === 'day'");
    window.setContentSize(1360, 900);
    await click('.workspace');
    await waitFor("Boolean(document.querySelector('[data-testid=\"glass-settings\"]'))", 'glass settings');
    checks.mcpSmokeCannotChangeRealConfig = await evaluate("Boolean(document.querySelector('[data-testid=\"mcp-connection\"] button:disabled')) && document.querySelector('[data-testid=\"mcp-connection\"]').dataset.state === 'unavailable'");
    checks.mcpAutoConnectRejectsInvalidInput = await evaluate(`(async () => {
      try { await window.daylightDesktop.setMcpAutoConnect('yes'); return false; } catch { return true; }
    })()`);
    window.webContents.send('daylight:mcp-status-changed', {state:'ready',registered:true,toolCount:14,revision:100,checking:false,canConfigure:false,autoConnect:true});
    await waitFor("document.querySelector('[data-testid=\"mcp-connection\"]').dataset.state === 'ready'", 'verified MCP status');
    checks.mcpShowsVerifiedToolCount = await evaluate("document.querySelector('[data-testid=\"mcp-connection\"]').textContent.includes('14') && document.querySelector('[data-mcp-auto-connect]').checked");
    window.webContents.send('daylight:mcp-status-changed', {state:'missing',revision:99,checking:true,canConfigure:false});
    await new Promise(resolve => setTimeout(resolve, 80));
    checks.staleMcpStatusCannotReplaceReady = await evaluate("document.querySelector('[data-testid=\"mcp-connection\"]').dataset.state === 'ready'");
    window.webContents.send('daylight:mcp-status-changed', {state:'error',registered:true,revision:101,checking:false,canConfigure:false});
    await waitFor("document.querySelector('[data-testid=\"mcp-connection\"]').dataset.state === 'error'", 'failed MCP status');
    checks.mcpFailureIsNotLabeledReady = await evaluate("!document.querySelector('[data-testid=\"mcp-connection\"]').textContent.includes('已就绪')");
    await capture('settings');
    const setRange = (control, value) => evaluate(`(() => {
      const input = document.querySelector('[data-glass-control="${control}"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${value}');
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await setRange('transparency', 80);
    await setRange('blur', 20);
    await setRange('glow', 25);
    await click('[data-glass-control="motion"]');
    await waitFor("JSON.parse(localStorage.getItem('daylight-glass')).blur === 20", 'glass preferences saved');
    checks.glassPreferencesApplied = await evaluate(`(() => {
      const root = document.documentElement;
      return Math.abs(parseFloat(root.style.getPropertyValue('--glass-opacity')) - .284) < .001
        && root.style.getPropertyValue('--glass-blur') === '20px'
        && root.style.getPropertyValue('--glass-glow') === '0.25' && root.dataset.glassMotion === 'off'
        && getComputedStyle(document.querySelector('.task-row')).backdropFilter.includes('20px')
        && getComputedStyle(document.querySelector('.nav-item')).backdropFilter.includes('20px');
    })()`);
    checks.sunCloudMotionCanStop = await evaluate("document.querySelector('.sky-atmosphere').dataset.animated === 'false' && getComputedStyle(document.querySelector('.sky-cloud')).animationName === 'none' && document.querySelector('.task-list').dataset.taskMotion === 'off'");
    checks.motionPreferenceDisablesStartupReplay = await evaluate("document.querySelector('[data-replay-startup]').disabled && !document.querySelector('.startup-scene') && !document.querySelector('.app-shell').inert");
    await evaluate("window.__transitionsBeforeMotionOff = window.__themeTransitions; document.querySelector('button.theme-toggle').click()");
    await waitFor("document.documentElement.dataset.theme === 'night'", 'motion off night');
    checks.motionOffSkipsThemeTransition = await evaluate("!document.documentElement.dataset.themeTransition && window.__themeTransitions === window.__transitionsBeforeMotionOff");
    await click('button.theme-toggle');
    await waitFor("document.documentElement.dataset.theme === 'day'", 'motion off day');
    await loadUI();
    await waitFor("Boolean(document.querySelector('.theme-toggle'))", 'glass reload');
    checks.glassPreferencesPersist = await evaluate("document.documentElement.style.getPropertyValue('--glass-blur') === '20px' && document.documentElement.dataset.glassMotion === 'off' && document.querySelector('.liquid-ribbon')?.dataset.motion === 'still'");
    await click('.workspace');
    await waitFor("Boolean(document.querySelector('.glass-reset'))", 'reset settings');
    await click('.glass-reset');
    await waitFor("document.documentElement.dataset.glassMotion === 'on'", 'glass reset');
    checks.glassResetWorks = await evaluate("JSON.stringify(JSON.parse(localStorage.getItem('daylight-glass'))) === JSON.stringify({transparency:58,blur:12,glow:55,motion:true})");
    await click('[role="dialog"] [data-language="en"]');
    await waitFor("document.documentElement.lang === 'en' || document.documentElement.lang === 'en-US'", 'English selected');
    checks.englishSettings = await evaluate("document.querySelector('[role=\"dialog\"]').textContent.includes('Liquid glass') && document.querySelector('[role=\"dialog\"]').textContent.includes('Background blur')");
    await capture('settings-english');
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitFor("!document.querySelector('[role=\"dialog\"]')", 'English settings dismissed');
    checks.englishInterface = await evaluate("[...document.querySelectorAll('.nav-item span')].some(item => item.textContent === 'All tasks') && document.body.innerText.includes('New task') && document.body.innerText.includes('Today at a glance')");
    checks.taskContentUnchanged = await evaluate(`document.body.innerText.includes(${JSON.stringify(fixtures[1].title)})`);
    await capture('english');
    await loadUI();
    await waitFor("Boolean(document.querySelector('.theme-toggle'))", 'language reload');
    checks.languagePersists = await evaluate("localStorage.getItem('daylight-language') === 'en' && document.documentElement.lang.startsWith('en') && document.body.innerText.includes('All tasks')");
    await click(`button[aria-label="Complete task: ${fixtures[1].title}"]`);
    await waitFor("Boolean(document.querySelector('[role=\"dialog\"]'))", 'English confirmation');
    checks.englishConfirmation = await evaluate("document.querySelector('[role=\"dialog\"]').textContent.includes('Confirm completion') && document.querySelector('[role=\"dialog\"]').textContent.includes('Cancel')");
    await clickText('[role="dialog"] button', 'Cancel');
    window.setContentSize(960, 680);
    await new Promise(resolve => setTimeout(resolve, 200));
    checks.compactEnglishNoOverflow = await evaluate('document.documentElement.scrollWidth <= innerWidth');
    await capture('english-compact');
    await click('.workspace');
    await waitFor("Boolean(document.querySelector('[role=\"dialog\"] [data-language=\"zh\"]'))", 'compact language settings');
    await click('[role="dialog"] [data-language="zh"]');
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitFor("!document.querySelector('[role=\"dialog\"]')", 'Chinese restored');
    checks.chineseRestored = await evaluate("document.documentElement.lang.startsWith('zh') && document.body.innerText.includes('全部任务')");
    window.setContentSize(1360, 900);
    const previewWeather = async preset => {
      await click('.weather-badge');
      await waitFor("Boolean(document.querySelector('[data-weather-source=\"preview\"]'))", 'weather settings');
      await click('[data-weather-source="preview"]');
      await click(`[data-weather-preset="${preset}"]`);
      await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
      await waitFor("!document.querySelector('[role=\"dialog\"]')", 'weather preview applied');
    };
    await previewWeather('dawn');
    const dawnX = await evaluate("parseFloat(document.querySelector('.sky-atmosphere').style.getPropertyValue('--sun-x'))");
    checks.dawnPalette = await evaluate("document.querySelector('.sky-atmosphere').dataset.phase === 'dawn'");
    await capture('dawn');
    await previewWeather('noon');
    await evaluate(`(() => {
      const actualFetch = window.fetch;
      window.__weatherOffline = false;
      window.__weatherCalls = [];
      const city = {name:'界面测试城市',region:'California',country:'United States',latitude:37.77,longitude:-122.42,timezone:'America/Los_Angeles'};
      window.fetch = async (input, init) => {
        const url = new URL(String(input), location.origin);
        if (!url.pathname.startsWith('/api/weather')) return actualFetch(input, init);
        window.__weatherCalls.push(url.pathname);
        if (window.__weatherOffline) throw new Error('Simulated offline');
        let value;
        if (url.pathname === '/api/weather/location') value = city;
        else if (url.pathname === '/api/weather/locations') value = [{...city,name:'手动测试城市',latitude:38}];
        else value = {latitude:Number(url.searchParams.get('latitude')),longitude:Number(url.searchParams.get('longitude')),timezone:city.timezone,
          temperature:18.5,weatherCode:63,cloudCover:84,rain:1,showers:0,precipitation:1,isDay:true,
          observedAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),days:[],stale:false,source:'Open-Meteo'};
        return new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
      };
    })()`);
    await click('.weather-badge');
    await click('[data-weather-source="live"]');
    await waitFor("document.querySelector('.weather-city').textContent.includes('界面测试城市') && document.querySelector('.weather-readout').textContent.includes('19°C')", 'live city weather');
    checks.liveWeatherCityApplied = await evaluate("document.querySelector('.weather-badge').textContent.includes('界面测试城市') && document.querySelector('.weather-badge').dataset.weatherMode === 'live' && document.documentElement.dataset.weather === 'rain'");
    await evaluate(`(() => {
      const input = document.querySelector('.weather-city-search input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Test city');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await click('.weather-city-search button');
    await waitFor("Boolean(document.querySelector('.weather-city-results button'))", 'city search');
    await click('.weather-city-results button');
    await waitFor("document.querySelector('.weather-badge').textContent.includes('手动测试城市') && document.querySelector('.weather-readout').textContent.includes('19°C')", 'manual city selected');
    checks.manualWeatherCityPersists = await evaluate("JSON.parse(localStorage.getItem('daylight-weather')).locationMode === 'manual' && JSON.parse(localStorage.getItem('daylight-weather')).location.name === '手动测试城市'");
    await evaluate('window.__weatherOffline = true');
    await click('button[aria-label="刷新天气"]');
    await waitFor("document.querySelector('.weather-badge').textContent.includes('缓存')", 'cached weather after network failure');
    checks.offlineWeatherIsLabeled = await evaluate("document.querySelector('.weather-readout').textContent.includes('上次更新的天气')");
    await click('[data-weather-source="preview"]');
    await click('[data-weather-preset="noon"]');
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
    await evaluate(`(() => {
      // Exercise native animation calls in the otherwise hidden smoke renderer.
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});
      window.__taskAnimationKinds = [];
      window.__panelAnimations = 0;
      const original = Element.prototype.animate;
      Element.prototype.animate = function(frames, options) {
        const animation = original.call(this,frames,options);
        queueMicrotask(() => {
          if(animation.id.startsWith('daylight-task-')) window.__taskAnimationKinds.push(animation.id);
          if(animation.id === 'daylight-panel-enter') window.__panelAnimations++;
        });
        return animation;
      };
      [...document.querySelectorAll('.nav-item')].find(node => node.textContent.includes('全部任务')).click();
    })()`);
    await waitFor("window.__taskAnimationKinds.includes('daylight-task-enter')", 'newly visible task animates');
    checks.taskEntryAnimationWorks = await evaluate("window.__taskAnimationKinds.includes('daylight-task-enter')");
    checks.navigationHasSettlingMotion = await evaluate("window.__panelAnimations === 1");
    await evaluate("window.__taskAnimationKinds = []");
    await new Promise(resolve => setTimeout(resolve, 5500));
    checks.pollingDoesNotReplayTaskAnimation = await evaluate("window.__taskAnimationKinds.length === 0");
    checks.pollingDoesNotReplayPanelAnimation = await evaluate("window.__panelAnimations === 1");
    await evaluate("[...document.querySelectorAll('.nav-item')].find(node => node.querySelector('span')?.textContent === '今天').click()");
    const noonX = await evaluate("parseFloat(document.querySelector('.sky-atmosphere').style.getPropertyValue('--sun-x'))");
    await capture('noon');
    await previewWeather('sunset');
    const sunsetX = await evaluate("parseFloat(document.querySelector('.sky-atmosphere').style.getPropertyValue('--sun-x'))");
    checks.sunMovesWithClock = dawnX < noonX && noonX < sunsetX;
    checks.twilightPalette = await evaluate("['sunset','twilight'].includes(document.querySelector('.sky-atmosphere').dataset.phase)");
    await capture('sunset');
    await previewWeather('rain');
    checks.rainOnGlass = await evaluate("['.sidebar-atmosphere','.nav-item','.task-row','.progress-card','.agenda-section','.language-card'].every(parent => document.querySelector(parent + ' .glass-rain .rain-bead')) && document.querySelector('.sky-atmosphere').dataset.condition === 'rain'");
    checks.rainDoesNotBlockClicks = await evaluate("[...document.querySelectorAll('.glass-rain')].every(node => getComputedStyle(node).pointerEvents === 'none')");
    checks.rainAndTaskMotionEnabled = await evaluate("getComputedStyle(document.querySelector('.rain-trail')).animationName !== 'none' && document.querySelector('.task-list').dataset.taskMotion === 'on'");
    checks.rainDropsHaveVariedTransparentOptics = await evaluate(`(() => {
      const beads=[...document.querySelectorAll('.task-row .rain-bead')].slice(0,7);
      const backgrounds=new Set(beads.map(bead=>getComputedStyle(bead).backgroundImage));
      const glints=beads.map(bead=>Number(getComputedStyle(bead).getPropertyValue('--drop-glint')));
      return backgrounds.size>=5 && Math.max(...glints)<.5 && Math.max(...glints)-Math.min(...glints)>.12;
    })()`);
    await waitFor("document.querySelector('.sidebar-sunflower').dataset.rainReactive === 'true'", 'sunflower rain reaction');
    checks.rainSunflowersHaveIndependentTiming = await evaluate(`(() => {
      const flowers=[...document.querySelectorAll('.daylight-botanical .sunflower-illustration')];
      return flowers.length===2 && flowers.every(flower=>flower.dataset.animated==='true')
        && getComputedStyle(flowers[0]).getPropertyValue('--sunflower-cycle')!==getComputedStyle(flowers[1]).getPropertyValue('--sunflower-cycle')
        && document.querySelector('.brand .sunflower-mark').dataset.rainReactive==='false';
    })()`);
    checks.sunflowerContactThenRecoil = await evaluate(`(() => {
      const flower=document.querySelector('.sidebar-sunflower');
      const head=flower.querySelector('.sunflower-head-response');
      const drop=flower.querySelector('.sunflower-rain-contact-right .sunflower-impact-drop');
      const animations=flower.getAnimations({subtree:true});
      const saved=animations.map(animation=>({animation,time:animation.currentTime,state:animation.playState}));
      const sample=phase=>{
        for(const animation of animations){const timing=animation.effect.getTiming();animation.pause();animation.currentTime=timing.delay+(2+phase)*timing.duration;}
        return {head:getComputedStyle(head).transform,drop:Number(getComputedStyle(drop).opacity)};
      };
      try {
        const before=sample(.10),impact=sample(.124),rest=sample(.30);
        return animations.length>=4 && before.drop>.4 && impact.head!==before.head && rest.head===before.head && rest.drop===0;
      } finally {for(const item of saved){item.animation.currentTime=item.time;if(item.state==='running')item.animation.play();}}
    })()`);
    checks.dropsMergeIntoEachGlassBoundary = await evaluate(`(() => {
      return ['.sidebar-atmosphere','.nav-item','.task-row'].every(selector=>{
        const glass=document.querySelector(selector+' .glass-rain');
        const lane=glass.querySelector('.rain-runner-path');
        const drop=lane.querySelector('.rain-runner-drop');
        const pool=lane.querySelector('.rain-edge-pool');
        const animations=lane.getAnimations({subtree:true});
        const saved=animations.map(animation=>({animation,time:animation.currentTime,state:animation.playState}));
        const sample=phase=>{
          for(const animation of animations){const timing=animation.effect.getTiming();animation.pause();animation.currentTime=timing.delay+(2+phase)*timing.duration;}
          return {bottom:drop.getBoundingClientRect().bottom,height:drop.getBoundingClientRect().height,
            poolWidth:pool.getBoundingClientRect().width,poolOpacity:Number(getComputedStyle(pool).opacity)};
        };
        try {
          const arrived=sample(.87),absorbing=sample(.91),spread=sample(.94),gone=sample(.9999);
          const inset=parseFloat(getComputedStyle(glass).getPropertyValue('--rain-seam-inset'));
          return animations.length>=3 && Math.abs(arrived.bottom-(glass.getBoundingClientRect().bottom-inset))<1.1
            && absorbing.height<arrived.height*.6 && absorbing.poolOpacity>0
            && spread.poolWidth>absorbing.poolWidth && gone.poolOpacity<.01;
        } finally {for(const item of saved){item.animation.currentTime=item.time;if(item.state==='running')item.animation.play();}}
      });
    })()`);
    checks.previewLabelHonest = await evaluate("document.querySelector('.weather-badge').textContent.includes('效果预览')");
    checks.previewKeepsTaskDeadlines = (await bootstrap()).tasks.find(task => task.id === ids[1]).dueAt === fixtures[1].dueAt;
    await capture('rain');
    checks.fullWindowRain = await evaluate(`(() => {
      const rain = document.querySelector('.rain-field');
      const box = rain?.getBoundingClientRect();
      return box?.width >= innerWidth && box?.height >= innerHeight && getComputedStyle(rain).pointerEvents === 'none';
    })()`);
    checks.rainKeepsWorkspaceAvatarCompact = await evaluate("document.querySelector('.workspace .avatar').getBoundingClientRect().width < 40");
    await click('button.theme-toggle');
    await waitFor("document.documentElement.dataset.theme === 'night'", 'night rain');
    checks.nightWeatherIncludesRain = await evaluate("document.querySelector('.sky-atmosphere').dataset.condition === 'rain' && Boolean(document.querySelector('.rain-field')) && Boolean(document.querySelector('.celestial-moon')) && document.querySelectorAll('.sky-star').length >= 20");
    checks.cloudsDimMoonAndStars = await evaluate("parseFloat(getComputedStyle(document.querySelector('.sky-moon-position')).opacity) < .3 && parseFloat(getComputedStyle(document.querySelector('.sky-stars')).opacity) < .3");
    await capture('night-rain');
    await click('.workspace');
    await waitFor("Boolean(document.querySelector('[data-glass-control=\"motion\"]'))", 'rain motion settings');
    await click('[data-glass-control="motion"]');
    await waitFor("document.documentElement.dataset.glassMotion === 'off'", 'rain motion disabled');
    checks.rainAndTaskMotionDisabled = await evaluate("getComputedStyle(document.querySelector('.rain-trail')).animationName === 'none' && document.querySelector('.task-list').dataset.taskMotion === 'off'");
    checks.seamMotionStopsWithPreferences = await evaluate("getComputedStyle(document.querySelector('.rain-edge-pool')).animationName === 'none' && getComputedStyle(document.querySelector('.rain-runner-drop')).animationName === 'none'");
    await click('.glass-reset');
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
    await setVisibility(false);
    await waitFor("document.querySelector('.glass-rain').dataset.paused === 'true' && document.querySelector('.sky-atmosphere').dataset.animated === 'false'", 'hidden window pauses weather');
    checks.hiddenWindowPausesWeather = true;
    await evaluate("window.__transitionsBeforeHidden = window.__themeTransitions; document.querySelector('button.theme-toggle').click()");
    await waitFor("document.documentElement.dataset.theme === 'day'", 'hidden theme commits');
    checks.hiddenWindowSkipsThemeTransition = await evaluate("!document.documentElement.dataset.themeTransition && window.__themeTransitions === window.__transitionsBeforeHidden");
    checks.hiddenSunflowersPause = await evaluate("document.querySelector('.sidebar-sunflower').dataset.paused === 'true' && getComputedStyle(document.querySelector('.sunflower-head-response')).animationPlayState === 'paused'");
    await click('button.theme-toggle');
    await waitFor("document.documentElement.dataset.theme === 'night'", 'restore hidden night');
    await setVisibility(true);
    await waitFor("document.querySelector('.glass-rain').dataset.paused === 'false' && document.querySelector('.sky-atmosphere').dataset.animated === 'true'", 'visible window resumes weather');
    checks.visibleWindowResumesWeather = true;
    window.webContents.debugger.attach('1.3');
    try {
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await waitFor("document.querySelector('.glass-rain').dataset.animated === 'false'", 'system reduced motion');
      checks.systemReducedMotionStopsWeather = await evaluate("getComputedStyle(document.querySelector('.rain-trail')).animationName === 'none' && getComputedStyle(document.querySelector('.sky-cloud')).animationName === 'none'");
      await evaluate("window.__transitionsBeforeReducedMotion = window.__themeTransitions; document.querySelector('button.theme-toggle').click()");
      await waitFor("document.documentElement.dataset.theme === 'day'", 'reduced motion theme commits');
      checks.reducedMotionSkipsThemeTransition = await evaluate("!document.documentElement.dataset.themeTransition && window.__themeTransitions === window.__transitionsBeforeReducedMotion");
      checks.reducedMotionStopsSunflowers = await evaluate("getComputedStyle(document.querySelector('.sunflower-head-response')).animationName === 'none' && getComputedStyle(document.querySelector('.sunflower-rain-contacts')).display === 'none'");
      await click('.workspace');
      await waitFor("Boolean(document.querySelector('[data-replay-startup]'))", 'reduced motion startup settings');
      checks.reducedMotionDisablesStartupReplay = await evaluate("document.querySelector('[data-replay-startup]').disabled && !document.querySelector('.startup-scene') && !document.querySelector('.app-shell').inert");
      await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
      await waitFor("!document.querySelector('[role=dialog]')", 'reduced motion settings dismissed');
      await click('button.theme-toggle');
      await waitFor("document.documentElement.dataset.theme === 'night'", 'restore reduced motion night');
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[]});
      await replayStartup();
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await startupFinished();
      checks.reducedMotionImmediatelyEndsStartup = await evaluate("!document.querySelector('.startup-scene') && !document.querySelector('.app-shell').inert");
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'forced-colors',value:'active'}]});
      await click('.workspace');
      await waitFor("Boolean(document.querySelector('[data-replay-startup]'))", 'forced colors startup settings');
      await click('[data-replay-startup]');
      await startupFinished();
      checks.forcedColorsSkipsStartup = await evaluate("window.matchMedia('(forced-colors: active)').matches && !document.querySelector('.startup-scene') && !document.querySelector('.app-shell').inert");
      // A disabled replay control may keep settings open under forced colors.
      if (await evaluate("Boolean(document.querySelector('.overlay'))")) {
        await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
        await waitFor("!document.querySelector('.overlay')", 'forced colors settings dismissed');
      }
    } finally {
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[]});
      window.webContents.debugger.detach();
    }
    await previewWeather('noon');
    // Advance only the isolated renderer's real-clock source, with weather still
    // previewing noon. Backend task/reminder clocks remain untouched.
    try {
      await evaluate("window.__realDateNow = Date.now; window.__themeClock = Date.parse('2001-01-15T18:59:00-08:00'); Date.now = () => window.__themeClock; window.dispatchEvent(new Event('focus'))");
      await waitFor("document.documentElement.dataset.theme === 'day' && !sessionStorage.getItem('daylight-theme-override')", 'scheduled day before19');
      await evaluate("window.__themeClock = Date.parse('2026-10-02T18:59:00-07:00'); window.dispatchEvent(new Event('focus'))");
      await click('button.theme-toggle');
      await waitFor("document.documentElement.dataset.theme === 'night'", 'manual night before19');
      checks.manualNightDuringDay = true;
      await click('button.theme-toggle');
      await waitFor("document.documentElement.dataset.theme === 'day' && Boolean(sessionStorage.getItem('daylight-theme-override'))", 'manual day before19');
      await evaluate("window.__themeClock = Date.parse('2026-10-02T19:00:00-07:00'); window.dispatchEvent(new Event('focus'))");
      await waitFor("document.documentElement.dataset.theme === 'night' && !sessionStorage.getItem('daylight-theme-override')", '19night overrides earlier selection');
      checks.automaticNightAt19 = true;
      checks.weatherPreviewCannotChangeSchedule = await evaluate("JSON.parse(sessionStorage.getItem('daylight-weather-preview-session')).preview.minutes === 720 && document.documentElement.dataset.theme === 'night'");
      await click('button.theme-toggle');
      await waitFor("document.documentElement.dataset.theme === 'day'", 'temporary day after19');
      await evaluate("window.__themeClock = Date.parse('2026-10-03T00:30:00-07:00'); window.dispatchEvent(new Event('focus'))");
      checks.manualChoiceSurvivesMidnight = await evaluate("document.documentElement.dataset.theme === 'day' && JSON.parse(sessionStorage.getItem('daylight-theme-override')).theme === 'day'");
      await click('button.theme-toggle');
      await waitFor("document.documentElement.dataset.theme === 'night'", 'manual night before07');
      await evaluate("window.__themeClock = Date.parse('2026-10-03T07:00:00-07:00'); window.dispatchEvent(new Event('focus'))");
      await waitFor("document.documentElement.dataset.theme === 'day' && !sessionStorage.getItem('daylight-theme-override')", '07day resumes');
      checks.automaticDayAt07 = true;
    } finally {
      await evaluate("if(window.__realDateNow) Date.now = window.__realDateNow; window.dispatchEvent(new Event('focus'))");
    }
    assert.ok(Object.values(checks).every(Boolean), JSON.stringify(checks));
    return { checks, screenshots };
  } finally {
    for (const id of ids) await request(`/tasks/${id}`, 'DELETE');
  }
};
