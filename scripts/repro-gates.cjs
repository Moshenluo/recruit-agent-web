// 初筛硬闸口复现：测试 学历/院校 通过、淘汰、信息缺失 三种结果
const fs = require('fs');
const os = require('os');
const path = require('path');
function loadPlaywright() {
  try { return { chromium: require('playwright-core').chromium }; }
  catch { try { return { chromium: require('C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core').chromium }; } catch (e) { console.error('no pw', e); process.exit(2); } }
}
const { chromium } = loadPlaywright();
const EXE = 'C:\\Users\\Administrator\\.agent-browser\\browsers\\chrome-151.0.7922.34\\chrome.exe';
const URL = process.env.DEMO_URL || 'https://moshenluo.github.io/recruit-agent-web/';
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
async function fillInput(page, placeholder, value) {
  for (const inp of await page.$$('input')) {
    const ph = await inp.getAttribute('placeholder');
    if (ph && ph.includes(placeholder)) { await inp.fill(value); return true; }
  }
  return false;
}
async function rootLen(page) { try { return await page.$eval('#root', (e) => e.innerHTML.length); } catch { return -1; } }

async function uploadCandidate(page, name, position, edu, school) {
  await clickByText(page, 'nav button', '腾讯文档');
  await sleep(500);
  await fillInput(page, '张三', name);
  if (position) await fillInput(page, '前端工程师', position);
  if (edu) await fillInput(page, '本科 / 硕士', edu);
  if (school) await fillInput(page, '985 / 211', school);
  await clickByText(page, 'button', '提交并汇总至腾讯文档');
  await sleep(1000);
}

async function runInitialScreening(page, name) {
  await clickByText(page, 'nav button', 'AI 初筛');
  await sleep(600);
  await clickByText(page, 'button', name);
  await sleep(400);
  await clickByText(page, 'button', '执行 AI 初筛');
  await sleep(1200);
  // 读取结果面板文本
  const txt = await page.$eval('#root', (e) => e.innerText).catch(() => '');
  return txt;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.stack || e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(2500);
  log('LOADED rootLen=', await rootLen(page), 'errors=', errors.length);

  // 用例1：本科 + 985 → 应通过硬闸口（再看技能分）
  await uploadCandidate(page, '闸门合格者', '前端工程师', '本科', '985');
  let t1 = await runInitialScreening(page, '闸门合格者');
  log('用例1 本科/985 结果含"直接过"或"人工复核":', /直接过|人工复核|淘汰/.test(t1), '| 含硬闸口:', t1.includes('硬闸口'));
  log('  片段:', (t1.match(/初筛硬闸口[^\n]*/) || [''])[0], (t1.match(/(直接过|人工复核|淘汰)[^\n]*/) || [''])[0]);

  // 用例2：大专 + 普通本科 → 应淘汰（硬闸口未通过）
  await uploadCandidate(page, '闸门淘汰者', '前端工程师', '大专', '普通本科');
  let t2 = await runInitialScreening(page, '闸门淘汰者');
  log('用例2 大专/普通本科 含"淘汰":', t2.includes('淘汰'), '| 含硬闸口:', t2.includes('硬闸口'));
  log('  片段:', (t2.match(/初筛硬闸口[^\n]*/) || [''])[0], (t2.match(/(直接过|人工复核|淘汰)[^\n]*/) || [''])[0]);

  // 用例3：拖拽 txt（无学历/院校）→ 应人工复核（信息缺失）
  const tmp = path.join(os.tmpdir(), '简历_信息缺失.txt');
  fs.writeFileSync(tmp, '李明 应聘前端工程师\n熟悉 React TypeScript');
  await clickByText(page, 'nav button', '腾讯文档');
  await sleep(500);
  const fileInput = await page.$('input[type=file]:not([webkitdirectory]):not([directory])');
  if (fileInput) await fileInput.setInputFiles(tmp);
  await sleep(1000);
  await clickByText(page, 'button', '批量汇总至腾讯文档');
  await sleep(1000);
  let t3 = await runInitialScreening(page, '李明');
  log('用例3 拖拽无学历 含"人工复核":', t3.includes('人工复核'), '| 含"缺少学历":', t3.includes('缺少学历'));
  log('  片段:', (t3.match(/初筛硬闸口[^\n]*/) || [''])[0], (t3.match(/(直接过|人工复核|淘汰)[^\n]*/) || [''])[0]);

  log('TOTAL ERRORS=', errors.length);
  if (errors.length) log(JSON.stringify(errors.slice(0, 10), null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
