// Development-only visual demonstration. Uses normal UI controls; never changes
// task data and is excluded from packaged builds.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
module.exports = async ({ window, origin, profileDir, root, mcp }) => {
  const runtime = path.join(root, '.runtime');
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'desktop-demo-process.json'), JSON.stringify({ pid: process.pid, origin, profileDir }));
  const evaluate = code => window.webContents.executeJavaScript(code);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const weather = process.argv[process.argv.indexOf('--demo-weather') + 1];
  const showDay = process.argv.includes('--demo-day');
  if (['rain', 'clear', 'storm'].includes(weather)) {
    const { resolveScheduledTheme } = await import(pathToFileURL(path.join(root, 'src', 'theme-schedule.js')).href);
    const periodKey = resolveScheduledTheme().periodKey;
    await evaluate(`(() => {
      let prefs; try { prefs = JSON.parse(localStorage.getItem('daylight-weather')); } catch {}
      localStorage.setItem('daylight-weather', JSON.stringify({...prefs,mode:'live'}));
      sessionStorage.setItem('daylight-weather-preview-session', JSON.stringify({mode:'preview',preview:{condition:${JSON.stringify(weather)},minutes:${showDay ? 720 : 1260}}}));
      sessionStorage.setItem('daylight-theme-override',JSON.stringify({theme:'night',periodKey:${JSON.stringify(periodKey)}}));
    })()`);
    await window.loadURL(origin);
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("Boolean(document.querySelector('[data-view=all]'))")) break;
    await wait(100);
  }
  await evaluate("document.querySelector('[data-view=all]')?.click()");
  for (let attempt = 0; attempt < 200 && mcp.getStatus().checking; attempt++) await wait(100);
  await wait(700);
  const motion = await evaluate(`(async () => {
    const canvas = document.querySelector('.rain-field-canvas');
    const trail = document.querySelector('.rain-trail');
    const pixels = canvas?.toDataURL(); const water = trail && getComputedStyle(trail).transform;
    await new Promise(resolve => setTimeout(resolve,750));
    return {rainMoves:canvas ? pixels !== canvas.toDataURL():null,waterMoves:trail ? water !== getComputedStyle(trail).transform:null,
      theme:document.documentElement.dataset.theme,weather:document.documentElement.dataset.weather,
      taskRows:document.querySelectorAll('.task-row').length,splashStyle:canvas?.dataset.splashStyle};
  })()`);
  await window.webContents.capturePage(); await wait(300);
  fs.writeFileSync(path.join(runtime, 'desktop-demo-tasks.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate(`(() => {
    window.__demoTransitions = [];
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = callback => {
      const record = {from:document.documentElement.dataset.theme,started:performance.now()};
      window.__demoTransitions.push(record);
      const transition = start(callback);
      transition.ready.then(() => {
        record.ready=performance.now();record.duration=getComputedStyle(document.documentElement,'::view-transition-new(root)').animationDuration;
        record.opacitySamples=[];
        const sample = () => {
          if(record.finished)return;
          record.opacitySamples.push({at:Math.round(performance.now()-record.ready),alpha:Number(getComputedStyle(document.documentElement,'::view-transition-new(root)').opacity)});
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }).catch(() => {record.skipped=true;});
      transition.finished.then(() => {record.finished=performance.now();record.to=document.documentElement.dataset.theme;});
      return transition;
    };
    document.querySelector('button.theme-toggle').click();
  })()`);
  for (let attempt=0;attempt<50;attempt++) {
    if (await evaluate("Boolean(window.__demoTransitions[0]?.ready)")) break;
    await wait(20);
  }
  await window.webContents.capturePage();
  await wait(320);
  fs.writeFileSync(path.join(runtime, 'desktop-demo-transition.png'), (await window.webContents.capturePage()).toPNG());
  await wait(700);
  fs.writeFileSync(path.join(runtime, 'desktop-demo-day.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('button.theme-toggle').click()");
  await wait(1200);
  const transitions = await evaluate('window.__demoTransitions');
  fs.writeFileSync(path.join(runtime, 'desktop-demo-status.json'), JSON.stringify({ mcp: mcp.getStatus(), motion, transitions }, null, 2));
  await evaluate("document.querySelector('[data-view=automation]')?.click()");
  await wait(600);
  fs.writeFileSync(path.join(runtime, 'desktop-demo-codex.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('[data-view=all]')?.click()");
  if (showDay) {
    await evaluate("if(document.documentElement.dataset.theme!=='day') document.querySelector('button.theme-toggle').click()");
    await wait(1100);
    const rainRefinement = await evaluate(`(async () => {
      const flower=document.querySelector('.sidebar-sunflower');
      const head=flower.querySelector('.sunflower-head-response');
      const stem=flower.querySelector('.sunflower-stem');
      const poses=new Set(),curves=new Set();
      for(let index=0;index<72;index++){
        poses.add(getComputedStyle(head).transform);curves.add(getComputedStyle(stem).d);
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      const beads=[...document.querySelectorAll('.task-row .rain-bead')].slice(0,7);
      return {sunflowerReactive:flower.dataset.rainReactive==='true',headPoses:poses.size,stemCurves:curves.size,
        variedDropMaterials:new Set(beads.map(bead=>getComputedStyle(bead).backgroundImage)).size,
        seamSurfaces:document.querySelectorAll('[data-edge-behavior=seam-absorb]').length};
    })()`);
    fs.writeFileSync(path.join(runtime,'desktop-rain-refinement.json'),JSON.stringify(rainRefinement,null,2));
    await evaluate("document.querySelector('button[aria-controls=task-filters]').click()");
    await wait(600);
    await window.webContents.capturePage();await wait(100);
    fs.writeFileSync(path.join(runtime,'desktop-demo-filters.png'),(await window.webContents.capturePage()).toPNG());
    await evaluate("document.querySelector('button[aria-controls=task-filters]').click()");
    await wait(300);
    await evaluate("document.querySelector('.task-main')?.click()");
    await wait(700);
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await wait(400);
    await window.webContents.capturePage();await wait(100);
    fs.writeFileSync(path.join(runtime,'desktop-demo-day.png'),(await window.webContents.capturePage()).toPNG());
  }
  window.show(); window.focus();
};
