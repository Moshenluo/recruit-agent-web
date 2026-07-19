/**
 * 智聘通 · 纯前端演示引擎（standalone demo engine）
 * ------------------------------------------------------------
 * 与 server/automation.ts 逻辑一致，但完全运行在浏览器中（无后端依赖），
 * 用于「公网部署演示 demo」：构建时注入 VITE_DEMO=true 即可让前端自包含运行。
 * 引擎为确定性规则实现（与后端一致），不依赖真实 LLM，可离线演示全流程：
 *   简历收集 → AI 初筛 → 拉群协作 → 部门二筛(AI 二筛) → 群面(约面) → 群面结果
 *   → 结果通知 → 复试(约面) → 复试结果
 */

type StageKey =
  | 'resume_collection'
  | 'initial_screening'
  | 'group_creation'
  | 'secondary_screening'
  | 'interview_list'
  | 'interview_schedule'
  | 'interview_result'
  | 'result_notification'
  | 'retest_list'
  | 'retest_schedule'
  | 'retest_result';

interface Cand {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  source: string | null;
  education: string | null; // 学历（初筛硬闸口）
  school: string | null; // 院校（初筛硬闸口）
  resume_path: string | null;
  stage: StageKey;
  stage_history: Array<{ stage: string; timestamp: string; note: string }>;
  tags: string[];
  interview_time: string | null;
  interviewers: string[];
  interview_result: string | null;
  retest_time: string | null;
  retest_result: string | null;
  remark: string | null;
  availability: string[];
  parked: number;
  created_at: string;
  updated_at: string;
}

interface Interviewer {
  id: string;
  name: string;
  dept: string | null;
  role: string | null;
  available_slots: string[];
}

interface InterviewItem {
  id: string;
  candidate_id: string;
  candidate_name: string | null;
  type: string;
  position: string | null;
  scheduled_time: string | null;
  duration_minutes: number;
  interviewers: string[];
  location: string | null;
  status: string;
  result: string | null;
  feedback: string | null;
  created_at: string;
  updated_at: string;
}

interface ScreenRec {
  id: string;
  candidate_id: string;
  candidate_name: string | null;
  position: string | null;
  dept_requirement: string;
  prompt: string;
  confidence: number;
  decision: 'pass' | 'review' | 'reject';
  matched_skills: string[];
  note: string | null;
  phase: 'initial' | 'secondary';
  created_at: string;
}

interface AgentLog {
  id: string;
  type: string;
  message: string;
  candidate_id: string | null;
  created_at: string;
}

interface Anomaly {
  id: string;
  type: 'slow_advance' | 'slow_recognition' | 'data_missing';
  typeLabel: string;
  name: string;
  stage: string;
  stageLabel: string;
  minutes: number;
  hint: string;
  severity: 'high' | 'mid' | 'low';
}

const STAGE_ORDER: StageKey[] = [
  'resume_collection', 'initial_screening', 'group_creation', 'secondary_screening',
  'interview_list', 'interview_schedule', 'interview_result', 'result_notification',
  'retest_list', 'retest_schedule', 'retest_result',
];

const STAGE_LABELS: Record<string, string> = {
  resume_collection: '简历收集',
  initial_screening: 'AI初筛',
  group_creation: '拉群协作',
  secondary_screening: '部门二筛',
  interview_list: '群面名单',
  interview_schedule: '群面安排',
  interview_result: '群面结果',
  result_notification: '结果通知',
  retest_list: '复试名单',
  retest_schedule: '复试安排',
  retest_result: '复试结果',
};

function nowISO(): string {
  return new Date().toISOString();
}
function hashName(name: string): number {
  return [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
}

// ============= 时间槽 =============
function buildSlotPool(): string[] {
  const pool: string[] = [];
  const base = new Date();
  const hours = [10, 11, 14, 15, 16];
  for (let day = 1; day <= 3; day++) {
    const d = new Date(base);
    d.setDate(d.getDate() + day);
    for (const h of hours) {
      const p = (n: number) => String(n).padStart(2, '0');
      pool.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(h)}:00`);
    }
  }
  return pool;
}
const SLOT_POOL = buildSlotPool();

function slotsFor(seed: number, extra: number): string[] {
  const common = [SLOT_POOL[0], SLOT_POOL[1]];
  const picks: string[] = [];
  let s = seed;
  for (let i = 0; i < extra; i++) {
    s = (s * 1103515245 + 12345) % SLOT_POOL.length;
    picks.push(SLOT_POOL[s]);
  }
  return Array.from(new Set([...common, ...picks])).sort();
}

// ============= 画像 =============
interface Profile {
  name: string;
  position: string;
  dept: string;
  source: string;
  exp: string;
  tags: string[];
  interviewer: string;
  interviewer2: string;
  phone: string;
  email: string;
  education: string;
  school: string;
}
const PROFILES: Profile[] = [
  { name: '张伟', position: '前端工程师', dept: '研发', source: 'BOSS直聘', exp: '3年', tags: ['React', 'TypeScript'], interviewer: '李工', interviewer2: '王总监', phone: '13800001111', email: 'zhangwei@demo.com', education: '本科', school: '985' },
  { name: '李娜', position: '产品经理', dept: '产品', source: '企业微信', exp: '5年', tags: ['B端', '数据驱动'], interviewer: '陈经理', interviewer2: '赵总', phone: '13800002222', email: 'lina@demo.com', education: '硕士', school: '211' },
  { name: '王强', position: 'Java工程师', dept: '研发', source: 'BOSS直聘', exp: '4年', tags: ['SpringCloud', '高并发'], interviewer: '李工', interviewer2: '王总监', phone: '13800003333', email: 'wangqiang@demo.com', education: '本科', school: '211' },
  { name: '刘洋', position: 'UI设计师', dept: '设计', source: '内推', exp: '2年', tags: ['Figma', '交互'], interviewer: '孙设计', interviewer2: '周导', phone: '13800004444', email: 'liuyang@demo.com', education: '本科', school: '双一流' },
  { name: '陈静', position: '测试工程师', dept: '研发', source: 'BOSS直聘', exp: '3年', tags: ['自动化', '性能'], interviewer: '李工', interviewer2: '王总监', phone: '13800005555', email: 'chenjing@demo.com', education: '本科', school: '211' },
  { name: '杨光', position: '数据分析师', dept: '数据', source: '企业微信', exp: '4年', tags: ['SQL', 'Python'], interviewer: '钱博', interviewer2: '孙总', phone: '13800006666', email: 'yangguang@demo.com', education: '硕士', school: '985' },
  { name: '赵磊', position: '后端工程师', dept: '研发', source: '内推', exp: '6年', tags: ['Go', '微服务'], interviewer: '李工', interviewer2: '王总监', phone: '13800007777', email: 'zhaolei@demo.com', education: '本科', school: '985' },
  { name: '周敏', position: '运营专员', dept: '运营', source: 'BOSS直聘', exp: '2年', tags: ['社群', '内容'], interviewer: '吴运营', interviewer2: '郑总', phone: '13800008888', email: 'zhoumin@demo.com', education: '本科', school: '双一流' },
  { name: '吴桐', position: '算法工程师', dept: '算法', source: '企业微信', exp: '5年', tags: ['NLP', '深度学习'], interviewer: '冯博', interviewer2: '蒋总', phone: '13800009999', email: 'wutong@demo.com', education: '博士', school: '海外名校' },
  { name: '郑爽', position: 'HRBP', dept: 'HR', source: '内推', exp: '3年', tags: ['组织发展', '招聘'], interviewer: '沈HR', interviewer2: '韩总', phone: '13800010000', email: 'zhengshuang@demo.com', education: '本科', school: '211' },
  { name: '孙浩', position: '前端工程师', dept: '研发', source: 'BOSS直聘', exp: '4年', tags: ['Vue', '可视化'], interviewer: '李工', interviewer2: '王总监', phone: '13800011111', email: 'sunhao@demo.com', education: '硕士', school: '985' },
  { name: '马琳', position: '产品经理', dept: '产品', source: '企业微信', exp: '6年', tags: ['C端', '增长'], interviewer: '陈经理', interviewer2: '赵总', phone: '13800012222', email: 'malin@demo.com', education: '本科', school: '211' },
];

// ===== 初筛硬闸口（强制定死，不可由 HR 随意修改）=====
// 学历门槛：本科及以上，未达标直接淘汰
// 院校门槛：985 / 211 / 双一流 / 海外名校，未达标直接淘汰
const EDU_RANK: Record<string, number> = { 高中: 1, 中专: 2, 大专: 3, 本科: 4, 硕士: 5, 博士: 6 };
const MIN_EDU = '本科';
const ALLOWED_SCHOOLS = ['985', '211', '双一流', '海外名校'];

export function evaluateHardGates(c: { education: string | null; school: string | null }): {
  passed: boolean;
  failed: 'missing' | 'education' | 'school' | null;
  detail: string;
} {
  if (!c.education || !c.school) {
    return { passed: false, failed: 'missing', detail: '缺少学历 / 院校信息，硬闸口无法判定' };
  }
  const er = EDU_RANK[c.education] || 0;
  const mr = EDU_RANK[MIN_EDU] || 0;
  if (er < mr) {
    return { passed: false, failed: 'education', detail: `学历「${c.education}」未达本科门槛` };
  }
  if (!ALLOWED_SCHOOLS.includes(c.school)) {
    return { passed: false, failed: 'school', detail: `院校「${c.school}」非 985/211/双一流/海外名校` };
  }
  return { passed: true, failed: null, detail: '学历 / 院校均达标' };
}

export const INITIAL_HARD_GATES = {
  minEducation: MIN_EDU,
  allowedSchools: ALLOWED_SCHOOLS,
  educationLabel: `学历门槛：${MIN_EDU}及以上（未达标直接淘汰）`,
  schoolLabel: `院校门槛：${ALLOWED_SCHOOLS.join(' / ')}（未达标直接淘汰）`,
};

function defaultRequirement(position: string | null, dept: string): string {
  const map: Record<string, string> = {
    前端工程师: '具备 React / TypeScript 3 年以上经验，熟悉可视化与性能优化，有大型项目经验优先',
    后端工程师: '精通 Go / Java 服务端开发，熟悉微服务与高并发架构，有分布式经验优先',
    Java工程师: '精通 SpringCloud 微服务，熟悉高并发与分布式事务，有大流量系统经验优先',
    测试工程师: '掌握自动化测试与性能压测，熟悉接口测试框架，有 CI/CD 经验优先',
    UI设计师: '熟练使用 Figma，具备交互设计能力，有 B 端 / C 端设计经验优先',
    数据分析师: '精通 SQL 与 Python，熟悉指标体系搭建与数据建模，有业务分析经验优先',
    算法工程师: '掌握 NLP 与深度学习，熟悉主流训练框架，有落地项目优先',
    产品经理: '具备 B 端 / C 端产品规划能力，数据驱动，有 0-1 经验优先',
    运营专员: '具备社群运营与内容策划能力，有增长活动经验优先',
    HRBP: '熟悉组织发展与招聘全流程，具备沟通协调与数据分析能力优先',
  };
  return map[position || ''] || `${dept}岗位，具备相关经验与专业能力，沟通协作良好，有团队项目经验优先`;
}

// ============= 置信度计算 =============
function matchTags(tags: string[], requirement: string): string[] {
  const reqNorm = requirement.toLowerCase().replace(/\s+/g, '');
  return tags.filter((t) => {
    const tl = t.toLowerCase().replace(/\s+/g, '');
    return tl.length >= 2 && reqNorm.includes(tl);
  });
}

function computeInitialScreeningConfidence(c: Cand, requirement: string): { confidence: number; matched: string[] } {
  const matched = matchTags(c.tags, requirement);
  const hash = hashName(c.name);
  let score: number;
  if (matched.length >= 2) score = 72 + (hash % 7) - 3;
  else if (matched.length === 1) score = 50 + (hash % 9) - 4;
  else score = 30 + (hash % 7) - 3;
  const pos = (c.position || '').toLowerCase().replace(/\s+/g, '');
  if (pos && (requirement.toLowerCase().replace(/\s+/g, '').includes(pos) || requirement.toLowerCase().replace(/\s+/g, '').includes(pos.slice(0, 2)))) score += 8;
  score = Math.max(8, Math.min(96, score));
  return { confidence: score, matched };
}

function computeScreeningConfidence(c: Cand, requirement: string): { confidence: number; matched: string[] } {
  const matched = matchTags(c.tags, requirement);
  const hash = hashName(c.name);
  let score: number;
  if (matched.length >= 2) score = 82 + (hash % 7) - 3;
  else if (matched.length === 1) score = 60 + (hash % 9) - 4;
  else score = 30 + (hash % 7) - 3;
  const pos = (c.position || '').toLowerCase().replace(/\s+/g, '');
  if (pos && (requirement.toLowerCase().replace(/\s+/g, '').includes(pos) || requirement.toLowerCase().replace(/\s+/g, '').includes(pos.slice(0, 2)))) score += 6;
  score = Math.max(8, Math.min(98, score));
  return { confidence: score, matched };
}

function buildInitialScreeningPrompt(c: Cand, requirement: string): string {
  const tags = (c.tags || []).join('、') || '无';
  const edu = c.education || '（未填写）';
  const sch = c.school || '（未填写）';
  return [
    '你是一名资深招聘官，请基于「岗位通用要求」与「候选人简历」进行 AI 初筛评估（首轮筛选）。',
    '',
    '【岗位通用要求】', requirement,
    '',
    '【候选人】', `姓名：${c.name}`, `应聘岗位：${c.position || '未指定'}`, `学历：${edu}`, `院校：${sch}`, `技能标签：${tags}`, `简历来源：${c.source || '未指定'}`,
    '',
    '【强制硬闸口（不可妥协，必须最先核验）】',
    `1. 学历门槛：本科及以上，候选人学历「${edu}」未达本科 → 直接淘汰；`,
    `2. 院校门槛：985 / 211 / 双一流 / 海外名校，候选人院校「${sch}」不在此列 → 直接淘汰；`,
    '3. 任一硬闸口不满足，无论技能多匹配都判淘汰，并在结论中明确写出未达标的闸口；',
    '4. 硬闸口达标后，再结合技能匹配度给出 0-100 置信度。',
    '',
    '【输出要求】',
    '1. 置信度 ≥ 60：直接过（建议进入用人部门二筛）；',
    '2. 置信度 35-59：人工复核（建议 HR 确认）；',
    '3. 置信度 < 35：淘汰；',
    '4. 列出命中的基础技能与未达标的硬闸口（如有）。',
  ].join('\n');
}

function buildScreeningPrompt(c: Cand, requirement: string): string {
  const tags = (c.tags || []).join('、') || '无';
  return [
    '你是一名资深技术招聘官，请基于「用人部门需求」与「候选人简历」进行专业二筛评估。',
    '',
    '【用人部门需求】', requirement,
    '',
    '【候选人】', `姓名：${c.name}`, `应聘岗位：${c.position || '未指定'}`, `技能标签：${tags}`, `简历来源：${c.source || '未指定'}`,
    '',
    '【输出要求】',
    '1. 评估候选人与需求的匹配度，给出 0-100 的置信度评分；',
    '2. 置信度 ≥ 80：直接过（建议进入群面）；',
    '3. 置信度 40-79：人工审核（建议 HR 复核）；',
    '4. 置信度 < 40：淘汰；',
    '5. 列出命中的关键技能与风险点。',
  ].join('\n');
}

// ============= 演示引擎 =============
type Listener = (payload: any) => void;

let _id = 0;
function uid(): string {
  _id += 1;
  return 'd' + Date.now().toString(36) + '_' + _id;
}

export class DemoEngine {
  private candidates: Cand[] = [];
  private interviewers: Interviewer[] = [];
  private interviews: InterviewItem[] = [];
  private screenings: ScreenRec[] = [];
  private logs: AgentLog[] = [];
  private tencentDoc: { id: number; title: string; content: string; updated_at: string } | null = null;
  private listeners = new Set<Listener>();
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private TICK_MS = 2200;

  constructor() {
    this.seedInterviewers();
    this.seed();
    this.aggregateTencentDoc();
    this.start();
  }

  // ---- 订阅（模拟 SSE） ----
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private broadcast(payload: any): void {
    for (const l of this.listeners) {
      try { l(payload); } catch { /* ignore */ }
    }
  }

  private addLog(type: string, message: string, candidate_id: string | null = null): AgentLog {
    const log: AgentLog = { id: uid(), type, message, candidate_id, created_at: nowISO() };
    this.logs.unshift(log);
    if (this.logs.length > 80) this.logs.length = 80;
    return log;
  }

  private advance(cand: Cand, target: StageKey, note: string): void {
    cand.stage_history.push({ stage: target, timestamp: nowISO(), note });
    cand.stage = target;
    cand.updated_at = nowISO();
    const log = this.addLog('advance', `➡️ ${cand.name} 推进至「${STAGE_LABELS[target]}」`, cand.id);
    this.broadcast({ type: 'agent_log', log });
    this.broadcast({ type: 'candidate_update', candidate: cand });
    this.broadcast({ type: 'stats', stats: this.getStats() });
  }

  // ---- 腾讯文档 ----
  private aggregateTencentDoc(): void {
    const rows = this.candidates.map((c, i) => ({
      idx: i + 1,
      name: c.name,
      position: c.position || '—',
      source: c.source || '—',
      tags: (c.tags || []).join('、') || '—',
      stage: STAGE_LABELS[c.stage] || c.stage,
      time: this.fmtTime(c.created_at),
    }));
    const lines: string[] = [];
    lines.push('# 招聘简历库（腾讯文档 · 自动同步）');
    lines.push('');
    lines.push(`> 最近同步：${this.fmtTime(nowISO())} · 共 ${rows.length} 份简历 · 由「智聘通 Agent」自动聚合`);
    lines.push('');
    lines.push('| 序号 | 姓名 | 应聘岗位 | 来源 | 关键标签 | 当前阶段 | 收集时间 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) lines.push(`| ${r.idx} | ${r.name} | ${r.position} | ${r.source} | ${r.tags} | ${r.stage} | ${r.time} |`);
    lines.push('');
    lines.push('_本文档由 Agent 实时聚合 HR 收集的简历，统一格式后同步至腾讯文档，供用人部门与 HR 协同查看。_');
    this.tencentDoc = { id: 1, title: '招聘简历库（腾讯文档·自动同步）', content: lines.join('\n'), updated_at: nowISO() };
    this.broadcast({ type: 'tencent_doc', doc: this.tencentDoc });
  }

  private fmtTime(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---- AI 初筛 ----
  runAIInitialScreening(candidateId: string, requirement?: string): { ok: boolean; message: string; error?: string; record?: ScreenRec; candidate?: Cand } {
    const c = this.candidates.find((x) => x.id === candidateId);
    if (!c) return { ok: false, message: '候选人不存在', error: '候选人不存在' };
    if (c.stage !== 'initial_screening') return { ok: false, message: `${c.name} 当前不在「AI初筛」阶段，无法初筛`, error: `${c.name} 当前不在「AI初筛」阶段` };
    if (c.parked) c.parked = 0;
    const profile = PROFILES.find((p) => p.name === c.name);
    const req = requirement || defaultRequirement(c.position, profile?.dept || '');

    // ① 先过初筛硬闸口（学历 / 院校），未达标直接淘汰或转人工复核
    const gate = evaluateHardGates(c);
    if (!gate.passed) {
      let decision: 'pass' | 'review' | 'reject';
      let confidence: number;
      let note: string;
      if (gate.failed === 'missing') {
        decision = 'review';
        confidence = 40;
        note = `初筛硬闸口未通过：${gate.detail}，转人工复核（请 HR 在简历中补充学历 / 院校）`;
      } else {
        decision = 'reject';
        confidence = 15;
        note = `初筛硬闸口未通过：${gate.detail}，直接淘汰`;
      }
      const rec: ScreenRec = { id: uid(), candidate_id: c.id, candidate_name: c.name, position: c.position, dept_requirement: req, prompt: buildInitialScreeningPrompt(c, req), confidence, decision, matched_skills: [], note, phase: 'initial', created_at: nowISO() };
      this.screenings.unshift(rec);
      this.broadcast({ type: 'screening', record: rec });
      if (decision === 'reject') {
        c.remark = `AI初筛淘汰（硬闸口）：${gate.detail}`;
        c.updated_at = nowISO();
        const log = this.addLog('screen', `🤖 AI 初筛：${c.name} 硬闸口未通过 → 淘汰（${gate.detail}）`, c.id);
        this.broadcast({ type: 'agent_log', log });
        this.broadcast({ type: 'candidate_update', candidate: c });
      } else {
        const log = this.addLog('screen', `🤖 AI 初筛：${c.name} 硬闸口信息缺失 → 人工复核`, c.id);
        this.broadcast({ type: 'agent_log', log });
      }
      this.broadcast({ type: 'anomalies', anomalies: this.computeAnomalies() });
      return { ok: true, message: note, record: rec, candidate: c };
    }

    // ② 硬闸口达标 → 进入技能匹配评分
    const { confidence, matched } = computeInitialScreeningConfidence(c, req);
    let decision: 'pass' | 'review' | 'reject';
    let note: string;
    const gateOk = '初筛硬闸口：学历 / 院校达标 ✓。';
    if (confidence >= 60) { decision = 'pass'; note = gateOk + ' 初筛置信度 ≥60，AI 判定直接过，已自动推进至拉群协作'; }
    else if (confidence >= 35) { decision = 'review'; note = gateOk + ' 初筛置信度 35-59，建议人工复核，已挂起待 HR 确认'; }
    else { decision = 'reject'; note = gateOk + ' 初筛置信度 <35，AI 判定淘汰'; }
    const rec: ScreenRec = { id: uid(), candidate_id: c.id, candidate_name: c.name, position: c.position, dept_requirement: req, prompt: buildInitialScreeningPrompt(c, req), confidence, decision, matched_skills: matched, note, phase: 'initial', created_at: nowISO() };
    this.screenings.unshift(rec);
    this.broadcast({ type: 'screening', record: rec });
    if (decision === 'pass') {
      this.advance(c, 'group_creation', 'AI 初筛直接过');
      const log = this.addLog('screen', `🤖 AI 初筛：${c.name} 置信度 ${confidence}% → 直接过`, c.id);
      this.broadcast({ type: 'agent_log', log });
    } else if (decision === 'reject') {
      c.remark = `AI初筛淘汰（置信度 ${confidence}%）`;
      c.updated_at = nowISO();
      const log = this.addLog('screen', `🤖 AI 初筛：${c.name} 置信度 ${confidence}% → 淘汰`, c.id);
      this.broadcast({ type: 'agent_log', log });
      this.broadcast({ type: 'candidate_update', candidate: c });
    } else {
      const log = this.addLog('screen', `🤖 AI 初筛：${c.name} 置信度 ${confidence}% → 人工复核`, c.id);
      this.broadcast({ type: 'agent_log', log });
    }
    this.broadcast({ type: 'anomalies', anomalies: this.computeAnomalies() });
    return { ok: true, message: note, record: rec, candidate: c };
  }

  // ---- AI 二筛 ----
  runAIScreening(candidateId: string, deptRequirement?: string): { ok: boolean; message: string; error?: string; record?: ScreenRec; candidate?: Cand } {
    const c = this.candidates.find((x) => x.id === candidateId);
    if (!c) return { ok: false, message: '候选人不存在', error: '候选人不存在' };
    if (c.stage !== 'secondary_screening') return { ok: false, message: `${c.name} 当前不在「部门二筛」阶段，无法二筛`, error: `${c.name} 当前不在「部门二筛」阶段` };
    if (c.parked) c.parked = 0;
    const profile = PROFILES.find((p) => p.name === c.name);
    const req = deptRequirement || defaultRequirement(c.position, profile?.dept || '');
    const { confidence, matched } = computeScreeningConfidence(c, req);
    let decision: 'pass' | 'review' | 'reject';
    let note: string;
    if (confidence >= 80) { decision = 'pass'; note = '置信度 ≥80，AI 判定直接过，已自动推进至群面名单'; }
    else if (confidence >= 40) { decision = 'review'; note = '置信度 40-79，建议人工审核，已挂起待 HR 复核'; }
    else { decision = 'reject'; note = '置信度 <40，AI 判定淘汰'; }
    const rec: ScreenRec = { id: uid(), candidate_id: c.id, candidate_name: c.name, position: c.position, dept_requirement: req, prompt: buildScreeningPrompt(c, req), confidence, decision, matched_skills: matched, note, phase: 'secondary', created_at: nowISO() };
    this.screenings.unshift(rec);
    this.broadcast({ type: 'screening', record: rec });
    if (decision === 'pass') {
      this.advance(c, 'interview_list', 'AI 二筛直接过');
      const log = this.addLog('screen', `🤖 AI 二筛：${c.name} 置信度 ${confidence}% → 直接过`, c.id);
      this.broadcast({ type: 'agent_log', log });
    } else if (decision === 'reject') {
      c.remark = `AI二筛淘汰（置信度 ${confidence}%）`;
      c.updated_at = nowISO();
      const log = this.addLog('screen', `🤖 AI 二筛：${c.name} 置信度 ${confidence}% → 淘汰`, c.id);
      this.broadcast({ type: 'agent_log', log });
      this.broadcast({ type: 'candidate_update', candidate: c });
    } else {
      const log = this.addLog('screen', `🤖 AI 二筛：${c.name} 置信度 ${confidence}% → 人工审核`, c.id);
      this.broadcast({ type: 'agent_log', log });
    }
    this.broadcast({ type: 'anomalies', anomalies: this.computeAnomalies() });
    return { ok: true, message: note, record: rec, candidate: c };
  }

  generateInitialPrompt(candidateId: string, requirement?: string): { prompt: string; requirement: string } {
    const c = this.candidates.find((x) => x.id === candidateId);
    const req = requirement || defaultRequirement(c?.position || null, PROFILES.find((p) => p.name === c?.name)?.dept || '');
    return { prompt: c ? buildInitialScreeningPrompt(c, req) : '', requirement: req };
  }
  generatePrompt(candidateId: string, deptRequirement?: string): { prompt: string; requirement: string } {
    const c = this.candidates.find((x) => x.id === candidateId);
    const req = deptRequirement || defaultRequirement(c?.position || null, PROFILES.find((p) => p.name === c?.name)?.dept || '');
    return { prompt: c ? buildScreeningPrompt(c, req) : '', requirement: req };
  }

  // ---- 约面排期 ----
  runScheduling(candidateId: string, type: 'group' | 'retest', interviewerId?: string): { ok: boolean; message: string; schedule?: any } {
    const c = this.candidates.find((x) => x.id === candidateId);
    if (!c) return { ok: false, message: '候选人不存在' };
    const targetStage: StageKey = type === 'group' ? 'interview_list' : 'retest_list';
    if (c.stage !== targetStage) return { ok: false, message: `${c.name} 当前不在「${STAGE_LABELS[targetStage]}」阶段，无法排期` };
    const candSlots = c.availability || [];
    if (candSlots.length === 0) return { ok: false, message: `${c.name} 尚未填写可面试时间` };
    if (this.interviewers.length === 0) return { ok: false, message: '暂无面试官可约时间数据' };
    let chosen = interviewerId ? this.interviewers.find((i) => i.id === interviewerId) : undefined;
    if (!chosen) {
      const sameDept = this.interviewers.find((i) => i.dept === (PROFILES.find((p) => p.name === c.name)?.dept));
      const pool = sameDept ? [sameDept, ...this.interviewers.filter((i) => i.id !== sameDept.id)] : this.interviewers;
      chosen = pool.find((i) => i.available_slots.filter((s) => candSlots.includes(s)).length > 0) || pool[0];
    }
    const overlap = chosen!.available_slots.filter((s) => candSlots.includes(s)).sort();
    if (overlap.length === 0) return { ok: false, message: `「${c.name}」与面试官「${chosen!.name}」时间无交集，请调整可约时间后重试`, schedule: { candidate: c.name, interviewer: chosen!.name, overlap: [] } };
    const slot = overlap[0];
    const result = Math.random() > 0.3 ? 'passed' : 'failed';
    const interview: InterviewItem = {
      id: uid(), candidate_id: c.id, candidate_name: c.name, type: type === 'group' ? 'group_interview' : 'retest',
      position: c.position, scheduled_time: slot, duration_minutes: 60, interviewers: [chosen!.name],
      location: type === 'group' ? '腾讯会议·群面' : '腾讯会议·复试', status: 'scheduled', result,
      feedback: result === 'passed' ? '面试通过' : '面试未通过', created_at: nowISO(), updated_at: nowISO(),
    };
    this.interviews.unshift(interview);
    const resultStage: StageKey = type === 'group' ? 'interview_result' : 'retest_result';
    c.stage = resultStage;
    if (type === 'group') c.interview_time = slot; else c.retest_time = slot;
    c.interviewers = [chosen!.name];
    c.interview_result = type === 'group' ? result : c.interview_result;
    c.retest_result = type === 'retest' ? result : c.retest_result;
    c.parked = 0;
    c.updated_at = nowISO();
    const log = this.addLog('schedule', `📅 ${c.name} ${type === 'group' ? '群面' : '复试'}已排期：${slot} · 面试官 ${chosen!.name} · ${result === 'passed' ? '通过' : '未通过'}`, c.id);
    this.broadcast({ type: 'agent_log', log });
    this.broadcast({ type: 'candidate_update', candidate: c });
    this.broadcast({ type: 'schedule', interviews: this.interviews });
    this.broadcast({ type: 'anomalies', anomalies: this.computeAnomalies() });
    return { ok: true, message: `已为 ${c.name} 匹配 ${slot}（面试官 ${chosen!.name}）`, schedule: { candidate: c.name, interviewer: chosen!.name, slot, result, duration: 60 } };
  }

  // ---- HR 上传 ----
  hrUploadResume(input: { name: string; position?: string; source?: string; phone?: string; email?: string; tags?: string[]; availability?: string[]; education?: string; school?: string }): { ok: boolean; message: string; candidate?: Cand } {
    if (!input.name || !input.name.trim()) return { ok: false, message: '候选人姓名不能为空' };
    const profile = PROFILES.find((p) => p.name === input.name.trim());
    const availability = input.availability && input.availability.length > 0 ? input.availability : slotsFor(hashName(input.name), 3);
    const ts = nowISO();
    const c: Cand = {
      id: uid(), name: input.name.trim(), phone: input.phone || profile?.phone || null, email: input.email || profile?.email || null,
      position: input.position || profile?.position || null, source: input.source || profile?.source || 'HR收集',
      education: input.education && input.education.trim() ? input.education.trim() : (profile?.education || null),
      school: input.school && input.school.trim() ? input.school.trim() : (profile?.school || null),
      resume_path: null,
      stage: 'resume_collection', stage_history: [{ stage: 'resume_collection', timestamp: ts, note: 'HR 收集并上传简历' }],
      tags: input.tags && input.tags.length ? input.tags : profile ? profile.tags : [], interview_time: null, interviewers: [],
      interview_result: null, retest_time: null, retest_result: null, remark: null, availability, parked: 0, created_at: ts, updated_at: ts,
    };
    this.candidates.unshift(c);
    this.aggregateTencentDoc();
    const log1 = this.addLog('system', `📥 HR 上传简历：${c.name}（${c.position || '岗位待定'}）→ Agent 已聚合至腾讯文档《招聘简历库》`, c.id);
    this.broadcast({ type: 'agent_log', log1 });
    this.advance(c, 'initial_screening', 'Agent 继续推进流程');
    this.broadcast({ type: 'stats', stats: this.getStats() });
    this.broadcast({ type: 'anomalies', anomalies: this.computeAnomalies() });
    return { ok: true, message: `已收集 ${c.name} 的简历，Agent 已汇总至腾讯文档并继续推进`, candidate: c };
  }

  // HR 手动修改 / 修复简历库中的某条记录
  updateCandidate(id: string, patch: { name?: string; position?: string; source?: string; phone?: string; email?: string; education?: string; school?: string; tags?: string[] }): { ok: boolean; message: string; candidate?: Cand } {
    const c = this.candidates.find((x) => x.id === id);
    if (!c) return { ok: false, message: '候选人不存在' };
    if (patch.name !== undefined) c.name = patch.name.trim() || c.name;
    if (patch.position !== undefined) c.position = patch.position.trim() ? patch.position.trim() : null;
    if (patch.source !== undefined) c.source = patch.source.trim() ? patch.source.trim() : null;
    if (patch.phone !== undefined) c.phone = patch.phone.trim() ? patch.phone.trim() : null;
    if (patch.email !== undefined) c.email = patch.email.trim() ? patch.email.trim() : null;
    if (patch.education !== undefined) c.education = patch.education.trim() ? patch.education.trim() : null;
    if (patch.school !== undefined) c.school = patch.school.trim() ? patch.school.trim() : null;
    if (patch.tags !== undefined) c.tags = Array.isArray(patch.tags) ? patch.tags.map((t) => String(t).trim()).filter(Boolean) : c.tags;
    c.updated_at = nowISO();
    this.aggregateTencentDoc();
    this.broadcast({ type: 'candidate_update', candidate: c });
    this.broadcast({ type: 'anomalies', anomalies: this.computeAnomalies() });
    this.broadcast({ type: 'stats', stats: this.getStats() });
    return { ok: true, message: `已更新 ${c.name} 的简历信息`, candidate: c };
  }

  // HR 手动删除简历库中的某条记录
  deleteCandidate(id: string): { ok: boolean; message: string } {
    const idx = this.candidates.findIndex((x) => x.id === id);
    if (idx < 0) return { ok: false, message: '候选人不存在' };
    const name = this.candidates[idx].name;
    this.candidates.splice(idx, 1);
    this.aggregateTencentDoc();
    this.broadcast({ type: 'candidate_remove', id });
    this.broadcast({ type: 'anomalies', anomalies: this.computeAnomalies() });
    this.broadcast({ type: 'stats', stats: this.getStats() });
    return { ok: true, message: `已删除 ${name}` };
  }

  // ---- 面试官 ----
  saveInterviewer(payload: { id?: string; name: string; dept?: string | null; role?: string | null; available_slots: string[] }): { interviewer: Interviewer } {
    let iv = payload.id ? this.interviewers.find((i) => i.id === payload.id) : undefined;
    if (iv) {
      iv.name = payload.name; iv.dept = payload.dept || null; iv.role = payload.role || null; iv.available_slots = payload.available_slots;
    } else {
      iv = { id: uid(), name: payload.name, dept: payload.dept || null, role: payload.role || null, available_slots: payload.available_slots };
      this.interviewers.push(iv);
    }
    this.broadcast({ type: 'interviewers', interviewers: this.interviewers });
    return { interviewer: iv };
  }

  // ---- 异常 ----
  private STUCK = 5 * 60 * 1000;
  private RECOGNIZE = 3 * 60 * 1000;
  private screeningDecision(cid: string): 'pass' | 'review' | 'reject' | null {
    const rec = this.screenings.find((s) => s.candidate_id === cid);
    return rec ? rec.decision : null;
  }
  computeAnomalies(): Anomaly[] {
    const now = Date.now();
    const list: Anomaly[] = [];
    for (const c of this.candidates) {
      const age = now - new Date(c.updated_at).getTime();
      const stageLabel = STAGE_LABELS[c.stage] || c.stage;
      const decision = this.screeningDecision(c.id);
      if (!c.phone || !c.email || !c.position) {
        const missing: string[] = [];
        if (!c.phone) missing.push('电话');
        if (!c.email) missing.push('邮箱');
        if (!c.position) missing.push('岗位');
        list.push({ id: `miss-${c.id}`, type: 'data_missing', typeLabel: '信息缺失', name: c.name, stage: c.stage, stageLabel, minutes: Math.round(age / 60000), hint: `缺少关键字段（${missing.join('、')}），建议 HR 补充后继续`, severity: 'mid' });
      }
      if (c.stage === 'resume_collection' && age > this.RECOGNIZE) {
        list.push({ id: `rec-${c.id}`, type: 'slow_recognition', typeLabel: '识别慢', name: c.name, stage: c.stage, stageLabel, minutes: Math.round(age / 60000), hint: `简历已收集约 ${Math.round(age / 60000)} 分钟，Agent 尚未完成识别与汇总推进`, severity: 'mid' });
      }
      const terminal = c.stage === 'retest_result';
      const waiting = decision === 'review' || decision === 'reject';
      if (!terminal && !waiting && c.stage !== 'resume_collection' && age > this.STUCK) {
        list.push({ id: `adv-${c.id}`, type: 'slow_advance', typeLabel: '推进慢', name: c.name, stage: c.stage, stageLabel, minutes: Math.round(age / 60000), hint: `已在「${stageLabel}」停留约 ${Math.round(age / 60000)} 分钟，建议 HR 介入推进`, severity: 'high' });
      }
    }
    const order: Record<Anomaly['severity'], number> = { high: 0, mid: 1, low: 2 };
    return list.sort((a, b) => order[a.severity] - order[b.severity] || b.minutes - a.minutes).slice(0, 50);
  }

  // ---- 引擎主循环 ----
  private pickToAdvance(): Cand | null {
    const eligible = this.candidates.filter((c) => {
      if (c.parked) return false;
      if (c.stage === 'retest_result') return false;
      const d = this.screeningDecision(c.id);
      if (d === 'reject' || d === 'review') return false;
      return true;
    });
    if (eligible.length === 0) return null;
    const idx = (s: string) => STAGE_ORDER.indexOf(s as StageKey);
    return eligible.sort((a, b) => {
      const ia = idx(a.stage), ib = idx(b.stage);
      if (ia !== ib) return ia - ib;
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    })[0];
  }

  private tick(): void {
    const c = this.pickToAdvance();
    if (!c) return;
    const idx = (s: string) => STAGE_ORDER.indexOf(s as StageKey);
    switch (c.stage) {
      case 'resume_collection':
        this.aggregateTencentDoc();
        this.advance(c, 'initial_screening', 'Agent 继续推进流程');
        break;
      case 'initial_screening':
        break; // HR 闸口：AI 初筛
      case 'group_creation':
        this.advance(c, 'secondary_screening', 'Agent 自动推进');
        break;
      case 'secondary_screening':
        break; // HR 闸口：AI 二筛
      case 'interview_list':
        break; // HR 闸口：约面
      case 'interview_result':
        if (c.interview_result === 'failed') break;
        this.advance(c, 'result_notification', 'Agent 自动推进');
        break;
      case 'result_notification':
        this.advance(c, 'retest_list', 'Agent 自动推进');
        break;
      case 'retest_list':
        break; // HR 闸口：复试约面
      case 'retest_result':
        break;
      default: {
        const cur = idx(c.stage);
        const next = STAGE_ORDER[cur + 1];
        if (next) this.advance(c, next, 'Agent 自动推进');
      }
    }
    this.broadcast({ type: 'stats', stats: this.getStats() });
    this.broadcast({ type: 'anomalies', anomalies: this.computeAnomalies() });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), this.TICK_MS);
    this.broadcast({ type: 'status', running: true });
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.broadcast({ type: 'status', running: false });
  }
  reset(): void {
    this.stop();
    this.candidates = []; this.interviews = []; this.screenings = []; this.logs = []; this.tencentDoc = null;
    this.interviewers = [];
    this.seedInterviewers();
    this.seed();
    this.aggregateTencentDoc();
    this.start();
    this.broadcast({ type: 'reset' });
    this.broadcast({ type: 'snapshot', ...this.getSnapshot() });
  }

  // ---- 干预 ----
  intervene(command: string): { ok: boolean; message: string } {
    const all = this.candidates;
    let c = all.find((x) => command.includes(x.name));
    if (!c) {
      const m = command.match(/([一-龥]{2,3})/);
      if (m) c = all.find((x) => x.name === m![1]);
    }
    if (!c) return { ok: false, message: '未在指令中识别到候选人姓名，请类似输入「把 张伟 推进复试」' };
    if (command.includes('驳回') || command.includes('淘汰') || command.includes('放弃') || command.includes('不通过')) {
      const field = c.stage.startsWith('retest') ? 'retest_result' : 'interview_result';
      (c as any)[field] = 'failed';
      c.parked = 0;
      const log = this.addLog('intervention', `🛑 HR 干预：驳回 ${c.name}（标记为未通过）`, c.id);
      this.broadcast({ type: 'agent_log', log });
      this.broadcast({ type: 'candidate_update', candidate: c });
      this.broadcast({ type: 'anomalies', anomalies: this.computeAnomalies() });
      return { ok: true, message: `已驳回 ${c.name}` };
    }
    const map: Record<string, StageKey> = {
      初筛: 'initial_screening', 拉群: 'group_creation', 二筛: 'secondary_screening', 面试: 'interview_list', 群面名单: 'interview_list',
      群面安排: 'interview_schedule', 群面结果: 'interview_result', 结果通知: 'result_notification', 复试: 'retest_list', 复试名单: 'retest_list',
      复试安排: 'retest_schedule', 复试结果: 'retest_result',
    };
    let target: StageKey | undefined;
    for (const [kw, st] of Object.entries(map)) { if (command.includes(kw)) { target = st; break; } }
    if (!target) { const cur = idxOf(c.stage); target = STAGE_ORDER[cur + 1]; }
    if (!target) return { ok: false, message: `${c.name} 已处于最终阶段` };
    const cur = idxOf(c.stage), tgt = idxOf(target);
    if (tgt <= cur) return { ok: false, message: `${c.name} 当前已在「${STAGE_LABELS[c.stage]}」，无法回退` };
    c.parked = 0;
    this.advance(c, target, 'HR 干预推进');
    this.broadcast({ type: 'anomalies', anomalies: this.computeAnomalies() });
    return { ok: true, message: `已将 ${c.name} 推进至「${STAGE_LABELS[target]}」` };
  }

  // ---- 种子数据 ----
  private seedInterviewers(): void {
    const seeds = [
      { name: '李工', dept: '研发', role: '技术负责人', seed: 3 },
      { name: '陈经理', dept: '产品', role: '产品负责人', seed: 7 },
      { name: '孙设计', dept: '设计', role: '设计主管', seed: 11 },
      { name: '钱博', dept: '数据', role: '数据专家', seed: 5 },
      { name: '冯博', dept: '算法', role: '算法专家', seed: 9 },
    ];
    this.interviewers = seeds.map((s) => ({ id: uid(), name: s.name, dept: s.dept, role: s.role, available_slots: slotsFor(s.seed, 3) }));
  }

  private seed(): void {
    const now = new Date();
    const stale = new Date(now.getTime() - 18 * 60 * 1000).toISOString();
    const staleSeeds = [
      { name: '黄涛', position: '运维工程师', source: 'BOSS直聘', stage: 'resume_collection' as StageKey, note: '简历已收集，Agent 识别缓慢', updated_at: stale, education: '大专', school: '普通本科' },
      { name: '林芳', position: '财务专员', source: '内推', stage: 'secondary_screening' as StageKey, note: '部门二筛长时间未处理', updated_at: stale, education: '本科', school: '普通本科' },
      { name: '何军', position: '销售经理', source: '企业微信', stage: 'interview_list' as StageKey, note: '群面名单已就绪，迟迟未约面', updated_at: stale, education: '本科', school: '211' },
    ];
    const staleIds: Record<string, string> = {};
    for (const s of staleSeeds) {
      const id = uid();
      staleIds[s.name] = id;
      this.candidates.push({
        id, name: s.name, phone: null, email: null, position: s.position, source: s.source, education: s.education, school: s.school, resume_path: null,
        stage: s.stage, stage_history: [{ stage: s.stage, timestamp: s.updated_at, note: s.note }], tags: [],
        interview_time: null, interviewers: [], interview_result: null, retest_time: null, retest_result: null, remark: s.note,
        availability: slotsFor(hashName(s.name), 3), parked: 1, created_at: s.updated_at, updated_at: s.updated_at,
      });
    }
    const mkRec = (cid: string, name: string, position: string, req: string, prompt: string, confidence: number, decision: 'pass' | 'review' | 'reject', matched: string[], note: string, phase: 'initial' | 'secondary') => {
      this.screenings.unshift({ id: uid(), candidate_id: cid, candidate_name: name, position, dept_requirement: req, prompt, confidence, decision, matched_skills: matched, note, phase, created_at: stale });
    };
    mkRec(staleIds['黄涛'], '黄涛', '运维工程师', '具备运维/监控/自动化部署经验，熟悉 Linux 与 CI/CD，有大促保障经验优先', '', 58, 'review', ['Linux'], '置信度 58%，命中 Linux，建议人工审核', 'secondary');
    mkRec(staleIds['林芳'], '林芳', '财务专员', '熟悉财务报表/税务/核算，有 ERP 与合并报表经验优先', '', 33, 'reject', [], '置信度 33%，无关键技能命中，AI 判定淘汰', 'secondary');

    const flow = [
      { name: '周敏', position: '运营专员', source: 'BOSS直聘', stage: 'initial_screening' as StageKey, tags: ['社群', '内容'], email: 'zm@demo.com' },
      { name: '赵磊', position: '后端工程师', source: '内推', stage: 'initial_screening' as StageKey, tags: ['Go', '微服务'], email: 'zl@demo.com' },
      { name: '杨光', position: '数据分析师', source: 'BOSS直聘', stage: 'secondary_screening' as StageKey, tags: ['SQL', 'Python'], email: 'yg@demo.com' },
      { name: '陈静', position: '测试工程师', source: '内推', stage: 'secondary_screening' as StageKey, tags: ['自动化', '性能'], email: 'cj@demo.com' },
      { name: '李娜', position: '产品经理', source: '内推', stage: 'secondary_screening' as StageKey, tags: ['B端', '数据驱动'], email: 'ln@demo.com' },
      { name: '张伟', position: '前端工程师', source: '官网', stage: 'interview_list' as StageKey, tags: ['React', 'TypeScript'], email: 'zw@demo.com' },
      { name: '王强', position: 'Java工程师', source: '猎头', stage: 'interview_list' as StageKey, tags: ['SpringCloud', '高并发'], email: 'wq@demo.com' },
      { name: '刘洋', position: 'UI设计师', source: 'BOSS直聘', stage: 'interview_list' as StageKey, tags: ['Figma', '交互'], email: 'ly@demo.com' },
      { name: '孙浩', position: '前端工程师', source: 'BOSS直聘', stage: 'interview_result' as StageKey, tags: ['Vue', '可视化'], email: 'sh@demo.com', interview_result: 'passed' },
      { name: '郑爽', position: 'HRBP', source: '内推', stage: 'retest_list' as StageKey, tags: ['组织发展', '招聘'], email: 'zs@demo.com' },
    ];
    const flowIds: Record<string, string> = {};
    for (const p of flow) {
      const id = uid(); flowIds[p.name] = id;
      const ts = nowISO();
      const prof = PROFILES.find((x) => x.name === p.name);
      this.candidates.push({
        id, name: p.name, phone: '138' + String(Math.floor(10000000 + Math.random() * 89999999)), email: p.email, position: p.position, source: p.source,
        education: prof?.education || null, school: prof?.school || null, resume_path: null, stage: p.stage, stage_history: [{ stage: p.stage, timestamp: ts, note: 'HR 收集并上传简历' }], tags: p.tags,
        interview_time: null, interviewers: [], interview_result: (p as any).interview_result || null, retest_time: null, retest_result: null, remark: null,
        availability: slotsFor(hashName(p.name), 3), parked: 0, created_at: ts, updated_at: ts,
      });
    }
    mkRec(flowIds['周敏'], '周敏', '运营专员', '具备社群运营与内容策划能力，有增长活动经验优先', '', 75, 'pass', ['社群', '内容'], '初筛置信度 75%，基础技能匹配，AI 判定直接过', 'initial');
    mkRec(flowIds['赵磊'], '赵磊', '后端工程师', '精通 Go / Java 服务端开发，熟悉微服务与高并发架构，有分布式经验优先', '', 50, 'review', ['Go'], '初筛置信度 50%，建议人工复核', 'initial');
    mkRec(flowIds['张伟'], '张伟', '前端工程师', '具备 React / TypeScript 3 年以上经验，熟悉可视化与性能优化，有大型项目经验优先', '', 88, 'pass', ['React', 'TypeScript'], '置信度 88%，技能高度匹配，AI 判定直接过', 'secondary');

    this.addLog('system', '🟢 提效 Agent 已上线：HR 收集简历 → Agent 聚合腾讯文档 → AI 初筛 → AI 二筛 → 约面排期 → 复试');
  }

  // ---- 统计 + 快照 ----
  private getStats() {
    const stages = STAGE_ORDER.map((key) => ({ key, label: STAGE_LABELS[key], count: this.candidates.filter((c) => c.stage === key).length }));
    const totalInterviews = this.interviews.length;
    const passed = this.interviews.filter((i) => i.result === 'passed').length;
    const failed = this.interviews.filter((i) => i.result === 'failed').length;
    const pending = this.interviews.filter((i) => !i.result || i.result === 'pending').length;
    const positionStats: Record<string, number> = {};
    const sourceStats: Record<string, number> = {};
    for (const c of this.candidates) {
      const p = c.position || '未指定'; positionStats[p] = (positionStats[p] || 0) + 1;
      const s = c.source || '未指定'; sourceStats[s] = (sourceStats[s] || 0) + 1;
    }
    return {
      stages, totalCandidates: this.candidates.length, totalInterviews, passedInterviews: passed, failedInterviews: failed, pendingInterviews: pending,
      positionStats: Object.entries(positionStats).map(([position, count]) => ({ position, count })),
      sourceStats: Object.entries(sourceStats).map(([source, count]) => ({ source, count })),
    };
  }

  getSnapshot() {
    return {
      events: [],
      logs: this.logs.slice().reverse(),
      stats: this.getStats(),
      anomalies: this.computeAnomalies(),
      status: { running: this.running },
      tencentDoc: this.tencentDoc,
      interviewers: this.interviewers,
      screenings: this.screenings.slice(0, 50),
      schedule: this.interviews,
      candidates: this.candidates,
    };
  }

  getStatus() { return { running: this.running }; }
}

function idxOf(s: string): number {
  return STAGE_ORDER.indexOf(s as StageKey);
}

// 懒加载单例：仅在演示模式（VITE_DEMO=true）下实例化，避免本地后端开发时后台空跑引擎
let _engine: DemoEngine | null = null;
export function getDemoEngine(): DemoEngine {
  if (!_engine) _engine = new DemoEngine();
  return _engine;
}
