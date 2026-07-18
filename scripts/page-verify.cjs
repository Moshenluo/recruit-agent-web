// 真渲染回归：用真实 Chromium 打开已部署 demo，逐标签页点击，确认不白屏、无运行时报错。
// 解析 playwright-core：优先项目依赖，回退到隔离 node 工作区（已在本地安装）。
function loadPlaywright() {
  const candidates = [
    'playwright-core',
    'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
    'C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core',
  ];
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* try next */ }
  }
  throw new Error('playwright-core 未找到：请在项目或隔离 node 工作区安装，或设置 NODE_PATH');
}
const { chromium } = loadPlaywright();

const EXE = 'C:\\Users\\Administrator\\.agent-browser\\browsers\\chrome-151.0.7922.34\\chrome.exe';
// 默认验证已部署的公网 Demo；本地回归可传 DEMO_URL=http://localhost:4173
const URL = process.env.DEMO_URL || 'https://moshenluo.github.io/recruit-agent-web/';
const OUT = 'C:\\Users\\Administrator\\WorkBuddy\\2026-07-17-21-05-12\\recruit-agent-web\\scripts\\demo-verify.png';

const TABS = ['总览看板', '腾讯文档', 'AI 初筛', 'AI 二筛', '约面排期', '实时监控'];

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  const failures = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  page.on('requestfailed', (r) => failures.push('REQFAIL ' + r.url() + ' :: ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => { if (r.status() >= 400) failures.push('HTTP ' + r.status() + ' ' + r.url()); });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => errs.push('GOTO ' + e.message));
  await page.waitForTimeout(3500);

  const rootLen = await page.evaluate(() => (document.getElementById('root') || {}).innerHTML?.length || 0);
  const initialText = await page.evaluate(() => document.body.innerText);
  const overall = {
    'root 已渲染': rootLen > 100,
    '标题含智聘通': initialText.includes('智聘通'),
    '含候选人/流程数据': /周敏|赵磊|郑爽|候选人|招聘漏斗|异常/.test(initialText),
  };

  // 逐标签页点击，确认切换后不白屏、无新增报错
  const tabResults = {};
  for (const label of TABS) {
    const before = errs.length;
    try {
      await page.click(`button:has-text("${label}")`, { timeout: 4000 });
      await page.waitForTimeout(800);
      const len = await page.evaluate(() => (document.getElementById('root') || {}).innerHTML?.length || 0);
      tabResults[label] = { rendered: len > 100, newErrors: errs.length - before };
    } catch (e) {
      tabResults[label] = { rendered: false, error: String(e).slice(0, 120) };
    }
  }

  const failedTabs = Object.entries(tabResults).filter(([, v]) => !v.rendered || v.newErrors > 0);
  console.log('OVERALL=' + JSON.stringify(overall));
  console.log('TABS=' + JSON.stringify(tabResults, null, 2));
  console.log('PAGEERRORS=' + JSON.stringify(errs));
  console.log('RESOURCE_FAILURES=' + JSON.stringify(failures));
  console.log('RESULT=' + (overall['root 已渲染'] && failedTabs.length === 0 ? 'PASS' : 'FAIL'));
  await page.screenshot({ path: OUT, fullPage: false });
  console.log('SCREENSHOT=' + OUT);
  await browser.close();
  process.exit(failedTabs.length === 0 && overall['root 已渲染'] ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
