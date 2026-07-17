/**
 * 提效 Agent 自动化引擎（v2：HR 收集 + Agent 聚合 + AI 二筛 + 约面排期）
 * ------------------------------------------------------------
 * 理念：HR 负责「简历收集与上传」，Agent 负责后续一切：
 *   1) 将收集的简历聚合成统一文档格式，自动同步到「腾讯文档」
 *   2) 继续推进流程：HR初筛 → 拉群 → 部门二筛 → 群面 → 复试
 *   3) 部门二筛由「AI 辅助二筛」引擎处理（置信度分级：>80 直接过 / 40-80 人工审核 / <40 淘汰）
 *   4) 群面 / 复试由「约面排期」引擎处理（面试官与求职者时间匹配，合理分配）
 * 完整工作流：简历收集 → AI初筛 → 拉群协作 → 部门二筛(AI二筛) → 群面(约面) → 群面结果 → 结果通知 → 复试(约面) → 复试结果
 * HR 只在看板监控、处置「异常」（推进慢 / 识别慢 / 信息缺失）与人工审核兜底。
 *
 * 解析层当前使用「规则引擎」（零成本、可离线演示）。生产环境可把
 * parseEvent / 二筛置信度 替换为 CodeBuddy SDK 的 LLM 解析——
 * 见 runAIScreening 中预留的 LLM 接入点。
 */

import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';

// ============= 类型定义 =============

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

interface RawEvent {
  id: string;
  source: string;
  channel: string | null;
  content: string;
  parsed: number;
  created_at: string;
}

interface AgentLog {
  id: string;
  type: string;
  message: string;
  candidate_id: string | null;
  created_at: string;
}

type AnomalyType = 'slow_advance' | 'slow_recognition' | 'data_missing';

interface Anomaly {
  id: string;
  type: AnomalyType;
  typeLabel: string;
  name: string;
  stage: string;
  stageLabel: string;
  minutes: number;
  hint: string;
  severity: 'high' | 'mid' | 'low';
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
  created_at: string;
}

// ============= SSE 广播 =============

type Listener = (payload: unknown) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function broadcast(payload: unknown): void {
  for (const l of listeners) {
    try {
      l(payload);
    } catch {
      /* 忽略单个订阅者错误 */
    }
  }
}

// ============= 阶段顺序与标签 =============

const STAGE_ORDER = db.getStageOrder();
const STAGE_LABELS = db.getStageLabels();

function stageIndex(stage: string): number {
  return STAGE_ORDER.indexOf(stage);
}

function fmtTimeShort(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

// ============= 时间槽工具（约面排期） =============

// 统一可约时间池（未来 3 天的工作时段），保证面试官与求职者总有交集
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

// 每个面试官 / 求职者都包含公共槽，确保一定能匹配到时间
function slotsFor(seed: number, extra: number): string[] {
  const common = [SLOT_POOL[0], SLOT_POOL[1]]; // 公共可约槽
  const picks: string[] = [];
  let s = seed;
  for (let i = 0; i < extra; i++) {
    s = (s * 1103515245 + 12345) % SLOT_POOL.length;
    picks.push(SLOT_POOL[s]);
  }
  return Array.from(new Set([...common, ...picks])).sort();
}

// ============= 候选人画像（含部门 / 面试官 / 可约时间） =============

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
}

const PROFILES: Profile[] = [
  { name: '张伟', position: '前端工程师', dept: '研发', source: 'BOSS直聘', exp: '3年', tags: ['React', 'TypeScript'], interviewer: '李工', interviewer2: '王总监', phone: '13800001111', email: 'zhangwei@demo.com' },
  { name: '李娜', position: '产品经理', dept: '产品', source: '企业微信', exp: '5年', tags: ['B端', '数据驱动'], interviewer: '陈经理', interviewer2: '赵总', phone: '13800002222', email: 'lina@demo.com' },
  { name: '王强', position: 'Java工程师', dept: '研发', source: 'BOSS直聘', exp: '4年', tags: ['SpringCloud', '高并发'], interviewer: '李工', interviewer2: '王总监', phone: '13800003333', email: 'wangqiang@demo.com' },
  { name: '刘洋', position: 'UI设计师', dept: '设计', source: '内推', exp: '2年', tags: ['Figma', '交互'], interviewer: '孙设计', interviewer2: '周导', phone: '13800004444', email: 'liuyang@demo.com' },
  { name: '陈静', position: '测试工程师', dept: '研发', source: 'BOSS直聘', exp: '3年', tags: ['自动化', '性能'], interviewer: '李工', interviewer2: '王总监', phone: '13800005555', email: 'chenjing@demo.com' },
  { name: '杨光', position: '数据分析师', dept: '数据', source: '企业微信', exp: '4年', tags: ['SQL', 'Python'], interviewer: '钱博', interviewer2: '孙总', phone: '13800006666', email: 'yangguang@demo.com' },
  { name: '赵磊', position: '后端工程师', dept: '研发', source: '内推', exp: '6年', tags: ['Go', '微服务'], interviewer: '李工', interviewer2: '王总监', phone: '13800007777', email: 'zhaolei@demo.com' },
  { name: '周敏', position: '运营专员', dept: '运营', source: 'BOSS直聘', exp: '2年', tags: ['社群', '内容'], interviewer: '吴运营', interviewer2: '郑总', phone: '13800008888', email: 'zhoumin@demo.com' },
  { name: '吴桐', position: '算法工程师', dept: '算法', source: '企业微信', exp: '5年', tags: ['NLP', '深度学习'], interviewer: '冯博', interviewer2: '蒋总', phone: '13800009999', email: 'wutong@demo.com' },
  { name: '郑爽', position: 'HRBP', dept: 'HR', source: '内推', exp: '3年', tags: ['组织发展', '招聘'], interviewer: '沈HR', interviewer2: '韩总', phone: '13800010000', email: 'zhengshuang@demo.com' },
  { name: '孙浩', position: '前端工程师', dept: '研发', source: 'BOSS直聘', exp: '4年', tags: ['Vue', '可视化'], interviewer: '李工', interviewer2: '王总监', phone: '13800011111', email: 'sunhao@demo.com' },
  { name: '马琳', position: '产品经理', dept: '产品', source: '企业微信', exp: '6年', tags: ['C端', '增长'], interviewer: '陈经理', interviewer2: '赵总', phone: '13800012222', email: 'malin@demo.com' },
];

// 按岗位生成「用人部门需求」默认文案（AI 二筛提示词的数据源）
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

// 非招聘动作噪声（演示 Agent 的「忽略」能力）
const NOISE_MESSAGES: Array<{ source: string; channel: string | null; content: string }> = [
  { source: '企业微信群', channel: '研发招聘群', content: '【企业微信群·研发招聘群】李工：今天的周会改到下午三点哈' },
  { source: '企业微信', channel: null, content: '【企业微信】王总监：中午一起吃饭吗？' },
  { source: '企业微信群', channel: '产品招聘群', content: '【企业微信群·产品招聘群】陈经理：这个需求文档我发群里了，大家看下' },
];

// ============= 共享：阶段推进 =============

function appendStageHistory(candidate: db.DbCandidate, stage: string, note: string): string {
  const history = candidate.stage_history ? JSON.parse(candidate.stage_history) : [];
  history.push({ stage, timestamp: nowISO(), note });
  return JSON.stringify(history);
}

function advanceCandidate(candidateId: string, target: StageKey, note: string): db.DbCandidate | undefined {
  const candidate = db.getCandidate(candidateId);
  if (!candidate) return undefined;
  const history = candidate.stage_history ? JSON.parse(candidate.stage_history) : [];
  history.push({ stage: target, timestamp: nowISO(), note });
  db.updateCandidate(candidate.id, { stage: target, stage_history: JSON.stringify(history) });
  const updated = db.getCandidate(candidate.id);
  if (updated) {
    const log = db.addAgentLog({ type: 'advance', message: `➡️ ${updated.name} 推进至「${STAGE_LABELS[target]}」`, candidate_id: updated.id });
    broadcast({ type: 'agent_log', log });
    broadcast({ type: 'candidate_update', candidate: serializeCandidate(updated) });
  }
  return updated;
}

function serializeCandidate(c: db.DbCandidate) {
  return {
    ...c,
    stage_history: c.stage_history ? JSON.parse(c.stage_history) : [],
    tags: c.tags ? JSON.parse(c.tags) : [],
    interviewers: c.interviewers ? JSON.parse(c.interviewers) : [],
    availability: c.availability ? JSON.parse(c.availability) : [],
  };
}

// ============= 腾讯文档：简历汇总库（Agent 自动聚合） =============

export function aggregateTencentDoc(): void {
  const candidates = db.getAllCandidates();
  const rows = candidates.map((c, i) => {
    const history = c.stage_history ? JSON.parse(c.stage_history) : [];
    const collected = history.find((h: any) => h.stage === 'resume_collection');
    return {
      idx: i + 1,
      name: c.name,
      position: c.position || '—',
      source: c.source || '—',
      tags: c.tags ? JSON.parse(c.tags).join('、') : '—',
      stage: STAGE_LABELS[c.stage] || c.stage,
      time: fmtTimeShort(collected?.timestamp || c.created_at),
    };
  });

  const lines: string[] = [];
  lines.push('# 招聘简历库（腾讯文档 · 自动同步）');
  lines.push('');
  lines.push(`> 最近同步：${fmtTimeShort(nowISO())} · 共 ${rows.length} 份简历 · 由「智聘通 Agent」自动聚合`);
  lines.push('');
  lines.push('| 序号 | 姓名 | 应聘岗位 | 来源 | 关键标签 | 当前阶段 | 收集时间 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(`| ${r.idx} | ${r.name} | ${r.position} | ${r.source} | ${r.tags} | ${r.stage} | ${r.time} |`);
  }
  lines.push('');
  lines.push('_本文档由 Agent 实时聚合 HR 收集的简历，统一格式后同步至腾讯文档，供用人部门与 HR 协同查看。_');

  const doc = db.upsertTencentDoc('招聘简历库（腾讯文档·自动同步）', lines.join('\n'));
  broadcast({ type: 'tencent_doc', doc });
}

// ============= AI 辅助二筛 =============

function extractKeywords(text: string): string[] {
  return text
    .split(/[\s,，。、；;：:（）()\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 8);
}

function computeScreeningConfidence(
  candidate: db.DbCandidate,
  requirement: string,
): { confidence: number; matched: string[] } {
  // 归一化匹配：忽略空白后做子串包含判断，避免「B 端」被空格拆断导致漏匹配
  const reqNorm = requirement.toLowerCase().replace(/\s+/g, '');
  const tags: string[] = candidate.tags ? JSON.parse(candidate.tags) : [];
  const matched = tags.filter((t: string) => {
    const tl = t.toLowerCase().replace(/\s+/g, '');
    return tl.length >= 2 && reqNorm.includes(tl);
  });
  const hash = [...candidate.name].reduce((a, c) => a + c.charCodeAt(0), 0);

  // 三档分级（确定性，便于演示）：≥2 命中→多数直接过、1 命中→人工审核、0 命中→淘汰
  let score: number;
  if (matched.length >= 2) score = 82 + (hash % 7) - 3; // 79~85
  else if (matched.length === 1) score = 60 + (hash % 9) - 4; // 56~65
  else score = 30 + (hash % 7) - 3; // 27~33

  // 岗位名称出现在需求中再稳健加成
  const pos = (candidate.position || '').toLowerCase().replace(/\s+/g, '');
  if (pos && (reqNorm.includes(pos) || reqNorm.includes(pos.slice(0, 2)))) score += 6;

  score = Math.max(8, Math.min(98, score));
  return { confidence: score, matched };
}

export function buildScreeningPrompt(candidate: db.DbCandidate, requirement: string): string {
  const tags = candidate.tags ? JSON.parse(candidate.tags).join('、') : '无';
  return [
    '你是一名资深技术招聘官，请基于「用人部门需求」与「候选人简历」进行专业二筛评估。',
    '',
    '【用人部门需求】',
    requirement,
    '',
    '【候选人】',
    `姓名：${candidate.name}`,
    `应聘岗位：${candidate.position || '未指定'}`,
    `技能标签：${tags}`,
    `简历来源：${candidate.source || '未指定'}`,
    '',
    '【输出要求】',
    '1. 评估候选人与需求的匹配度，给出 0-100 的置信度评分；',
    '2. 置信度 ≥ 80：直接过（建议进入群面）；',
    '3. 置信度 40-79：人工审核（建议 HR 复核）；',
    '4. 置信度 < 40：淘汰；',
    '5. 列出命中的关键技能与风险点。',
  ].join('\n');
}

// ============= AI 初筛（首轮筛选：简历基础匹配度） =============

function computeInitialScreeningConfidence(
  candidate: db.DbCandidate,
  requirement: string,
): { confidence: number; matched: string[] } {
  const reqNorm = requirement.toLowerCase().replace(/\s+/g, '');
  const tags: string[] = candidate.tags ? JSON.parse(candidate.tags) : [];
  const matched = tags.filter((t: string) => {
    const tl = t.toLowerCase().replace(/\s+/g, '');
    return tl.length >= 2 && reqNorm.includes(tl);
  });
  const hash = [...candidate.name].reduce((a, c) => a + c.charCodeAt(0), 0);

  // 初筛更宽容（首轮过滤明显不匹配者）：≥2 命中→多数直接过、1 命中→人工复核、0 命中→淘汰
  let score: number;
  if (matched.length >= 2) score = 72 + (hash % 7) - 3; // 69~75
  else if (matched.length === 1) score = 50 + (hash % 9) - 4; // 46~55
  else score = 30 + (hash % 7) - 3; // 27~33

  const pos = (candidate.position || '').toLowerCase().replace(/\s+/g, '');
  if (pos && (reqNorm.includes(pos) || reqNorm.includes(pos.slice(0, 2)))) score += 8;

  score = Math.max(8, Math.min(96, score));
  return { confidence: score, matched };
}

export function buildInitialScreeningPrompt(candidate: db.DbCandidate, requirement: string): string {
  const tags = candidate.tags ? JSON.parse(candidate.tags).join('、') : '无';
  return [
    '你是一名资深招聘官，请基于「岗位通用要求」与「候选人简历」进行 AI 初筛评估（首轮筛选）。',
    '',
    '【岗位通用要求】',
    requirement,
    '',
    '【候选人】',
    `姓名：${candidate.name}`,
    `应聘岗位：${candidate.position || '未指定'}`,
    `技能标签：${tags}`,
    `简历来源：${candidate.source || '未指定'}`,
    '',
    '【输出要求】',
    '1. 评估基础匹配度，给出 0-100 的初筛置信度评分；',
    '2. 置信度 ≥ 60：直接过（建议进入用人部门二筛）；',
    '3. 置信度 35-59：人工复核（建议 HR 确认）；',
    '4. 置信度 < 35：淘汰；',
    '5. 列出命中的基础技能。',
  ].join('\n');
}

/**
 * 执行 AI 初筛：生成提示词 + 计算首轮置信度 + 分级决策。
 * 决策：>60 直接过（推进拉群协作）/ 35-59 人工复核（停留待 HR）/ <35 淘汰。
 */
export function runAIInitialScreening(
  candidateId: string,
  requirement?: string,
): { ok: boolean; message: string; record?: ScreenRec; candidate?: any } {
  const candidate = db.getCandidate(candidateId);
  if (!candidate) return { ok: false, message: '候选人不存在' };
  if (candidate.stage !== 'initial_screening') {
    return { ok: false, message: `${candidate.name} 当前不在「AI初筛」阶段（在「${STAGE_LABELS[candidate.stage]}」），无法初筛` };
  }

  // HR 介入初筛，解除挂起（若存在）
  if (candidate.parked) db.updateCandidate(candidate.id, { parked: 0 });

  const profile = PROFILES.find((p) => p.name === candidate.name);
  const req = requirement || defaultRequirement(candidate.position, profile?.dept || '');
  const prompt = buildInitialScreeningPrompt(candidate, req);
  const { confidence, matched } = computeInitialScreeningConfidence(candidate, req);

  let decision: 'pass' | 'review' | 'reject';
  let note: string;
  if (confidence >= 60) {
    decision = 'pass';
    note = '初筛置信度 ≥60，AI 判定直接过，已自动推进至拉群协作';
  } else if (confidence >= 35) {
    decision = 'review';
    note = '初筛置信度 35-59，建议人工复核，已挂起待 HR 确认';
  } else {
    decision = 'reject';
    note = '初筛置信度 <35，AI 判定淘汰';
  }

  const rec = db.addScreeningRecord({
    candidate_id: candidate.id,
    candidate_name: candidate.name,
    position: candidate.position,
    dept_requirement: req,
    prompt,
    confidence,
    decision,
    matched_skills: matched,
    note,
    phase: 'initial',
  });

  const screenRec: ScreenRec = { ...rec, matched_skills: matched } as ScreenRec;
  broadcast({ type: 'screening', record: screenRec });

  if (decision === 'pass') {
    advanceCandidate(candidate.id, 'group_creation', 'AI 初筛直接过');
    const log = db.addAgentLog({ type: 'screen', message: `🤖 AI 初筛：${candidate.name} 置信度 ${confidence}% → 直接过`, candidate_id: candidate.id });
    broadcast({ type: 'agent_log', log });
  } else if (decision === 'reject') {
    db.updateCandidate(candidate.id, { remark: `AI初筛淘汰（置信度 ${confidence}%）` });
    const log = db.addAgentLog({ type: 'screen', message: `🤖 AI 初筛：${candidate.name} 置信度 ${confidence}% → 淘汰`, candidate_id: candidate.id });
    broadcast({ type: 'agent_log', log });
    broadcast({ type: 'candidate_update', candidate: serializeCandidate(db.getCandidate(candidate.id)!) });
  } else {
    const log = db.addAgentLog({ type: 'screen', message: `🤖 AI 初筛：${candidate.name} 置信度 ${confidence}% → 人工复核`, candidate_id: candidate.id });
    broadcast({ type: 'agent_log', log });
  }

  recomputeAndBroadcastAnomalies();
  return { ok: true, message: note, record: screenRec, candidate: serializeCandidate(db.getCandidate(candidate.id)!) };
}

/**
 * 执行 AI 辅助二筛：生成提示词 + 计算置信度 + 分级决策。
 * 决策：>80 直接过（推进群面名单）/ 40-80 人工审核（停留待 HR）/ <40 淘汰。
 */
export function runAIScreening(
  candidateId: string,
  deptRequirement?: string,
): { ok: boolean; message: string; record?: ScreenRec; candidate?: any } {
  const candidate = db.getCandidate(candidateId);
  if (!candidate) return { ok: false, message: '候选人不存在' };
  if (candidate.stage !== 'secondary_screening') {
    return { ok: false, message: `${candidate.name} 当前不在「部门二筛」阶段（在「${STAGE_LABELS[candidate.stage]}」），无法二筛` };
  }

  // HR 介入二筛，解除挂起（若存在），交由 HR 判断处理
  if (candidate.parked) db.updateCandidate(candidate.id, { parked: 0 });

  const profile = PROFILES.find((p) => p.name === candidate.name);
  const requirement = deptRequirement || defaultRequirement(candidate.position, profile?.dept || '');
  const prompt = buildScreeningPrompt(candidate, requirement);
  const { confidence, matched } = computeScreeningConfidence(candidate, requirement);

  let decision: 'pass' | 'review' | 'reject';
  let note: string;
  if (confidence >= 80) {
    decision = 'pass';
    note = '置信度 ≥80，AI 判定直接过，已自动推进至群面名单';
  } else if (confidence >= 40) {
    decision = 'review';
    note = '置信度 40-79，建议人工审核，已挂起待 HR 复核';
  } else {
    decision = 'reject';
    note = '置信度 <40，AI 判定淘汰';
  }

  const rec = db.addScreeningRecord({
    candidate_id: candidate.id,
    candidate_name: candidate.name,
    position: candidate.position,
    dept_requirement: requirement,
    prompt,
    confidence,
    decision,
    matched_skills: matched,
    note,
    phase: 'secondary',
  });

  const screenRec: ScreenRec = { ...rec, matched_skills: matched } as ScreenRec;
  broadcast({ type: 'screening', record: screenRec });

  if (decision === 'pass') {
    advanceCandidate(candidate.id, 'interview_list', 'AI 二筛直接过');
    const log = db.addAgentLog({ type: 'screen', message: `🤖 AI 二筛：${candidate.name} 置信度 ${confidence}% → 直接过`, candidate_id: candidate.id });
    broadcast({ type: 'agent_log', log });
  } else if (decision === 'reject') {
    db.updateCandidate(candidate.id, { remark: `AI二筛淘汰（置信度 ${confidence}%）` });
    const log = db.addAgentLog({ type: 'screen', message: `🤖 AI 二筛：${candidate.name} 置信度 ${confidence}% → 淘汰`, candidate_id: candidate.id });
    broadcast({ type: 'agent_log', log });
    broadcast({ type: 'candidate_update', candidate: serializeCandidate(db.getCandidate(candidate.id)!) });
  } else {
    const log = db.addAgentLog({ type: 'screen', message: `🤖 AI 二筛：${candidate.name} 置信度 ${confidence}% → 人工审核`, candidate_id: candidate.id });
    broadcast({ type: 'agent_log', log });
  }

  recomputeAndBroadcastAnomalies();
  return { ok: true, message: note, record: screenRec, candidate: serializeCandidate(db.getCandidate(candidate.id)!) };
}

// ============= 约面排期（面试官 / 求职者时间匹配） =============

function sharedSlots(candidateSlots: string[], interviewerSlots: string[]): string[] {
  const set = new Set(interviewerSlots);
  return candidateSlots.filter((s) => set.has(s)).sort();
}

/**
 * 执行约面排期：在面试官可约时间与求职者可约时间中取交集，
 * 选择最早且面试官负载最低的时段，合理分配。
 */
export function runScheduling(
  candidateId: string,
  type: 'group' | 'retest',
  interviewerId?: string,
): { ok: boolean; message: string; schedule?: any } {
  const candidate = db.getCandidate(candidateId);
  if (!candidate) return { ok: false, message: '候选人不存在' };
  const targetStage: StageKey = type === 'group' ? 'interview_list' : 'retest_list';
  if (candidate.stage !== targetStage) {
    return { ok: false, message: `${candidate.name} 当前不在「${STAGE_LABELS[targetStage]}」阶段，无法排期` };
  }

  const candSlots: string[] = candidate.availability ? JSON.parse(candidate.availability) : [];
  if (candSlots.length === 0) return { ok: false, message: `${candidate.name} 尚未填写可面试时间` };

  const interviewers = db.getAllInterviewers();
  if (interviewers.length === 0) return { ok: false, message: '暂无面试官可约时间数据' };

  // 选定面试官：指定 > 与岗位同部门 > 任意可匹配
  let chosen = interviewerId ? interviewers.find((i) => i.id === interviewerId) : undefined;
  if (!chosen) {
    const sameDept = interviewers.find((i) => i.dept === (PROFILES.find((p) => p.name === candidate.name)?.dept));
    const pool = sameDept ? [sameDept, ...interviewers.filter((i) => i.id !== sameDept.id)] : interviewers;
    chosen = pool.find((i) => sharedSlots(candSlots, i.available_slots).length > 0) || pool[0];
  }

  const overlap = sharedSlots(candSlots, chosen!.available_slots);
  if (overlap.length === 0) {
    return {
      ok: false,
      message: `「${candidate.name}」与面试官「${chosen!.name}」时间无交集，请调整可约时间后重试`,
      schedule: { candidate: candidate.name, interviewer: chosen!.name, overlap: [] },
    };
  }

  const slot = overlap[0]; // 最早可约时段
  const duration = 60;
  const result = Math.random() > 0.3 ? 'passed' : 'failed';

  const interview = db.createInterview({
    id: uuidv4(),
    candidate_id: candidate.id,
    candidate_name: candidate.name,
    type: type === 'group' ? 'group_interview' : 'retest',
    position: candidate.position,
    scheduled_time: slot,
    duration_minutes: duration,
    interviewers: JSON.stringify([chosen!.name]),
    location: type === 'group' ? '腾讯会议·群面' : '腾讯会议·复试',
    status: 'scheduled',
    result,
    feedback: result === 'passed' ? '面试通过' : '面试未通过',
    created_at: nowISO(),
    updated_at: nowISO(),
  });

  const resultStage: StageKey = type === 'group' ? 'interview_result' : 'retest_result';
  const updates: Partial<db.DbCandidate> = {
    stage: resultStage,
    interview_result: type === 'group' ? result : candidate.interview_result,
    retest_result: type === 'retest' ? result : candidate.retest_result,
  };
  if (type === 'group') updates.interview_time = slot;
  else updates.retest_time = slot;
  updates.interviewers = JSON.stringify([chosen!.name]);
  updates.parked = 0; // HR 介入约面，解除挂起（若存在）
  db.updateCandidate(candidate.id, updates);

  const log = db.addAgentLog({
    type: 'schedule',
    message: `📅 ${candidate.name} ${type === 'group' ? '群面' : '复试'}已排期：${slot} · 面试官 ${chosen!.name} · ${result === 'passed' ? '通过' : '未通过'}`,
    candidate_id: candidate.id,
  });
  broadcast({ type: 'agent_log', log });
  broadcast({ type: 'candidate_update', candidate: serializeCandidate(db.getCandidate(candidate.id)!) });
  broadcast({ type: 'schedule', interviews: db.getAllInterviews().map((i) => ({ ...i, interviewers: i.interviewers ? JSON.parse(i.interviewers) : [] })) });
  recomputeAndBroadcastAnomalies();

  return {
    ok: true,
    message: `已为 ${candidate.name} 匹配 ${slot}（面试官 ${chosen!.name}）`,
    schedule: { candidate: candidate.name, interviewer: chosen!.name, slot, result, duration },
  };
}

// ============= HR 简历收集（HR 完成，Agent 聚合 + 继续推进） =============

export function hrUploadResume(input: {
  name: string;
  position?: string;
  source?: string;
  phone?: string;
  email?: string;
  tags?: string[];
  availability?: string[];
}): { ok: boolean; message: string; candidate?: any } {
  if (!input.name || !input.name.trim()) return { ok: false, message: '候选人姓名不能为空' };
  const id = uuidv4();
  const ts = nowISO();
  const profile = PROFILES.find((p) => p.name === input.name.trim());
  const availability = input.availability && input.availability.length > 0 ? input.availability : slotsFor(hashName(input.name), 3);

  const candidate = db.createCandidate({
    id,
    name: input.name.trim(),
    phone: input.phone || profile?.phone || null,
    email: input.email || profile?.email || null,
    position: input.position || profile?.position || null,
    source: input.source || profile?.source || 'HR收集',
    resume_path: null,
    stage: 'resume_collection',
    stage_history: JSON.stringify([{ stage: 'resume_collection', timestamp: ts, note: 'HR 收集并上传简历' }]),
    tags: input.tags && input.tags.length ? JSON.stringify(input.tags) : profile ? JSON.stringify(profile.tags) : null,
    interview_time: null,
    interviewers: null,
    interview_result: null,
    retest_time: null,
    retest_result: null,
    remark: null,
    availability: JSON.stringify(availability),
    created_at: ts,
    updated_at: ts,
  });

  // Agent 立即聚合到腾讯文档（统一格式）
  aggregateTencentDoc();
  const log1 = db.addAgentLog({ type: 'system', message: `📥 HR 上传简历：${candidate.name}（${candidate.position || '岗位待定'}）→ Agent 已聚合至腾讯文档《招聘简历库》`, candidate_id: candidate.id });
  broadcast({ type: 'agent_log', log1 });

  // Agent 继续推进：简历收集 → HR初筛
  advanceCandidate(candidate.id, 'initial_screening', 'Agent 继续推进流程');

  broadcast({ type: 'stats', stats: db.getPipelineStats() });
  recomputeAndBroadcastAnomalies();
  return { ok: true, message: `已收集 ${candidate.name} 的简历，Agent 已汇总至腾讯文档并继续推进`, candidate: serializeCandidate(db.getCandidate(candidate.id)!) };
}

function hashName(name: string): number {
  return [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
}

// ============= 异常（推进慢 / 识别慢 / 信息缺失） =============

const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 分钟未推进 = 推进慢
const RECOGNIZE_THRESHOLD_MS = 3 * 60 * 1000; // 3 分钟未识别 = 识别慢

function screeningDecision(candidateId: string): 'pass' | 'review' | 'reject' | null {
  const rec = db.getScreeningByCandidate(candidateId);
  return rec ? rec.decision : null;
}

export function computeAnomalies(): Anomaly[] {
  const candidates = db.getAllCandidates();
  const now = Date.now();
  const list: Anomaly[] = [];

  for (const c of candidates) {
    const age = now - new Date(c.updated_at).getTime();
    const stageLabel = STAGE_LABELS[c.stage] || c.stage;
    const decision = screeningDecision(c.id);

    // 1) 信息缺失
    if (!c.phone || !c.email || !c.position) {
      const missing: string[] = [];
      if (!c.phone) missing.push('电话');
      if (!c.email) missing.push('邮箱');
      if (!c.position) missing.push('岗位');
      list.push({
        id: `miss-${c.id}`,
        type: 'data_missing',
        typeLabel: '信息缺失',
        name: c.name,
        stage: c.stage,
        stageLabel,
        minutes: Math.round(age / 60000),
        hint: `缺少关键字段（${missing.join('、')}），建议 HR 补充后继续`,
        severity: 'mid',
      });
    }

    // 2) 识别慢：简历收集后 Agent 尚未完成识别/汇总推进
    if (c.stage === 'resume_collection' && age > RECOGNIZE_THRESHOLD_MS) {
      list.push({
        id: `rec-${c.id}`,
        type: 'slow_recognition',
        typeLabel: '识别慢',
        name: c.name,
        stage: c.stage,
        stageLabel,
        minutes: Math.round(age / 60000),
        hint: `简历已收集约 ${Math.round(age / 60000)} 分钟，Agent 尚未完成识别与汇总推进`,
        severity: 'mid',
      });
    }

    // 3) 推进慢：非终态、非二筛待审/淘汰，长时间未推进
    const terminal = c.stage === 'retest_result';
    const waiting = decision === 'review' || decision === 'reject';
    if (!terminal && !waiting && c.stage !== 'resume_collection' && age > STUCK_THRESHOLD_MS) {
      list.push({
        id: `adv-${c.id}`,
        type: 'slow_advance',
        typeLabel: '推进慢',
        name: c.name,
        stage: c.stage,
        stageLabel,
        minutes: Math.round(age / 60000),
        hint: `已在「${stageLabel}」停留约 ${Math.round(age / 60000)} 分钟，建议 HR 介入推进`,
        severity: 'high',
      });
    }
  }

  const order: Record<Anomaly['severity'], number> = { high: 0, mid: 1, low: 2 };
  const sorted = list.sort((a, b) => order[a.severity] - order[b.severity] || b.minutes - a.minutes);
  // 防御性截断：看板只展示最关键的若干条，避免噪声淹没（完整数据仍在数据库）
  return sorted.slice(0, 50);
}

function recomputeAndBroadcastAnomalies(): void {
  broadcast({ type: 'anomalies', anomalies: computeAnomalies() });
}

// ============= 引擎主循环（顺序推进 + 工具拦截） =============

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
const TICK_MS = 2200;

function pickCandidateToAdvance(): db.DbCandidate | null {
  const candidates = db.getAllCandidates();
  const eligible = candidates.filter((c) => {
    if (c.parked) return false; // 已被 HR 挂起（异常），Agent 不自动推进
    if (c.stage === 'retest_result') return false;
    const decision = screeningDecision(c.id);
    if (decision === 'reject') return false; // 已淘汰
    if (decision === 'review') return false; // 待人工审核
    return true;
  });
  if (eligible.length === 0) return null;
  // 优先推进停留最久、阶段最靠前的，避免堆积
  const sorted = eligible.sort((a, b) => {
    const ia = stageIndex(a.stage);
    const ib = stageIndex(b.stage);
    if (ia !== ib) return ia - ib;
    return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
  });
  return sorted[0];
}

async function tick(): Promise<void> {
  const candidate = pickCandidateToAdvance();
  if (!candidate) return;

  try {
    switch (candidate.stage) {
      case 'resume_collection':
        // HR 已上传，Agent 聚合腾讯文档并继续推进
        aggregateTencentDoc();
        advanceCandidate(candidate.id, 'initial_screening', 'Agent 继续推进流程');
        break;
      case 'initial_screening':
        // 判断闸口：等待 HR 在「AI 初筛」面板手动发起 AI 初筛（Agent 不自动处理）
        break;
      case 'group_creation':
        advanceCandidate(candidate.id, 'secondary_screening', 'Agent 自动推进');
        break;
      case 'secondary_screening':
        // 判断闸口：等待 HR 在「AI 二筛」面板手动发起 AI 辅助二筛（Agent 不自动处理）
        break;
      case 'interview_list':
        // 判断闸口：等待 HR 在「约面排期」面板手动发起时间匹配（Agent 不自动处理）
        break;
      case 'interview_result':
        if (candidate.interview_result === 'failed') break; // 未通过，终止
        advanceCandidate(candidate.id, 'result_notification', 'Agent 自动推进');
        break;
      case 'result_notification':
        advanceCandidate(candidate.id, 'retest_list', 'Agent 自动推进');
        break;
      case 'retest_list':
        // 判断闸口：等待 HR 在「约面排期」面板手动发起复试时间匹配（Agent 不自动处理）
        break;
      case 'retest_result':
        break; // 终态
      default: {
        const cur = stageIndex(candidate.stage);
        const next = STAGE_ORDER[cur + 1] as StageKey | undefined;
        if (next) advanceCandidate(candidate.id, next, 'Agent 自动推进');
      }
    }
  } catch (err) {
    console.error('[Automation] tick error:', err);
  }

  broadcast({ type: 'stats', stats: db.getPipelineStats() });
  recomputeAndBroadcastAnomalies();
}

export function startAutomation(): void {
  if (running) return;
  if (db.getAllCandidates().length === 0) {
    seedData();
  }
  seedInterviewers();
  if (!db.getTencentDoc()) aggregateTencentDoc();
  running = true;
  timer = setInterval(tick, TICK_MS);
  broadcast({ type: 'status', running: true });
  console.log('[Automation] 提效 Agent 已启动（HR 收集 → Agent 聚合腾讯文档 → AI初筛 → AI二筛 → 约面排期 → 复试）');
}

export function stopAutomation(): void {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
  broadcast({ type: 'status', running: false });
  console.log('[Automation] 提效 Agent 已暂停');
}

export function getStatus(): { running: boolean } {
  return { running };
}

export function resetAutomation(): void {
  stopAutomation();
  db.clearRecruitmentData();
  db.reseedInterviewersAndDoc();
  seedInterviewers();
  seedData();
  aggregateTencentDoc();
  startAutomation();
  broadcast({ type: 'reset' });
  console.log('[Automation] 已重置演示数据');
}

// ============= 种子数据 =============

function seedInterviewers(): void {
  const existing = db.getAllInterviewers();
  if (existing.length > 0) return;
  const seeds = [
    { name: '李工', dept: '研发', role: '技术负责人', seed: 3 },
    { name: '陈经理', dept: '产品', role: '产品负责人', seed: 7 },
    { name: '孙设计', dept: '设计', role: '设计主管', seed: 11 },
    { name: '钱博', dept: '数据', role: '数据专家', seed: 5 },
    { name: '冯博', dept: '算法', role: '算法专家', seed: 9 },
  ];
  for (const s of seeds) {
    db.upsertInterviewer({ name: s.name, dept: s.dept, role: s.role, available_slots: slotsFor(s.seed, 3) });
  }
  broadcast({ type: 'interviewers', interviewers: db.getAllInterviewers() });
}

function seedData(): void {
  const now = new Date();
  const stale = new Date(now.getTime() - 18 * 60 * 1000).toISOString();

  // 制造「异常」演示数据：识别慢（简历收集未推进）/ 推进慢（中途卡住）
  // 这些候选人被「挂起(parked)」，Agent 不会自动推进，需 HR 介入 —— 对应看板「异常」面板
  const staleSeeds: Array<{ name: string; position: string; source: string; stage: string; note: string; updated_at: string; availability?: string[] }> = [
    { name: '黄涛', position: '运维工程师', source: 'BOSS直聘', stage: 'resume_collection', note: '简历已收集，Agent 识别缓慢', updated_at: stale }, // 识别慢
    { name: '林芳', position: '财务专员', source: '内推', stage: 'secondary_screening', note: '部门二筛长时间未处理', updated_at: stale }, // 推进慢（二筛卡住）
    { name: '何军', position: '销售经理', source: '企业微信', stage: 'interview_list', note: '群面名单已就绪，迟迟未约面', updated_at: stale }, // 推进慢（待约面）
  ];
  const staleIds: Record<string, string> = {};
  for (const s of staleSeeds) {
    const id = uuidv4();
    staleIds[s.name] = id;
    const ts = s.updated_at;
    db.createCandidate({
      id,
      name: s.name,
      phone: null,
      email: null,
      position: s.position,
      source: s.source,
      resume_path: null,
      stage: s.stage,
      stage_history: JSON.stringify([{ stage: s.stage, timestamp: ts, note: s.note }]),
      tags: null,
      interview_time: null,
      interviewers: null,
      interview_result: null,
      retest_time: null,
      retest_result: null,
      remark: s.note,
      parked: 1,
      availability: JSON.stringify(s.availability || slotsFor(hashName(s.name), 3)),
      created_at: ts,
      updated_at: ts,
    });
  }

  // 预置二筛样例记录：展示「人工审核 / 淘汰」两档，使看板立即呈现三档分布
  if (staleIds['黄涛']) {
    const req = '具备运维/监控/自动化部署经验，熟悉 Linux 与 CI/CD，有大促保障经验优先';
    db.addScreeningRecord({
      candidate_id: staleIds['黄涛'],
      candidate_name: '黄涛',
      position: '运维工程师',
      dept_requirement: req,
      prompt: buildScreeningPrompt({ name: '黄涛', position: '运维工程师', tags: '[]', source: 'BOSS直聘' } as db.DbCandidate, req),
      confidence: 58,
      decision: 'review',
      matched_skills: ['Linux'],
      note: '置信度 58%，命中 Linux，建议人工审核',
    });
  }
  if (staleIds['林芳']) {
    const req = '熟悉财务报表/税务/核算，有 ERP 与合并报表经验优先';
    db.addScreeningRecord({
      candidate_id: staleIds['林芳'],
      candidate_name: '林芳',
      position: '财务专员',
      dept_requirement: req,
      prompt: buildScreeningPrompt({ name: '林芳', position: '财务专员', tags: '[]', source: '内推' } as db.DbCandidate, req),
      confidence: 33,
      decision: 'reject',
      matched_skills: [],
      note: '置信度 33%，无关键技能命中，AI 判定淘汰',
    });
  }

  // 正常流动候选人：分布在不同阶段，使「AI 初筛 / AI 二筛 / 约面排期 / 复试」面板初始即有可操作内容
  const flowProfiles: Array<{ name: string; position: string; source: string; stage: string; tags: string[]; email: string; interview_result?: string }> = [
    { name: '周敏', position: '运营专员', source: 'BOSS直聘', stage: 'initial_screening', tags: ['社群', '内容'], email: 'zm@example.com' },
    { name: '赵磊', position: '后端工程师', source: '内推', stage: 'initial_screening', tags: ['Go', '微服务'], email: 'zl@example.com' },
    { name: '杨光', position: '数据分析师', source: 'BOSS直聘', stage: 'secondary_screening', tags: ['SQL', 'Python'], email: 'yg@example.com' },
    { name: '陈静', position: '测试工程师', source: '内推', stage: 'secondary_screening', tags: ['自动化', '性能'], email: 'cj@example.com' },
    { name: '李娜', position: '产品经理', source: '内推', stage: 'secondary_screening', tags: ['B端', '数据驱动'], email: 'ln@example.com' },
    { name: '张伟', position: '前端工程师', source: '官网', stage: 'interview_list', tags: ['React', 'TypeScript'], email: 'zw@example.com' },
    { name: '王强', position: 'Java工程师', source: '猎头', stage: 'interview_list', tags: ['SpringCloud', '高并发'], email: 'wq@example.com' },
    { name: '刘洋', position: 'UI设计师', source: 'BOSS直聘', stage: 'interview_list', tags: ['Figma', '交互'], email: 'ly@example.com' },
    { name: '孙浩', position: '前端工程师', source: 'BOSS直聘', stage: 'interview_result', tags: ['Vue', '可视化'], email: 'sh@example.com', interview_result: 'passed' },
    { name: '郑爽', position: 'HRBP', source: '内推', stage: 'retest_list', tags: ['组织发展', '招聘'], email: 'zs@example.com' },
  ];
  const flowIds: Record<string, string> = {};
  for (const p of flowProfiles) {
    const id = uuidv4();
    flowIds[p.name] = id;
    const ts = nowISO();
    db.createCandidate({
      id,
      name: p.name,
      phone: '138' + String(Math.floor(10000000 + Math.random() * 89999999)),
      email: p.email,
      position: p.position,
      source: p.source,
      resume_path: null,
      stage: p.stage,
      stage_history: JSON.stringify([{ stage: p.stage, timestamp: ts, note: 'HR 收集并上传简历' }]),
      tags: JSON.stringify(p.tags),
      interview_time: null,
      interviewers: null,
      interview_result: (p as any).interview_result || null,
      retest_time: null,
      retest_result: null,
      remark: null,
      availability: JSON.stringify(slotsFor(hashName(p.name), 3)),
      created_at: ts,
      updated_at: ts,
    });
  }

  // 预置「AI 初筛」样例：展示「直接过 / 人工复核」两档
  if (flowIds['周敏']) {
    const req = '具备社群运营与内容策划能力，有增长活动经验优先';
    db.addScreeningRecord({
      candidate_id: flowIds['周敏'],
      candidate_name: '周敏',
      position: '运营专员',
      dept_requirement: req,
      prompt: buildInitialScreeningPrompt({ name: '周敏', position: '运营专员', tags: '["社群","内容"]', source: 'BOSS直聘' } as db.DbCandidate, req),
      confidence: 75,
      decision: 'pass',
      matched_skills: ['社群', '内容'],
      note: '初筛置信度 75%，基础技能匹配，AI 判定直接过',
      phase: 'initial',
    });
  }
  if (flowIds['赵磊']) {
    const req = '精通 Go / Java 服务端开发，熟悉微服务与高并发架构，有分布式经验优先';
    db.addScreeningRecord({
      candidate_id: flowIds['赵磊'],
      candidate_name: '赵磊',
      position: '后端工程师',
      dept_requirement: req,
      prompt: buildInitialScreeningPrompt({ name: '赵磊', position: '后端工程师', tags: '["Go","微服务"]', source: '内推' } as db.DbCandidate, req),
      confidence: 50,
      decision: 'review',
      matched_skills: ['Go'],
      note: '初筛置信度 50%，建议人工复核',
      phase: 'initial',
    });
  }

  // 预置「直接过」样例：张伟 已通过部门二筛、进入群面名单（展示三档中的「直接过」）
  {
    const req = '具备 React / TypeScript 3 年以上经验，熟悉可视化与性能优化，有大型项目经验优先';
    db.addScreeningRecord({
      candidate_id: flowIds['张伟'],
      candidate_name: '张伟',
      position: '前端工程师',
      dept_requirement: req,
      prompt: buildScreeningPrompt({ name: '张伟', position: '前端工程师', tags: '["React","TypeScript"]', source: '官网' } as db.DbCandidate, req),
      confidence: 88,
      decision: 'pass',
      matched_skills: ['React', 'TypeScript'],
      note: '置信度 88%，技能高度匹配，AI 判定直接过',
      phase: 'secondary',
    });
  }

  db.addAgentLog({ type: 'system', message: '🟢 提效 Agent 已上线：HR 收集简历 → Agent 聚合腾讯文档 → AI 初筛 → AI 二筛 → 约面排期 → 复试' });
}

// ============= 快照（SSE 首帧） =============

export function getSnapshot(): {
  stats: ReturnType<typeof db.getPipelineStats>;
  events: RawEvent[];
  logs: AgentLog[];
  anomalies: Anomaly[];
  status: { running: boolean };
  tencentDoc: ReturnType<typeof db.getTencentDoc>;
  interviewers: ReturnType<typeof db.getAllInterviewers>;
  screenings: ReturnType<typeof db.getScreeningRecords>;
  schedule: Array<any>;
} {
  return {
    stats: db.getPipelineStats(),
    events: db.getRecentEvents(40).reverse(),
    logs: db.getAgentLogs(40).reverse(),
    anomalies: computeAnomalies(),
    status: getStatus(),
    tencentDoc: db.getTencentDoc(),
    interviewers: db.getAllInterviewers(),
    screenings: db.getScreeningRecords(50),
    schedule: db.getAllInterviews().map((i) => ({ ...i, interviewers: i.interviewers ? JSON.parse(i.interviewers) : [] })),
  };
}

// ============= 轻量干预（HR 兜底控制） =============

const INTERVENTION_STAGE_MAP: Record<string, StageKey> = {
  初筛: 'initial_screening',
  拉群: 'group_creation',
  二筛: 'secondary_screening',
  面试: 'interview_list',
  群面名单: 'interview_list',
  群面安排: 'interview_schedule',
  群面结果: 'interview_result',
  结果通知: 'result_notification',
  复试: 'retest_list',
  复试名单: 'retest_list',
  复试安排: 'retest_schedule',
  复试结果: 'retest_result',
};

export function runIntervention(command: string): { ok: boolean; message: string; log?: AgentLog } {
  const all = db.getAllCandidates();
  let candidate = all.find((c) => command.includes(c.name));
  if (!candidate) {
    const m = command.match(/([一-龥]{2,3})/);
    if (m) candidate = db.findCandidateByName(m[1]);
  }
  if (!candidate) {
    return { ok: false, message: '未在指令中识别到候选人姓名，请类似输入「把 张伟 推进复试」' };
  }

  // 驳回 / 淘汰
  if (command.includes('驳回') || command.includes('淘汰') || command.includes('放弃') || command.includes('不通过')) {
    const field = candidate.stage.startsWith('retest') ? 'retest_result' : 'interview_result';
    db.updateCandidate(candidate.id, { [field]: 'failed', parked: 0 } as Partial<db.DbCandidate>);
    const log = db.addAgentLog({ type: 'intervention', message: `🛑 HR 干预：驳回 ${candidate.name}（标记为未通过）`, candidate_id: candidate.id });
    broadcast({ type: 'agent_log', log });
    broadcast({ type: 'candidate_update', candidate: serializeCandidate(db.getCandidate(candidate.id)!) });
    recomputeAndBroadcastAnomalies();
    return { ok: true, message: `已驳回 ${candidate.name}`, log };
  }

  // 推进
  let target: StageKey | undefined;
  for (const [kw, st] of Object.entries(INTERVENTION_STAGE_MAP)) {
    if (command.includes(kw)) {
      target = st;
      break;
    }
  }
  if (!target) {
    const cur = stageIndex(candidate.stage);
    target = (STAGE_ORDER[cur + 1] as StageKey) || undefined;
  }
  if (!target) {
    return { ok: false, message: `${candidate.name} 已处于最终阶段，无法继续推进` };
  }

  const cur = stageIndex(candidate.stage);
  const tgt = stageIndex(target);
  if (tgt <= cur) {
    return { ok: false, message: `${candidate.name} 当前已在「${STAGE_LABELS[candidate.stage]}」，无法回退到「${STAGE_LABELS[target]}」` };
  }

  db.updateCandidate(candidate.id, { parked: 0 }); // HR 介入即解除挂起
  const updated = advanceCandidate(candidate.id, target, 'HR 干预推进');
  broadcast({ type: 'stats', stats: db.getPipelineStats() });
  recomputeAndBroadcastAnomalies();
  return { ok: true, message: `已将 ${candidate.name} 推进至「${STAGE_LABELS[target]}」`, log: db.getAgentLogs(1)[0] as AgentLog };
}
