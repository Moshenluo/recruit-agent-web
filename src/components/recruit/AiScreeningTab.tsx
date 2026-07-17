import { useMemo, useState } from 'react';
import { Button, Input, Textarea, Tag, MessagePlugin } from 'tdesign-react';
import { ScanSearch, Sparkles, Play, History, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import type { Candidate, ScreenRecord } from '../../hooks/useAutomation';
import { stageLabel } from '../../hooks/useAutomation';
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
};

export function AiScreeningTab({ candidates, screenings, generatePrompt, runScreening }: Props) {
  const pending = useMemo(
    () => candidates.filter((c) => c.stage === 'secondary_screening'),
    [candidates],
  );
  // 仅展示部门二筛阶段产生的记录（与 AI 初筛记录区分）
  const secondaryRecords = useMemo(
    () => screenings.filter((r) => r.phase === 'secondary'),
    [screenings],
  );
  const [selId, setSelId] = useState<string | null>(null);
  const [req, setReq] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScreenRecord | null>(null);

  const sel = pending.find((c) => c.id === selId) || pending[0] || null;

  const selectCandidate = (c: Candidate) => {
    setSelId(c.id);
    setReq(DEFAULT_REQ[c.position || ''] || '');
    setPrompt('');
    setResult(null);
  };

  const onGenerate = async () => {
    if (!sel) return;
    setBusy(true);
    const d = await generatePrompt(sel.id, req || undefined);
    setBusy(false);
    if (d.prompt) setPrompt(d.prompt);
  };

  const onRun = async () => {
    if (!sel) return;
    setBusy(true);
    const d = await runScreening(sel.id, req || undefined);
    setBusy(false);
    if (d.ok && d.record) {
      setResult(d.record);
      MessagePlugin.success(d.message);
    } else {
      MessagePlugin.error(d.error || '二筛失败');
    }
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      {/* 待二筛列表 */}
      <div className="col-span-3 flex flex-col gap-4 min-h-0">
        <SectionCard title={`待二筛（${pending.length}）`} icon={<ScanSearch size={16} color="#7C3AED" />} className="flex-1 min-h-0">
          <div className="flex flex-col gap-1.5 overflow-auto h-full pr-1">
            {pending.length === 0 && <EmptyHint text="暂无待二筛候选人" />}
            {pending.map((c) => (
              <button
                key={c.id}
                onClick={() => selectCandidate(c)}
                className="text-left rounded-lg px-3 py-2 flex flex-col gap-0.5 transition-colors"
                style={{
                  backgroundColor: sel?.id === c.id ? 'rgba(124,58,237,0.08)' : 'transparent',
                  border: `1px solid ${sel?.id === c.id ? '#7C3AED' : 'var(--td-component-stroke)'}`,
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

      {/* 二筛工作台 */}
      <div className="col-span-5 flex flex-col gap-4 min-h-0">
        <SectionCard title="AI 二筛工作台" icon={<Sparkles size={16} color="#7C3AED" />} className="flex-1 min-h-0">
          {!sel ? (
            <EmptyHint text="从左侧选择一位待二筛候选人" />
          ) : (
            <div className="flex flex-col gap-3 overflow-auto h-full pr-1">
              <div className="text-sm">
                <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                  {sel.name}
                </span>
                <span className="ml-1 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  {sel.position} · 当前阶段：{stageLabel(sel.stage)}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                  用人部门需求（决定二筛标准）
                </span>
                <Textarea
                  value={req}
                  onChange={(v) => setReq(v as string)}
                  placeholder="输入用人部门对岗位的要求…"
                  autosize={{ minRows: 2, maxRows: 4 }}
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" icon={<Sparkles size={14} />} loading={busy} onClick={onGenerate}>
                  生成专业提示词
                </Button>
                <Button theme="primary" icon={<Play size={14} />} loading={busy} onClick={onRun}>
                  执行 AI 二筛
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

      {/* 二筛记录 */}
      <div className="col-span-4 flex flex-col gap-4 min-h-0">
        <SectionCard title="二筛记录" icon={<History size={16} color="#0052D9" />} className="flex-1 min-h-0">
          <div className="flex flex-col gap-2 overflow-auto h-full pr-1">
            {secondaryRecords.length === 0 && <EmptyHint text="暂无二筛记录，执行后将自动归档" />}
            {secondaryRecords.map((r) => (
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

function DecisionBadge({ decision, confidence }: { decision: string; confidence: number }) {
  const m = DECISION_META[decision] || DECISION_META.review;
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{ color: m.color, backgroundColor: m.bg }}
    >
      {confidence}% · {m.label}
    </span>
  );
}

function ResultPanel({ rec }: { rec: ScreenRecord }) {
  const m = DECISION_META[rec.decision] || DECISION_META.review;
  const Icon = rec.decision === 'pass' ? CheckCircle2 : rec.decision === 'reject' ? XCircle : AlertCircle;
  return (
    <div className="rounded-lg p-3 flex flex-col gap-2" style={{ backgroundColor: m.bg, border: `1px solid ${m.color}` }}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium" style={{ color: m.color }}>
          <Icon size={16} />
          {m.label}
        </span>
        <span className="text-lg font-semibold tabular-nums" style={{ color: m.color }}>
          {rec.confidence}%
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#fff' }}>
        <div className="h-full rounded-full" style={{ width: `${rec.confidence}%`, backgroundColor: m.color }} />
      </div>
      <div className="text-[11px]" style={{ color: 'var(--td-text-color-secondary)' }}>
        命中关键技能：<span className="text-green-700">{(rec.matched_skills || []).join('、') || '无'}</span>
      </div>
      <div className="text-[11px]" style={{ color: 'var(--td-text-color-secondary)' }}>
        {rec.note}
      </div>
    </div>
  );
}
