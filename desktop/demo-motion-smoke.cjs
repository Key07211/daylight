// Verify visible product motion, not just a loaded media element or page transition.
// Run: electron desktop/demo-motion-smoke.cjs [--url=https://.../demo.html]
// Uses an isolated profile; never loads the application service or user tasks.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime');
fs.mkdirSync(runtime, { recursive: true });
const profile = fs.mkdtempSync(path.join(runtime, 'demo-motion-'));
app.setPath('userData', profile);
nativeTheme.themeSource = 'light';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let window;
const report = { isolated: true, samples: [], errors: [] };
const deadline = setTimeout(() => { console.error('Demo motion check timed out.'); app.exit(1); }, 75000);
deadline.unref();

async function evaluate(source) { return window.webContents.executeJavaScript(source, true); }
async function frame() {
  const rectangle = await evaluate(`(() => {
    const box = document.querySelector('#zoom-image').getBoundingClientRect();
    return { x: Math.ceil(box.x + 8), y: Math.ceil(box.y + 8),
      width: Math.floor(box.width - 16), height: Math.floor(box.height - 16) };
  })()`);
  const image = await window.webContents.capturePage(rectangle);
  return sharp(image.toPNG()).resize({ width: 720 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}
function changedPixels(first, second) {
  if (first.data.length !== second.data.length) throw new Error('Preview changed dimensions during sampling.');
  let changed = 0;
  for (let offset = 0; offset < first.data.length; offset += first.info.channels) {
    let maximum = 0;
    for (let channel = 0; channel < first.info.channels; channel++) {
      maximum = Math.max(maximum, Math.abs(first.data[offset + channel] - second.data[offset + channel]));
    }
    if (maximum > 5) changed++;
  }
  return changed;
}
async function sample(name, controls = [], expectedMotion = true) {
  for (const selector of controls) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }
  await evaluate(`Promise.all([...document.querySelectorAll('#zoom-image img')].map(image => image.decode()))`);
  // Let the chapter's entrance animation settle before testing persistent motion.
  await delay(1600);
  const first = await frame();
  let changed = 0;
  for (let iteration = 0; iteration < 3; iteration++) {
    await delay(420);
    changed = Math.max(changed, changedPixels(first, await frame()));
  }
  const fraction = changed / (first.info.width * first.info.height);
  const result = { scene: name, expectedMotion, changedPixels: changed, changedFraction: Number(fraction.toFixed(6)), pass: (fraction > 0.0005) === expectedMotion };
  report.samples.push(result);
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${name}: ${changed} changing scene pixels (${(fraction * 100).toFixed(3)}%)`);
}

app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1440, height: 1100,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setFrameRate(30);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('console-message', event => {
    if (event.level === 'error' || event.level === 3) report.errors.push(event.message);
  });
  await window.loadURL('about:blank');
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  const urlArgument = process.argv.find(argument => argument.startsWith('--url='));
  const url = new URL(urlArgument?.slice(6) || pathToFileURL(path.join(root, 'docs', 'demo.html')).href);
  for (const language of ['en', 'zh']) {
    url.searchParams.set('lang', language);
    await window.loadURL(url.href);
    assert.equal(await evaluate('document.documentElement.lang'), language === 'en' ? 'en' : 'zh-CN');
    await sample(`${language}: default daylight`);
    if (language === 'en') {
      await sample('en: paused daylight', ['#motion-toggle'], false);
      assert.equal(await evaluate('document.querySelector("#motion-toggle").getAttribute("aria-pressed")'), 'false');
      await sample('en: resumed daylight', ['#motion-toggle']);
      assert.equal(await evaluate('document.querySelector("#motion-toggle").getAttribute("aria-pressed")'), 'true');
    }
    await sample(`${language}: night`, ['[data-chapter="atmosphere"]', '[data-shot="tasks-night"]']);
    await sample(`${language}: rain`, ['[data-chapter="atmosphere"]', '[data-shot="tasks-rain"]']);
  }
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  url.searchParams.set('lang', 'en');
  await window.loadURL(url.href);
  assert.equal(await evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'), true);
  await sample('en: reduced-motion initial view', [], false);
  assert.equal(await evaluate('document.querySelector("#motion-toggle").getAttribute("aria-pressed")'), 'false');
  report.passed = report.samples.every(sample => sample.pass) && report.errors.length === 0;
  fs.writeFileSync(path.join(runtime, 'demo-motion-report.json'), JSON.stringify(report, null, 2));
  app.exit(report.passed ? 0 : 1);
}).catch(error => { console.error(error.message); app.exit(1); });
