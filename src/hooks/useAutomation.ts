import { useCallback, useEffect, useRef, useState } from 'react';
import { getDemoEngine } from '../demo/engine';

// 演示模式：构建时注入 VITE_DEMO=true（用于公网部署的纯前端 demo，无后端）
const DEMO = (import.meta as any).env?.VITE_DEMO === 'true';

export interface RawEvent {
  id: string;
  source: string;
  channel: string | null;
  content: string;
  parsed: number;
  created_at: string;
}

export interface AgentLog {
  id: string;
  type: string;
  message: string;
  candidate_id: string | null;
  created_at: string;
}

export interface StageStat {
  key: string;
  label: string;
  count: number;
}

export interface Stats {
  stages: StageStat[];
  totalCandidates: number;
  totalInterviews: number;
  passedInterviews: number;
  failedInterviews: number;
  pendingInterviews: number;
  positionStats: Array<{ position: string; count: number }>;
  sourceStats: Array<{ source: string; count: number }>;
}

export interface Anomaly {
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

export interface Candidate {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  source: string | null;
  education: string | null;
  school: string | null;
  stage: string;
  stage_history: Array<{ stage: string; timestamp: string; note: string }>;
  tags: string[];
  interview_time: string | null;
  interviewers: string[];
  interview_result: string | null;
  retest_time: string | null;
  retest_result: string | null;
  remark: string | null;
  availability: string[];
  parked?: number;
  created_at: string;
  updated_at: string;
}

export interface TencentDoc {
  id: number;
  title: string;
  content: string;
  updated_at: string;
}

export interface ScreenRecord {
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

export interface Interviewer {
  id: string;
  name: string;
  dept: string | null;
  role: string | null;
  available_slots: string[];
}

export interface InterviewItem {
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
}

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

export function stageLabel(key: string): string {
  return STAGE_LABELS[key] || key;
}

export function useAutomation() {
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);

  const [tencentDoc, setTencentDoc] = useState<TencentDoc | null>(null);
  const [screenings, setScreenings] = useState<ScreenRecord[]>([]);
  const [interviewers, setInterviewers] = useState<Interviewer[]>([]);
  const [schedule, setSchedule] = useState<InterviewItem[]>([]);

  const esRef = useRef<EventSource | null>(null);

  const fetchCandidates = useCallback(async () => {
    try {
      const r = await fetch('/api/candidates');
      const data = await r.json();
      if (data.candidates) setCandidates(data.candidates);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchScreenings = useCallback(async () => {
    try {
      const r = await fetch('/api/screening-records');
      const d = await r.json();
      if (d.records) setScreenings(d.records);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchInterviewers = useCallback(async () => {
    try {
      const r = await fetch('/api/interviewers');
      const d = await r.json();
      if (d.interviewers) setInterviewers(d.interviewers);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchSchedule = useCallback(async () => {
    try {
      const r = await fetch('/api/schedule');
      const d = await r.json();
      if (d.interviews) setSchedule(d.interviews);
    } catch {
      /* ignore */
    }
  }, []);

  // 统一的消息分发（SSE 与演示引擎共用）
  const dispatch = useCallback((p: any) => {
    switch (p.type) {
      case 'snapshot':
        setEvents(p.events || []);
        setLogs(p.logs || []);
        setStats(p.stats);
        setAnomalies(p.anomalies || []);
        setRunning(p.status?.running ?? false);
        setTencentDoc(p.tencentDoc || null);
        setScreenings(p.screenings || []);
        setInterviewers(p.interviewers || []);
        setSchedule(p.schedule || []);
        if (DEMO) setCandidates(p.candidates || []);
        else fetchCandidates();
        break;
      case 'raw_event':
        setEvents((prev) => [p.event, ...prev].slice(0, 60));
        break;
      case 'agent_log':
        setLogs((prev) => [p.log, ...prev].slice(0, 80));
        break;
      case 'stats':
        setStats(p.stats);
        break;
      case 'anomalies':
      case 'alerts':
        setAnomalies(p.anomalies || p.alerts || []);
        break;
      case 'tencent_doc':
        setTencentDoc(p.doc);
        break;
      case 'screening':
        setScreenings((prev) => [p.record, ...prev].slice(0, 50));
        break;
      case 'interviewers':
        setInterviewers(p.interviewers || []);
        break;
      case 'schedule':
        setSchedule(p.interviews || []);
        break;
      case 'status':
        setRunning(p.running);
        break;
      case 'candidate_update':
        setCandidates((prev) => {
          const idx = prev.findIndex((c) => c.id === p.candidate.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = p.candidate;
            return next;
          }
          return [p.candidate, ...prev];
        });
        break;
      case 'candidate_remove':
        setCandidates((prev) => prev.filter((c) => c.id !== p.id));
        break;
      case 'reset':
        if (!DEMO) {
          fetchCandidates();
          fetchScreenings();
          fetchInterviewers();
          fetchSchedule();
        }
        break;
      case 'ping':
      default:
        break;
    }
  }, [fetchCandidates, fetchScreenings, fetchInterviewers, fetchSchedule]);

  useEffect(() => {
    if (DEMO) {
      const engine = getDemoEngine();
      setConnected(true);
      const unsub = engine.subscribe(dispatch);
      dispatch({ type: 'snapshot', ...engine.getSnapshot() });
      return () => unsub();
    }
    const es = new EventSource('/api/stream');
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      let p: any;
      try {
        p = JSON.parse(e.data);
      } catch {
        return;
      }
      dispatch(p);
    };
    es.onerror = () => setConnected(false);
    return () => {
      es.close();
    };
  }, [dispatch]);

  useEffect(() => {
    if (DEMO) return; // 演示模式走纯前端引擎，不轮询后端 API
    const t = setInterval(() => {
      fetchCandidates();
      fetchSchedule();
    }, 5000);
    return () => clearInterval(t);
  }, [fetchCandidates, fetchSchedule]);

  const control = useCallback(async (action: 'start' | 'stop' | 'reset') => {
    if (DEMO) {
      const engine = getDemoEngine();
      if (action === 'start') engine.start();
      else if (action === 'stop') engine.stop();
      else engine.reset();
      return;
    }
    await fetch('/api/automation/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (action === 'reset') {
      fetchScreenings();
      fetchInterviewers();
      fetchSchedule();
    }
  }, [fetchScreenings, fetchInterviewers, fetchSchedule]);

  const intervene = useCallback(async (command: string) => {
    if (DEMO) return getDemoEngine().intervene(command);
    const r = await fetch('/api/intervention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    return r.json();
  }, []);

  // ===== 新功能接口 =====

  const uploadResume = useCallback(async (payload: any) => {
    if (DEMO) return getDemoEngine().hrUploadResume(payload);
    const r = await fetch('/api/hr/upload-resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (r.ok) {
      fetchCandidates();
      fetchScreenings();
    }
    return d;
  }, [fetchCandidates, fetchScreenings]);

  const updateCandidate = useCallback(async (id: string, patch: any) => {
    if (DEMO) return getDemoEngine().updateCandidate(id, patch);
    try {
      const r = await fetch(`/api/candidates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        fetchCandidates();
        return { ok: true, message: '已保存', candidate: d.candidate };
      }
      return { ok: false, error: d.error || '更新失败' };
    } catch (e: any) {
      return { ok: false, error: e?.message || '更新失败' };
    }
  }, [fetchCandidates]);

  const deleteCandidate = useCallback(async (id: string) => {
    if (DEMO) return getDemoEngine().deleteCandidate(id);
    try {
      const r = await fetch(`/api/candidates/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        fetchCandidates();
        return { ok: true, message: '已删除' };
      }
      return { ok: false, error: d.error || '删除失败' };
    } catch (e: any) {
      return { ok: false, error: e?.message || '删除失败' };
    }
  }, [fetchCandidates]);

  const generatePrompt = useCallback(async (candidateId: string, deptRequirement?: string) => {
    if (DEMO) return getDemoEngine().generatePrompt(candidateId, deptRequirement);
    const r = await fetch('/api/ai-screening-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId, deptRequirement }),
    });
    return r.json();
  }, []);

  const runScreening = useCallback(async (candidateId: string, deptRequirement?: string) => {
    if (DEMO) return getDemoEngine().runAIScreening(candidateId, deptRequirement);
    const r = await fetch('/api/ai-screening', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId, deptRequirement }),
    });
    const d = await r.json();
    if (r.ok) {
      fetchCandidates();
      fetchScreenings();
    }
    return d;
  }, [fetchCandidates, fetchScreenings]);

  const generateInitialPrompt = useCallback(async (candidateId: string, requirement?: string) => {
    if (DEMO) return getDemoEngine().generateInitialPrompt(candidateId, requirement);
    const r = await fetch('/api/ai-initial-screening-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId, requirement }),
    });
    return r.json();
  }, []);

  const runInitialScreening = useCallback(async (candidateId: string, requirement?: string) => {
    if (DEMO) return getDemoEngine().runAIInitialScreening(candidateId, requirement);
    const r = await fetch('/api/ai-initial-screening', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId, requirement }),
    });
    const d = await r.json();
    if (r.ok) {
      fetchCandidates();
      fetchScreenings();
    }
    return d;
  }, [fetchCandidates, fetchScreenings]);

  const saveInterviewer = useCallback(async (payload: any) => {
    if (DEMO) return getDemoEngine().saveInterviewer(payload);
    const r = await fetch('/api/interviewers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (r.ok) fetchInterviewers();
    return d;
  }, [fetchInterviewers]);

  const scheduleInterview = useCallback(async (candidateId: string, type: 'group' | 'retest', interviewerId?: string) => {
    if (DEMO) return getDemoEngine().runScheduling(candidateId, type, interviewerId);
    const r = await fetch('/api/schedule-interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId, type, interviewerId }),
    });
    const d = await r.json();
    if (r.ok) {
      fetchCandidates();
      fetchSchedule();
    }
    return d;
  }, [fetchCandidates, fetchSchedule]);

  return {
    events,
    logs,
    stats,
    anomalies,
    candidates,
    running,
    connected,
    tencentDoc,
    screenings,
    interviewers,
    schedule,
    control,
    intervene,
    uploadResume,
    updateCandidate,
    deleteCandidate,
    generatePrompt,
    runScreening,
    generateInitialPrompt,
    runInitialScreening,
    saveInterviewer,
    scheduleInterview,
    fetchCandidates,
    fetchScreenings,
    fetchInterviewers,
    fetchSchedule,
    stageLabel,
  };
}
