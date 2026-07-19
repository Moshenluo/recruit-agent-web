// 复现脚本 v2：覆盖多种"输入数据"路径，检测崩溃/白屏
const fs = require('fs');
const os = require('os');
const path = require('path');
function loadPlaywright() {
  try { return { chromium: require('playwright-core').chromium }; }
  catch {
    try { return { chromium: require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core').chromium }; }
    catch (e) { console.error('playwright-core not found', e); process.exit(2); }
  }
}
const { chromium } = loadPlaywright();
const EXE = 'C:\\Users\\Administrator\\.agent-browser\\browsers\\chrome-151.0.7922.34\\chrome.exe';
const URL = process.env.DEMO_URL || 'http://localhost:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function clickByText(page, selector, text) {
  const els = await page.$$(selector);
  for (const el of els) {
    let t = '';
    try { t = await el.innerText(); } catch { t = ''; }
    if (t.includes(text)) { try { await el.click(); } catch {} return true; }
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.stack || e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(2500);
  log('LOADED, errors=', errors.length, 'rootLen=', (await page.$eval('#root', (e) => e.innerHTML.length).catch(() => -1)));

  // 准备一个临时 txt 简历文件用于拖拽
  const tmp = path.join(os.tmpdir(), '简历_张小明.txt');
  fs.writeFileSync(tmp, '张三 应聘前端工程师\n熟悉 React TypeScript 可视化\n本科 211院校\n3年经验');

  // ---- 路径 A：拖拽 txt 文件导入 ----
  await clickByText(page, 'nav button', '腾讯文档');
  await sleep(600);
  const fileInput = await page.$('input[type=file]:not([webkitdirectory]):not([directory])');
  if (fileInput) { await fileInput.setInputFiles(tmp).catch((e) => log('setInputFiles err', e.message)); }
  await sleep(1200);
  await clickByText(page, 'button', '批量汇总至腾讯文档');
  await sleep(1500);
  log('PathA drag-upload done, errors=', errors.length, 'rootLen=', await page.$eval('#root', (e) => e.innerHTML.length).catch(() => -1));

  // ---- 路径 B：手动录入【空岗位】（只填姓名） ----
  const inputs = await page.$$('input');
  for (const inp of inputs) {
    const ph = await inp.getAttribute('placeholder');
    if (ph && ph.includes('张三')) { await inp.fill('空岗位候选人'); break; }
  }
  await clickByText(page, 'button', '提交并汇总至腾讯文档');
  await sleep(1200);
  log('PathB empty-position upload done, errors=', errors.length);

  // ---- 路径 C：AI 初筛，直接对种子候选人运行（不输入要求文本） ----
  await clickByText(page, 'nav button', 'AI 初筛');
  await sleep(700);
  const clickedC = await clickByText(page, 'button', '周敏');
  log('PathC clicked 周敏?', clickedC);
  await sleep(500);
  await clickByText(page, 'button', '执行 AI 初筛');
  await sleep(1200);
  log('PathC 初筛 run done, errors=', errors.length, 'rootLen=', await page.$eval('#root', (e) => e.innerHTML.length).catch(() => -1));

  // 再对"空岗位候选人"运行初筛
  const clickedC2 = await clickByText(page, 'button', '空岗位候选人');
  log('PathC clicked 空岗位?', clickedC2);
  await sleep(400);
  await clickByText(page, 'button', '执行 AI 初筛');
  await sleep(1200);
  log('PathC2 done, errors=', errors.length, 'rootLen=', await page.$eval('#root', (e) => e.innerHTML.length).catch(() => -1));

  // ---- 路径 D：AI 二筛 ----
  await clickByText(page, 'nav button', 'AI 二筛');
  await sleep(700);
  const clickedD = await clickByText(page, 'button', '杨光');
  log('PathD clicked 杨光?', clickedD);
  await sleep(400);
  await clickByText(page, 'button', '执行 AI 二筛');
  await sleep(1200);
  log('PathD 二筛 done, errors=', errors.length, 'rootLen=', await page.$eval('#root', (e) => e.innerHTML.length).catch(() => -1));

  // 截图
  await page.screenshot({ path: 'C:/Users/Administrator/WorkBuddy/2026-07-17-21-05-12/recruit-agent-web/scripts/repro.png' }).catch(() => {});

  log('TOTAL ERRORS=', errors.length);
  if (errors.length) log(JSON.stringify(errors.slice(0, 10), null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
