import { useState } from 'react';
import { Button, Input, Tag } from 'tdesign-react';
import { Users, Activity, AlertTriangle, Bot, Send, Filter } from 'lucide-react';
import type { Stats, Anomaly, Candidate } from '../../hooks/useAutomation';
import { stageLabel } from '../../hooks/useAutomation';
import {
  KpiCard,
  SectionCard,
  EmptyHint,
  StageTag,
  ANOMALY_COLOR,
} from './shared';

interface Props {
  stats: Stats | null;
  anomalies: Anomaly[];
  candidates: Candidate[];
  running: boolean;
  control: (a: 'start' | 'stop' | 'reset') => void;
  intervene: (cmd: string) => Promise<any>;
}

export function OverviewTab({ stats, anomalies, candidates, running, control, intervene }: Props) {
  const [cmd, setCmd] = useState('');
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null);

  const total = stats?.totalCandidates ?? 0;
  const finished = stats?.stages.find((s) => s.key === 'retest_result')?.count ?? 0;
  const inProgress = total - finished;
  const maxStage = Math.max(1, ...(stats?.stages.map((s) => s.count) ?? [1]));

  const handleIntervene = async () => {
    if (!cmd.trim()) return;
    const res = await intervene(cmd.trim());
    setFb({ ok: !!res.ok, msg: res.message || (res.ok ? '已执行' : '失败') });
    setCmd('');
    setTimeout(() => setFb(null), 4000);
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      {/* 左列：KPI + 漏斗 */}
      <div className="col-span-7 flex flex-col gap-4 min-h-0">
        <div className="flex gap-3">
          <KpiCard icon={<Users size={18} color="#0052D9" />} label="总候选人" value={total} />
          <KpiCard icon={<Activity size={18} color="#07C160" />} label="进行中" value={inProgress} accent="#07C160" />
          <KpiCard
            icon={<AlertTriangle size={18} color={anomalies.length ? '#E34D59' : '#999'} />}
            label="异常"
            value={anomalies.length}
            accent={anomalies.length ? '#E34D59' : undefined}
          />
          <KpiCard icon={<Bot size={18} color="#7C3AED" />} label="已完成" value={finished} accent="#7C3AED" />
        </div>

        <SectionCard
          title="招聘漏斗（实时）"
          icon={<Filter size={16} color="#0052D9" />}
          className="flex-1 min-h-0"
          extra={
            running ? (
              <Button size="small" variant="outline" onClick={() => control('stop')}>
                暂停 Agent
              </Button>
            ) : (
              <Button size="small" theme="primary" onClick={() => control('start')}>
                启动 Agent
              </Button>
            )
          }
        >
          <div className="flex flex-col gap-2 overflow-auto h-full pr-1">
            {stats?.stages.map((s) => (
              <div key={s.key}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--td-text-color-secondary)' }}>{s.label}</span>
                  <span className="font-medium tabular-nums" style={{ color: 'var(--td-text-color-primary)' }}>
                    {s.count}
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(s.count / maxStage) * 100}%`,
                      background: 'linear-gradient(90deg,#0052D9,#10AEFF)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* 右列：异常 + 干预 + 速览 */}
      <div className="col-span-5 flex flex-col gap-4 min-h-0">
        <SectionCard
          title="异常"
          icon={<AlertTriangle size={16} color={anomalies.length ? '#E34D59' : '#999'} />}
          extra={anomalies.length > 0 ? <Tag size="small" theme="danger">{anomalies.length}</Tag> : undefined}
          className="flex-1 min-h-0"
        >
          <div className="flex flex-col gap-2 overflow-auto h-full pr-1">
            {anomalies.length === 0 && <EmptyHint text="暂无异常，流程运转正常 ✓" />}
            {anomalies.map((a) => {
              const c = ANOMALY_COLOR[a.type] || ANOMALY_COLOR.data_missing;
              return (
                <div
                  key={a.id}
                  className="rounded-lg p-2.5 flex flex-col gap-1"
                  style={{ backgroundColor: c.bg, border: `1px solid ${c.border}` }}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium" style={{ color: c.color }}>
                      {a.name} · {a.stageLabel}
                    </span>
                    <Tag size="small" style={{ color: c.color, backgroundColor: 'transparent', borderColor: c.border }}>
                      {a.typeLabel}
                    </Tag>
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--td-text-color-secondary)' }}>
                    {a.hint}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="轻量干预（HR 兜底）">
          <div className="flex flex-col gap-2">
            <div className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              示例：「把 张伟 推进复试」「驳回 李娜」
            </div>
            <div className="flex gap-2">
              <Input
                value={cmd}
                onChange={(v) => setCmd(v as string)}
                onEnter={handleIntervene}
                placeholder="输入干预指令…"
                className="flex-1"
              />
              <Button theme="primary" icon={<Send size={14} />} onClick={handleIntervene}>
                执行
              </Button>
            </div>
            {fb && (
              <div
                className="text-xs px-2 py-1 rounded"
                style={{
                  color: fb.ok ? '#07C160' : '#E34D59',
                  backgroundColor: fb.ok ? 'rgba(7,193,96,0.08)' : 'rgba(227,77,89,0.08)',
                }}
              >
                {fb.ok ? '✓ ' : '✗ '}
                {fb.msg}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="候选人速览" className="flex-1 min-h-0">
          <div className="flex flex-col gap-1.5 overflow-auto h-full pr-1">
            {candidates.slice(0, 10).map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                  {c.name}
                  <span className="ml-1 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    {c.position || '—'}
                  </span>
                </span>
                <StageTag label={stageLabel(c.stage)} />
              </div>
            ))}
            {candidates.length === 0 && <EmptyHint text="暂无候选人" />}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
