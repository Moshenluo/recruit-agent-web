import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const dbPath = path.join(__dirname, '..', 'data', 'chat.db');

// 确保 data 目录存在
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接
const db = new Database(dbPath);

// 启用 WAL 模式以提高性能
db.pragma('journal_mode = WAL');

// 初始化数据库表
db.exec(`
  -- 会话表
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    sdk_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 消息表
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL,
    tool_calls TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 为会话 ID 创建索引
  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

  -- ========== 招聘业务表 ==========

  -- 候选人表
  CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    position TEXT,
    source TEXT,
    resume_path TEXT,
    stage TEXT NOT NULL DEFAULT 'resume_collection',
    stage_history TEXT,
    tags TEXT,
    interview_time TEXT,
    interviewers TEXT,
    interview_result TEXT,
    retest_time TEXT,
    retest_result TEXT,
    remark TEXT,
    parked INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 面试记录表
  CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    candidate_name TEXT,
    type TEXT NOT NULL CHECK (type IN ('group_interview', 'retest')),
    position TEXT,
    scheduled_time TEXT,
    duration_minutes INTEGER DEFAULT 60,
    interviewers TEXT,
    location TEXT,
    status TEXT DEFAULT 'scheduled',
    result TEXT,
    feedback TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  );

  -- 流程统计快照表
  CREATE TABLE IF NOT EXISTS pipeline_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stats_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- ========== 自动化中枢表 ==========

  -- 采集层：原始事件（来自企业微信/群/BOSS/腾讯文档的监听流）
  CREATE TABLE IF NOT EXISTS raw_events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    channel TEXT,
    content TEXT NOT NULL,
    parsed INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- 自动化层：Agent 行为日志
  CREATE TABLE IF NOT EXISTS agent_logs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    candidate_id TEXT,
    created_at TEXT NOT NULL
  );

  -- 为原始事件与日志创建时间索引
  CREATE INDEX IF NOT EXISTS idx_raw_events_created ON raw_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at);

  -- ========== 腾讯文档：简历汇总库（Agent 自动聚合的统一文档） ==========
  -- 单一文档，内容为统一格式的简历清单（markdown）
  CREATE TABLE IF NOT EXISTS tencent_doc (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- ========== AI 二筛记录 ==========
  CREATE TABLE IF NOT EXISTS screening_records (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    candidate_name TEXT,
    position TEXT,
    dept_requirement TEXT,
    prompt TEXT,
    confidence REAL,
    decision TEXT CHECK (decision IN ('pass', 'review', 'reject')),
    matched_skills TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  );

  -- ========== 面试官与可约时间表 ==========
  CREATE TABLE IF NOT EXISTS interviewers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dept TEXT,
    role TEXT,
    available_slots TEXT NOT NULL DEFAULT '[]',  -- JSON 数组，元素如 "2026-07-20 14:00"
    created_at TEXT
  );
`);

// 数据库迁移：添加 sdk_session_id 列（如果不存在）
try {
  const tableInfo = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  const hasColumn = tableInfo.some(col => col.name === 'sdk_session_id');
  if (!hasColumn) {
    db.exec("ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT");
    console.log("[DB] Added sdk_session_id column to sessions table");
  }

  // 候选人可用性（求职者可面试时间槽）
  const candInfo = db.prepare("PRAGMA table_info(candidates)").all() as Array<{ name: string }>;
  if (!candInfo.some((col) => col.name === 'availability')) {
    db.exec("ALTER TABLE candidates ADD COLUMN availability TEXT");
    console.log("[DB] Added availability column to candidates table");
  }

  // 面试官表 created_at 列迁移
  const ivInfo = db.prepare("PRAGMA table_info(interviewers)").all() as Array<{ name: string }>;
  if (ivInfo.length > 0 && !ivInfo.some((col) => col.name === 'created_at')) {
    db.exec("ALTER TABLE interviewers ADD COLUMN created_at TEXT");
    console.log("[DB] Added created_at column to interviewers table");
  }

  // 候选人 parked 列迁移（异常挂起标记：Agent 不会自动推进被挂起的候选人）
  const candInfo2 = db.prepare("PRAGMA table_info(candidates)").all() as Array<{ name: string }>;
  if (candInfo2.length > 0 && !candInfo2.some((col) => col.name === 'parked')) {
    db.exec("ALTER TABLE candidates ADD COLUMN parked INTEGER DEFAULT 0");
    console.log("[DB] Added parked column to candidates table");
  }

  // 二筛记录阶段标记（initial=AI初筛 / secondary=部门二筛）
  const scrInfo = db.prepare("PRAGMA table_info(screening_records)").all() as Array<{ name: string }>;
  if (scrInfo.length > 0 && !scrInfo.some((col) => col.name === 'phase')) {
    db.exec("ALTER TABLE screening_records ADD COLUMN phase TEXT DEFAULT 'secondary'");
    console.log("[DB] Added phase column to screening_records table");
  }
} catch (e) {
  // 忽略错误（列可能已存在）
}

// ============= 类型定义 =============

export interface DbSession {
  id: string;
  title: string;
  model: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
  tool_calls: string | null;
}

export interface DbCandidate {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  source: string | null;
  resume_path: string | null;
  stage: string;
  stage_history: string | null;
  tags: string | null;
  interview_time: string | null;
  interviewers: string | null;
  interview_result: string | null;
  retest_time: string | null;
  retest_result: string | null;
  remark: string | null;
  availability: string | null;
  parked: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbInterview {
  id: string;
  candidate_id: string;
  candidate_name: string | null;
  type: 'group_interview' | 'retest';
  position: string | null;
  scheduled_time: string | null;
  duration_minutes: number;
  interviewers: string | null;
  location: string | null;
  status: string;
  result: string | null;
  feedback: string | null;
  created_at: string;
  updated_at: string;
}

// ============= 会话操作 =============

export function getAllSessions(): DbSession[] {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
  return stmt.all() as DbSession[];
}

export function getSession(id: string): DbSession | undefined {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  return stmt.get(id) as DbSession | undefined;
}

export function createSession(session: DbSession): DbSession {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, title, model, sdk_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(session.id, session.title, session.model, session.sdk_session_id, session.created_at, session.updated_at);
  return session;
}

export function updateSession(id: string, updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.sdk_session_id !== undefined) {
    fields.push('sdk_session_id = ?');
    values.push(updates.sdk_session_id);
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteSession(id: string): boolean {
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============= 消息操作 =============

export function getMessagesBySession(sessionId: string): DbMessage[] {
  const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
  return stmt.all(sessionId) as DbMessage[];
}

export function createMessage(message: DbMessage): DbMessage {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    message.id,
    message.session_id,
    message.role,
    message.content,
    message.model,
    message.created_at,
    message.tool_calls
  );

  const updateStmt = db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
  updateStmt.run(new Date().toISOString(), message.session_id);

  return message;
}

export function updateMessage(id: string, updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.tool_calls !== undefined) {
    fields.push('tool_calls = ?');
    values.push(updates.tool_calls);
  }

  if (fields.length === 0) return false;

  values.push(id);

  const stmt = db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteMessage(id: string): boolean {
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function createMessages(messages: DbMessage[]): void {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((msgs: DbMessage[]) => {
    for (const msg of msgs) {
      stmt.run(msg.id, msg.session_id, msg.role, msg.content, msg.model, msg.created_at, msg.tool_calls);
    }
  });

  insertMany(messages);
}

export function clearAllData(): void {
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM sessions');
}

// ============= 候选人操作 =============

export function getAllCandidates(): DbCandidate[] {
  const stmt = db.prepare('SELECT * FROM candidates ORDER BY updated_at DESC');
  return stmt.all() as DbCandidate[];
}

export function getCandidate(id: string): DbCandidate | undefined {
  const stmt = db.prepare('SELECT * FROM candidates WHERE id = ?');
  return stmt.get(id) as DbCandidate | undefined;
}

export function createCandidate(candidate: Omit<DbCandidate, 'created_at' | 'updated_at' | 'parked' | 'availability'> & { created_at?: string; updated_at?: string; parked?: number | null; availability?: string | null }): DbCandidate {
  const now = new Date().toISOString();
  const record: DbCandidate = {
    ...candidate,
    availability: candidate.availability ?? null,
    parked: candidate.parked ?? 0,
    created_at: candidate.created_at || now,
    updated_at: candidate.updated_at || now,
  };
  const stmt = db.prepare(`
    INSERT INTO candidates (id, name, phone, email, position, source, resume_path, stage, stage_history, tags, interview_time, interviewers, interview_result, retest_time, retest_result, remark, availability, parked, created_at, updated_at)
    VALUES (@id, @name, @phone, @email, @position, @source, @resume_path, @stage, @stage_history, @tags, @interview_time, @interviewers, @interview_result, @retest_time, @retest_result, @remark, @availability, @parked, @created_at, @updated_at)
  `);
  stmt.run(record);
  return record;
}

export function updateCandidate(id: string, updates: Partial<DbCandidate>): boolean {
  const allowedFields = ['name', 'phone', 'email', 'position', 'source', 'resume_path', 'stage', 'stage_history', 'tags', 'interview_time', 'interviewers', 'interview_result', 'retest_time', 'retest_result', 'remark', 'availability', 'parked'];
  const fields: string[] = [];
  const values: any[] = [];

  for (const field of allowedFields) {
    if (updates[field as keyof DbCandidate] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(updates[field as keyof DbCandidate]);
    }
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const stmt = db.prepare(`UPDATE candidates SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteCandidate(id: string): boolean {
  const stmt = db.prepare('DELETE FROM candidates WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

export function getCandidatesByStage(stage: string): DbCandidate[] {
  const stmt = db.prepare('SELECT * FROM candidates WHERE stage = ? ORDER BY created_at ASC');
  return stmt.all(stage) as DbCandidate[];
}

// ============= 面试记录操作 =============

export function getAllInterviews(): DbInterview[] {
  const stmt = db.prepare('SELECT * FROM interviews ORDER BY scheduled_time DESC');
  return stmt.all() as DbInterview[];
}

export function getInterview(id: string): DbInterview | undefined {
  const stmt = db.prepare('SELECT * FROM interviews WHERE id = ?');
  return stmt.get(id) as DbInterview | undefined;
}

export function createInterview(interview: Omit<DbInterview, 'created_at' | 'updated_at'> & { created_at?: string; updated_at?: string }): DbInterview {
  const now = new Date().toISOString();
  const record: DbInterview = {
    ...interview,
    created_at: interview.created_at || now,
    updated_at: interview.updated_at || now,
  };
  const stmt = db.prepare(`
    INSERT INTO interviews (id, candidate_id, candidate_name, type, position, scheduled_time, duration_minutes, interviewers, location, status, result, feedback, created_at, updated_at)
    VALUES (@id, @candidate_id, @candidate_name, @type, @position, @scheduled_time, @duration_minutes, @interviewers, @location, @status, @result, @feedback, @created_at, @updated_at)
  `);
  stmt.run(record);
  return record;
}

export function updateInterview(id: string, updates: Partial<DbInterview>): boolean {
  const allowedFields = ['candidate_name', 'type', 'position', 'scheduled_time', 'duration_minutes', 'interviewers', 'location', 'status', 'result', 'feedback'];
  const fields: string[] = [];
  const values: any[] = [];

  for (const field of allowedFields) {
    if (updates[field as keyof DbInterview] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(updates[field as keyof DbInterview]);
    }
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const stmt = db.prepare(`UPDATE interviews SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function deleteInterview(id: string): boolean {
  const stmt = db.prepare('DELETE FROM interviews WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============= 流程统计 =============

const STAGE_ORDER = [
  'resume_collection',
  'initial_screening',
  'group_creation',
  'secondary_screening',
  'interview_list',
  'interview_schedule',
  'interview_result',
  'result_notification',
  'retest_list',
  'retest_schedule',
  'retest_result',
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

export function getPipelineStats(): {
  stages: Array<{ key: string; label: string; count: number }>;
  totalCandidates: number;
  totalInterviews: number;
  passedInterviews: number;
  failedInterviews: number;
  pendingInterviews: number;
  positionStats: Array<{ position: string; count: number }>;
  sourceStats: Array<{ source: string; count: number }>;
} {
  // 各阶段人数
  const stageCounts = STAGE_ORDER.map(key => {
    const count = (db.prepare('SELECT COUNT(*) as c FROM candidates WHERE stage = ?').get(key) as { c: number }).c;
    return { key, label: STAGE_LABELS[key] || key, count };
  });

  const totalCandidates = (db.prepare('SELECT COUNT(*) as c FROM candidates').get() as { c: number }).c;
  const totalInterviews = (db.prepare('SELECT COUNT(*) as c FROM interviews').get() as { c: number }).c;
  const passedInterviews = (db.prepare("SELECT COUNT(*) as c FROM interviews WHERE result = 'passed'").get() as { c: number }).c;
  const failedInterviews = (db.prepare("SELECT COUNT(*) as c FROM interviews WHERE result = 'failed'").get() as { c: number }).c;
  const pendingInterviews = (db.prepare("SELECT COUNT(*) as c FROM interviews WHERE result IS NULL OR result = '' OR result = 'pending'").get() as { c: number }).c;

  // 按岗位统计
  const positionStats = db.prepare(`
    SELECT COALESCE(position, '未指定') as position, COUNT(*) as count
    FROM candidates
    GROUP BY position
    ORDER BY count DESC
  `).all() as Array<{ position: string; count: number }>;

  // 按来源统计
  const sourceStats = db.prepare(`
    SELECT COALESCE(source, '未指定') as source, COUNT(*) as count
    FROM candidates
    GROUP BY source
    ORDER BY count DESC
  `).all() as Array<{ source: string; count: number }>;

  return {
    stages: stageCounts,
    totalCandidates,
    totalInterviews,
    passedInterviews,
    failedInterviews,
    pendingInterviews,
    positionStats,
    sourceStats,
  };
}

export function getStageLabels() {
  return STAGE_LABELS;
}

export function getStageOrder() {
  return STAGE_ORDER;
}

// ============= 采集层：原始事件 =============

export function addRawEvent(event: {
  source: string;
  channel: string | null;
  content: string;
  parsed?: number;
}): { id: string; source: string; channel: string | null; content: string; parsed: number; created_at: string } {
  const id = uuidv4();
  const now = new Date().toISOString();
  const record = {
    id,
    source: event.source,
    channel: event.channel || null,
    content: event.content,
    parsed: event.parsed ?? 0,
    created_at: now,
  };
  const stmt = db.prepare(`
    INSERT INTO raw_events (id, source, channel, content, parsed, created_at)
    VALUES (@id, @source, @channel, @content, @parsed, @created_at)
  `);
  stmt.run(record);
  return record;
}

export function getRecentEvents(limit = 50): Array<{
  id: string;
  source: string;
  channel: string | null;
  content: string;
  parsed: number;
  created_at: string;
}> {
  const stmt = db.prepare('SELECT * FROM raw_events ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit) as Array<{
    id: string;
    source: string;
    channel: string | null;
    content: string;
    parsed: number;
    created_at: string;
  }>;
}

export function markEventParsed(id: string): void {
  db.prepare('UPDATE raw_events SET parsed = 1 WHERE id = ?').run(id);
}

// ============= 自动化层：Agent 行为日志 =============

export function addAgentLog(log: {
  type: string;
  message: string;
  candidate_id?: string | null;
}): { id: string; type: string; message: string; candidate_id: string | null; created_at: string } {
  const id = uuidv4();
  const now = new Date().toISOString();
  const record = {
    id,
    type: log.type,
    message: log.message,
    candidate_id: log.candidate_id || null,
    created_at: now,
  };
  const stmt = db.prepare(`
    INSERT INTO agent_logs (id, type, message, candidate_id, created_at)
    VALUES (@id, @type, @message, @candidate_id, @created_at)
  `);
  stmt.run(record);
  return record;
}

export function getAgentLogs(limit = 50): Array<{
  id: string;
  type: string;
  message: string;
  candidate_id: string | null;
  created_at: string;
}> {
  const stmt = db.prepare('SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit) as Array<{
    id: string;
    type: string;
    message: string;
    candidate_id: string | null;
    created_at: string;
  }>;
}

export function countAgentLogsToday(): number {
  const today = new Date().toISOString().slice(0, 10);
  const stmt = db.prepare("SELECT COUNT(*) as c FROM agent_logs WHERE created_at >= ?");
  return (stmt.get(`${today}T00:00:00.000Z`) as { c: number }).c;
}

// ============= 辅助查询 =============

export function findCandidateByName(name: string): DbCandidate | undefined {
  const stmt = db.prepare('SELECT * FROM candidates WHERE name = ?');
  return stmt.get(name) as DbCandidate | undefined;
}

// 重置招聘业务数据（用于演示重置）
export function clearRecruitmentData(): void {
  db.exec('DELETE FROM candidates');
  db.exec('DELETE FROM interviews');
  db.exec('DELETE FROM agent_logs');
  db.exec('DELETE FROM raw_events');
  db.exec('DELETE FROM screening_records');
  // 腾讯文档 & 面试官表保留（reset 时重新生成）
}

// ============= 腾讯文档：简历汇总库 =============

export function getTencentDoc(): { id: number; title: string; content: string; updated_at: string } | null {
  const row = db.prepare('SELECT * FROM tencent_doc WHERE id = 1').get() as
    | { id: number; title: string; content: string; updated_at: string }
    | undefined;
  return row || null;
}

export function upsertTencentDoc(title: string, content: string): { id: number; title: string; content: string; updated_at: string } {
  const now = new Date().toISOString();
  const exists = db.prepare('SELECT id FROM tencent_doc WHERE id = 1').get();
  if (exists) {
    db.prepare('UPDATE tencent_doc SET title = ?, content = ?, updated_at = ? WHERE id = 1').run(title, content, now);
  } else {
    db.prepare('INSERT INTO tencent_doc (id, title, content, updated_at) VALUES (1, ?, ?, ?)').run(title, content, now);
  }
  return { id: 1, title, content, updated_at: now };
}

// ============= AI 二筛记录 =============

export function addScreeningRecord(rec: {
  candidate_id: string;
  candidate_name: string | null;
  position: string | null;
  dept_requirement: string;
  prompt: string;
  confidence: number;
  decision: 'pass' | 'review' | 'reject';
  matched_skills: string[];
  note?: string;
  phase?: 'initial' | 'secondary';
}): { id: string; created_at: string } & typeof rec {
  const id = uuidv4();
  const now = new Date().toISOString();
  const phase = rec.phase || 'secondary';
  const record = { id, created_at: now, ...rec, phase };
  db.prepare(`
    INSERT INTO screening_records (id, candidate_id, candidate_name, position, dept_requirement, prompt, confidence, decision, matched_skills, note, phase, created_at)
    VALUES (@id, @candidate_id, @candidate_name, @position, @dept_requirement, @prompt, @confidence, @decision, @matched_skills, @note, @phase, @created_at)
  `).run({
    ...record,
    matched_skills: JSON.stringify(rec.matched_skills),
  });
  return record;
}

export function getScreeningRecords(limit = 50): Array<{
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
}> {
  const rows = db.prepare('SELECT * FROM screening_records ORDER BY created_at DESC LIMIT ?').all(limit) as Array<any>;
  return rows.map((r) => ({ ...r, matched_skills: r.matched_skills ? JSON.parse(r.matched_skills) : [], phase: r.phase || 'secondary' }));
}

export function getScreeningByCandidate(candidateId: string): {
  id: string;
  candidate_id: string;
  decision: 'pass' | 'review' | 'reject';
  confidence: number;
  created_at: string;
} | undefined {
  return db
    .prepare('SELECT * FROM screening_records WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(candidateId) as any;
}

// ============= 面试官与可约时间 =============

export function getAllInterviewers(): Array<{ id: string; name: string; dept: string | null; role: string | null; available_slots: string[] }> {
  const rows = db.prepare('SELECT * FROM interviewers ORDER BY created_at ASC').all() as Array<any>;
  return rows.map((r) => ({ ...r, available_slots: r.available_slots ? JSON.parse(r.available_slots) : [] }));
}

export function upsertInterviewer(rec: { id?: string; name: string; dept?: string | null; role?: string | null; available_slots: string[] }): {
  id: string;
  name: string;
  dept: string | null;
  role: string | null;
  available_slots: string[];
} {
  const id = rec.id || uuidv4();
  const exists = db.prepare('SELECT id FROM interviewers WHERE id = ?').get(id);
  if (exists) {
    db.prepare('UPDATE interviewers SET name = ?, dept = ?, role = ?, available_slots = ? WHERE id = ?').run(
      rec.name,
      rec.dept || null,
      rec.role || null,
      JSON.stringify(rec.available_slots),
      id,
    );
  } else {
    db.prepare(
      'INSERT INTO interviewers (id, name, dept, role, available_slots, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, rec.name, rec.dept || null, rec.role || null, JSON.stringify(rec.available_slots), new Date().toISOString());
  }
  return { id, name: rec.name, dept: rec.dept || null, role: rec.role || null, available_slots: rec.available_slots };
}

// 重置面试官与腾讯文档（演示重置时调用，重新注入种子）
export function reseedInterviewersAndDoc(): void {
  db.exec('DELETE FROM interviewers');
  db.exec('DELETE FROM tencent_doc');
}

export default db;
