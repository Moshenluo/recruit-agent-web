// 压力复现：长时间运行 + 多次上传/执行/重置，捕获任何崩溃/错误边界
const fs = require('fs');
const os = require('os');
const path = require('path');
function loadPlaywright() {
  try { return { chromium: require('playwright-core').chromium }; }
  catch { try { return { chromium: require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core').chromium }; } catch (e) { console.error('no pw', e); process.exit(2); } }
}
const { chromium } = loadPlaywright();
const EXE = 'C:\\Users\\Administrator\\.agent-browser\\browsers\\chrome-151.0.7922.34\\chrome.exe';
const URL = process.env.DEMO_URL || 'http://localhost:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function clickByText(page, selector, text) {
  const els = await page.$$(selector);
  for (const el of els) {
    let t = ''; try { t = await el.innerText(); } catch {}
    if (t.includes(text)) { try { await el.click(); } catch {} return true; }
  }
  return false;
}
async function rootLen(page) { try { return await page.$eval('#root', (e) => e.innerHTML.length); } catch { return -1; } }
async function hasErrorBoundary(page) {
  try {
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 500));
    return /Something went wrong|出错了|Error:.{0,40}/.test(txt);
  } catch { return false; }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.stack || e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(3000);
  log('LOADED rootLen=', await rootLen(page), 'errors=', errors.length);

  // 反复：上传→初筛→二筛→重置
  for (let i = 1; i <= 3; i++) {
    await clickByText(page, 'nav button', '腾讯文档');
    await sleep(400);
    const inputs = await page.$$('input');
    for (const inp of inputs) { const ph = await inp.getAttribute('placeholder'); if (ph && ph.includes('张三')) { await inp.fill('压力候选人' + i); break; } }
    for (const inp of await page.$$('input')) { const ph = await inp.getAttribute('placeholder'); if (ph && ph.includes('前端工程师')) { await inp.fill('前端工程师'); break; } }
    await clickByText(page, 'button', '提交并汇总至腾讯文档');
    await sleep(800);

    await clickByText(page, 'nav button', 'AI 初筛');
    await sleep(400);
    await clickByText(page, 'button', '压力候选人' + i);
    await sleep(300);
    // 生成提示词 + 执行
    await clickByText(page, 'button', '生成专业提示词');
    await sleep(500);
    await clickByText(page, 'button', '执行 AI 初筛');
    await sleep(800);
    log(`iter ${i} 初筛 done rootLen=`, await rootLen(page), 'errB= ', await hasErrorBoundary(page), 'errs=', errors.length);

    // 让引擎推进到二筛
    await sleep(2500);
    await clickByText(page, 'nav button', 'AI 二筛');
    await sleep(400);
    const c2 = await clickByText(page, 'button', '压力候选人' + i);
    if (c2) { await sleep(300); await clickByText(page, 'button', '执行 AI 二筛'); await sleep(800); }
    log(`iter ${i} 二筛 done rootLen=`, await rootLen(page), 'errB= ', await hasErrorBoundary(page), 'errs=', errors.length);

    // 重置
    await clickByText(page, 'button', '重置演示');
    await sleep(1500);
    log(`iter ${i} reset done errs=`, errors.length);
  }

  log('TOTAL ERRORS=', errors.length);
  if (errors.length) log(JSON.stringify(errors.slice(0, 12), null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
