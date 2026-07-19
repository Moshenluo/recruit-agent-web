// 验证「腾讯文档·招聘简历库」手动编辑与删除：打开弹窗改数据、保存、删除并确认
const os = require('os');
const path = require('path');
function loadPlaywright() {
  const candidates = [
    'playwright-core',
    'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
    'C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core',
  ];
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* try next */ }
  }
  throw new Error('playwright-core not found');
}
const { chromium } = loadPlaywright();
const EXE = 'C:\\Users\\Administrator\\.agent-browser\\browsers\\chrome-151.0.7922.34\\chrome.exe';
const URL = process.env.DEMO_URL || 'https://moshenluo.github.io/recruit-agent-web/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function clickByText(page, selector, text) {
  const els = await page.$$(selector);
  for (const el of els) {
    let t = ''; try { t = await el.innerText(); } catch { t = ''; }
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
  await clickByText(page, 'nav button', '腾讯文档');
  await sleep(800);

  const rootText0 = await page.evaluate(() => document.getElementById('root').innerText);
  const beforeCount = (rootText0.match(/操作/g) || []).length;
  log('初始：简历库表头含"操作"列?', rootText0.includes('操作'), '| 行数(操作出现次数):', beforeCount);

  // ---- 编辑：取第一行候选人 ----
  const firstRowName = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    if (!rows.length) return null;
    return rows[0].querySelector('td:nth-child(2)')?.innerText || null;
  });
  log('首行候选人:', firstRowName);

  // 点击首行编辑按钮
  await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    const btn = rows[0]?.querySelector('button');
    if (btn) btn.click();
  });
  await sleep(800);

  // 编辑弹窗是否打开（含"编辑候选人信息"标题）
  const dlgOpen = (await page.evaluate(() => document.body.innerText)).includes('编辑候选人信息');
  log('编辑弹窗已打开?', dlgOpen);

  // 改姓名（dialog 内第一个 input）
  const inputs = await page.$$('.t-dialog__body input');
  log('弹窗内 input 数量:', inputs.length);
  const newName = (firstRowName || '候选人') + '_已修';
  if (inputs.length) { await inputs[0].fill(newName); }
  await sleep(300);

  // 点保存
  await page.click('.t-dialog__footer button:has-text("保存")').catch(async () => { await clickByText(page, 'button', '保存'); });
  await sleep(1000);

  const afterText = await page.evaluate(() => document.getElementById('root').innerText);
  log('保存后表格含新姓名?', afterText.includes(newName));

  // ---- 删除：对该行点删除并确认 ----
  await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    const btns = rows[0]?.querySelectorAll('button');
    // 第二个按钮是删除
    btns && btns[1] && btns[1].click();
  });
  await sleep(800);
  const confirmOpen = (await page.evaluate(() => document.body.innerText)).includes('确认删除');
  log('删除确认弹窗已打开?', confirmOpen);

  const beforeDelCount = (await page.$$('table tbody tr')).length;
  await page.click('.t-dialog__footer button:has-text("删除")').catch(async () => { await clickByText(page, 'button', '删除'); });
  await sleep(1000);
  const afterDelCount = (await page.$$('table tbody tr')).length;
  log('删除前行数:', beforeDelCount, '| 删除后行数:', afterDelCount, '| 减少:', beforeDelCount - afterDelCount);

  log('TOTAL ERRORS=', errors.length);
  if (errors.length) log(JSON.stringify(errors.slice(0, 10), null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
