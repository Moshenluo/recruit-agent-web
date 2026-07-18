function loadPlaywright() {
  const candidates = [
    'playwright-core',
    'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
    'C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core',
  ];
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* try next */ }
  }
  throw new Error('playwright-core 未找到');
}
const { chromium } = loadPlaywright();
const EXE = 'C:\\Users\\Administrator\\.agent-browser\\browsers\\chrome-151.0.7922.34\\chrome.exe';
const URL = process.env.DEMO_URL || 'https://moshenluo.github.io/recruit-agent-web/';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push('[console.' + m.type() + '] ' + m.text()));
  page.on('pageerror', e => logs.push('[PAGEERROR] ' + (e.stack || e.message)));
  page.on('requestfailed', r => logs.push('[REQFAIL] ' + r.url() + ' :: ' + (r.failure() && r.failure().errorText)));
  page.on('response', r => { if (r.status() >= 400) logs.push('[HTTP ' + r.status() + '] ' + r.url()); });

  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener('error', e => {
      window.__errs.push('ERR: ' + (e.message || '') + ' | ' + (e.filename || '') + ':' + (e.lineno || ''));
    });
    window.addEventListener('unhandledrejection', e => {
      window.__errs.push('REJECT: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason));
    });
  });

  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  } catch (e) {
    logs.push('[GOTO] ' + e.message);
  }
  await page.waitForTimeout(4000);

  const rootLen = await page.evaluate(() => {
    const r = document.getElementById('root');
    return r ? r.innerHTML.length : -1;
  });
  const errs = await page.evaluate(() => window.__errs || []);

  console.log('ROOT_LEN=' + rootLen);
  console.log('CAPTURED_ERRS=' + JSON.stringify(errs, null, 2));
  console.log('=== LOGS ===');
  console.log(logs.join('\n'));

  await browser.close();
})().catch(e => { console.error('SCRIPT FATAL:', e); process.exit(1); });
