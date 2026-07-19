import { useMemo, useState, useEffect } from 'react';
import { Button, Input, Textarea, Tag, MessagePlugin } from 'tdesign-react';
import { Filter, Sparkles, Play, History, CheckCircle2, AlertCircle, XCircle, Lock } from 'lucide-react';
import type { Candidate, ScreenRecord } from '../../hooks/useAutomation';
import { stageLabel } from '../../hooks/useAutomation';
import { INITIAL_HARD_GATES } from '../../demo/engine';
import { SectionCard, EmptyHint, DECISION_META, fmtDateTime } from './shared';

interface Props {
  candidates: Candidate[];
  screenings: ScreenRecord[];
  generatePrompt: (id: string, req?: string) => Promise<any>;
  runScreening: (id: string, req?: string) => Promise<any>;
}

const DEFAULT_REQ: Record<string, string> = {
  前端工程师: '具备 React / TypeScript 3 年以上经验，熟悉可视化与性能优化，有大型项目经验优先',
  Java工程师: '精通 SpringCloud 微服务，熟悉高并发与分布式事务，有大流量系统经验优先',
  后端工程师: '精通 Go / Java 服务端开发，熟悉微服务与高并发架构，有分布式经验优先',
  测试工程师: '掌握自动化测试与性能压测，熟悉接口测试框架，有 CI/CD 经验优先',
  UI设计师: '熟练使用 Figma，具备交互设计能力，有 B 端 / C 端设计经验优先',
  数据分析师: '精通 SQL 与 Python，熟悉指标体系搭建与数据建模，有业务分析经验优先',
  算法工程师: '掌握 NLP 与深度学习，熟悉主流训练框架，有落地项目优先',
  产品经理: '具备 B 端 / C 端产品规划能力，数据驱动，有 0-1 经验优先',
  运营专员: '具备社群运营与内容策划能力，有增长活动经验优先',
  HRBP: '熟悉组织发展与招聘全流程，具备沟通协调与数据分析能力优先',
};

export function InitialScreeningTab({ candidates, screenings, generatePrompt, runScreening }: Props) {
  const pending = useMemo(
    () => candidates.filter((c) => c.stage === 'initial_screening'),
    [candidates],
  );
  // 仅展示 AI 初筛阶段产生的记录
  const initialRecords = useMemo(
    () => screenings.filter((r) => r.phase === 'initial'),
    [screenings],
  );

  const [selId, setSelId] = useState<string | null>(null);
  const [req, setReq] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScreenRecord | null>(null);

  const sel = pending.find((c) => c.id === selId) || pending[0] || null;

  // 选中候选人变化时（含引擎自动推进导致切换），同步重置技能要求文本，避免遗留上一位的旧内容
  useEffect(() => {
    if (sel) setReq(DEFAULT_REQ[sel.position || ''] || '');
  }, [sel?.id]);

  const selectCandidate = (c: Candidate) => {
    setSelId(c.id);
    setReq(DEFAULT_REQ[c.position || ''] || '');
    setPrompt('');
    setResult(null);
  };

  const onGenerate = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const d = await generatePrompt(sel.id, req || undefined);
      if (d && d.prompt) setPrompt(d.prompt);
    } catch (e: any) {
      MessagePlugin.error('生成提示词失败：' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onRun = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const d = await runScreening(sel.id, req || undefined);
      if (d && d.ok && d.record) {
        setResult(d.record);
        MessagePlugin.success(d.message || '初筛完成');
      } else {
        MessagePlugin.error((d && (d.error || d.message)) || '初筛失败');
      }
    } catch (e: any) {
      MessagePlugin.error('初筛执行失败：' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      {/* 待初筛列表 */}
      <div className="col-span-3 flex flex-col gap-4 min-h-0">
        <SectionCard title={`待初筛（${pending.length}）`} icon={<Filter size={16} color="#0052D9" />} className="flex-1 min-h-0">
          <div className="flex flex-col gap-1.5 overflow-auto h-full pr-1">
            {pending.length === 0 && <EmptyHint text="暂无待初筛候选人" />}
            {pending.map((c) => (
              <button
                key={c.id}
                onClick={() => selectCandidate(c)}
                className="text-left rounded-lg px-3 py-2 flex flex-col gap-0.5 transition-colors"
                style={{
                  backgroundColor: sel?.id === c.id ? 'rgba(0,82,217,0.08)' : 'transparent',
                  border: `1px solid ${sel?.id === c.id ? '#0052D9' : 'var(--td-component-stroke)'}`,
                }}
              >
                <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                  {c.name}
                </span>
                <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  {c.position || '—'} · {(c.tags || []).join('、') || '无标签'}
                </span>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* 初筛工作台 */}
      <div className="col-span-5 flex flex-col gap-4 min-h-0">
        <SectionCard title="AI 初筛工作台" icon={<Sparkles size={16} color="#0052D9" />} className="flex-1 min-h-0">
          {!sel ? (
            <EmptyHint text="从左侧选择一位待初筛候选人" />
          ) : (
            <div className="flex flex-col gap-3 overflow-auto h-full pr-1">
              <div className="text-sm">
                <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                  {sel.name}
                </span>
                <span className="ml-1 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  {sel.position} · 当前阶段：{stageLabel(sel.stage)}
                </span>
                {(sel.education || sel.school) && (
                  <div className="mt-0.5 text-[11px]" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    学历 {sel.education || '未填'} · 院校 {sel.school || '未填'}
                  </div>
                )}
              </div>

              {/* 初筛硬闸口：系统强制定死，不可修改 */}
              <div className="flex flex-col gap-1">
                <span className="text-xs flex items-center gap-1" style={{ color: '#E34D59' }}>
                  <Lock size={12} /> 初筛硬闸口（系统强制定死，不可修改）
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded"
                    style={{ color: '#E34D59', backgroundColor: 'rgba(227,77,89,0.08)', border: '1px solid rgba(227,77,89,0.25)' }}
                  >
                    🔒 {INITIAL_HARD_GATES.educationLabel}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded"
                    style={{ color: '#E34D59', backgroundColor: 'rgba(227,77,89,0.08)', border: '1px solid rgba(227,77,89,0.25)' }}
                  >
                    🔒 {INITIAL_HARD_GATES.schoolLabel}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                  岗位技能要求（HR 可调整，硬闸口之上叠加）
                </span>
                <Textarea
                  value={req}
                  onChange={(v) => setReq(v as string)}
                  placeholder="输入岗位技能要求…"
                  autosize={{ minRows: 2, maxRows: 4 }}
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" icon={<Sparkles size={14} />} loading={busy} onClick={onGenerate}>
                  生成专业提示词
                </Button>
                <Button theme="primary" icon={<Play size={14} />} loading={busy} onClick={onRun}>
                  执行 AI 初筛
                </Button>
              </div>

              {prompt && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                    生成的提示词（可直接投递给 CodeBuddy SDK LLM）
                  </span>
                  <pre
                    className="text-[11px] leading-relaxed rounded-lg p-3 overflow-auto max-h-48"
                    style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)', whiteSpace: 'pre-wrap' }}
                  >
                    {prompt}
                  </pre>
                </div>
              )}

              {result && <ResultPanel rec={result} />}
            </div>
          )}
        </SectionCard>
      </div>

      {/* 初筛记录 */}
      <div className="col-span-4 flex flex-col gap-4 min-h-0">
        <SectionCard title="初筛记录" icon={<History size={16} color="#0052D9" />} className="flex-1 min-h-0">
          <div className="flex flex-col gap-2 overflow-auto h-full pr-1">
            {initialRecords.length === 0 && <EmptyHint text="暂无初筛记录，执行后将自动归档" />}
            {initialRecords.map((r) => (
              <div
                key={r.id}
                className="rounded-lg p-2.5 flex flex-col gap-1"
                style={{ backgroundColor: 'var(--td-bg-color-component)', border: '1px solid var(--td-component-stroke)' }}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                    {r.candidate_name || '—'}
                  </span>
                  <DecisionBadge decision={r.decision} confidence={r.confidence} />
                </div>
                <div className="text-[11px] text-green-700">
                  命中：{(r.matched_skills || []).join('、') || '无'}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  {fmtDateTime(r.created_at)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function DecisionBadge({ decision, confidence }: { decision?: string; confidence?: number }) {
  const d = decision || 'review';
  const m = DECISION_META[d] || DECISION_META.review;
  const cf = typeof confidence === 'number' ? confidence : 0;
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{ color: m.color, backgroundColor: m.bg }}
    >
      {cf}% · {m.label}
    </span>
  );
}

function ResultPanel({ rec }: { rec: ScreenRecord }) {
  const safe = rec || ({} as ScreenRecord);
  const decision = safe.decision || 'review';
  const m = DECISION_META[decision] || DECISION_META.review;
  const Icon = decision === 'pass' ? CheckCircle2 : decision === 'reject' ? XCircle : AlertCircle;
  const confidence = typeof safe.confidence === 'number' ? safe.confidence : 0;
  return (
    <div className="rounded-lg p-3 flex flex-col gap-2" style={{ backgroundColor: m.bg, border: `1px solid ${m.color}` }}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium" style={{ color: m.color }}>
          <Icon size={16} />
          {m.label}
        </span>
        <span className="text-lg font-semibold tabular-nums" style={{ color: m.color }}>
          {confidence}%
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#fff' }}>
        <div className="h-full rounded-full" style={{ width: `${confidence}%`, backgroundColor: m.color }} />
      </div>
      <div className="text-[11px]" style={{ color: 'var(--td-text-color-secondary)' }}>
        命中基础技能：<span className="text-green-700">{(safe.matched_skills || []).join('、') || '无'}</span>
      </div>
      {safe.candidate_name && (
        <div className="text-[11px]" style={{ color: 'var(--td-text-color-placeholder)' }}>
          候选人：{safe.candidate_name}
          {safe.position ? ` · ${safe.position}` : ''}
        </div>
      )}
      <div className="text-[11px]" style={{ color: 'var(--td-text-color-secondary)' }}>
        {safe.note || ''}
      </div>
    </div>
  );
}
