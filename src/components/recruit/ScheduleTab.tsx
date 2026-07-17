import { useMemo, useState } from 'react';
import { Button, Input, Tag, MessagePlugin } from 'tdesign-react';
import { CalendarClock, Users2, CalendarCheck, UserCheck } from 'lucide-react';
import type { Candidate, Interviewer, InterviewItem } from '../../hooks/useAutomation';
import { stageLabel } from '../../hooks/useAutomation';
import { SectionCard, EmptyHint, StageTag } from './shared';

interface Props {
  candidates: Candidate[];
  interviewers: Interviewer[];
  schedule: InterviewItem[];
  saveInterviewer: (payload: any) => Promise<any>;
  scheduleInterview: (id: string, type: 'group' | 'retest', interviewerId?: string) => Promise<any>;
}

const TYPE_LABEL: Record<string, string> = { group_interview: '群面', retest: '复试' };

export function ScheduleTab({ candidates, interviewers, schedule, saveInterviewer, scheduleInterview }: Props) {
  const toSchedule = useMemo(
    () => candidates.filter((c) => c.stage === 'interview_list' || c.stage === 'retest_list'),
    [candidates],
  );
  const [editSlots, setEditSlots] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const onSaveInterviewer = async (iv: Interviewer) => {
    const slots = (editSlots[iv.id] ?? iv.available_slots.join(', '))
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const d = await saveInterviewer({ id: iv.id, name: iv.name, dept: iv.dept, role: iv.role, available_slots: slots });
    if (d.interviewer) MessagePlugin.success('已更新可约时间');
    else MessagePlugin.error(d.error || '保存失败');
  };

  const onSchedule = async (c: Candidate) => {
    const type: 'group' | 'retest' = c.stage === 'interview_list' ? 'group' : 'retest';
    setBusy(c.id);
    const d = await scheduleInterview(c.id, type);
    setBusy(null);
    if (d.ok) MessagePlugin.success(d.message);
    else MessagePlugin.warning(d.message || d.error || '排期失败');
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      {/* 面试官时间表 */}
      <div className="col-span-4 flex flex-col gap-4 min-h-0">
        <SectionCard title="面试官可约时间表" icon={<Users2 size={16} color="#0052D9" />} className="flex-1 min-h-0">
          <div className="flex flex-col gap-3 overflow-auto h-full pr-1">
            {interviewers.length === 0 && <EmptyHint text="暂无面试官数据" />}
            {interviewers.map((iv) => (
              <div
                key={iv.id}
                className="rounded-lg p-2.5 flex flex-col gap-1.5"
                style={{ backgroundColor: 'var(--td-bg-color-component)', border: '1px solid var(--td-component-stroke)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                    {iv.name}
                    <span className="ml-1 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                      {iv.dept} · {iv.role}
                    </span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(iv.available_slots || []).map((s) => (
                    <Tag key={s} size="small" theme="primary" variant="light">
                      {s.slice(5)}
                    </Tag>
                  ))}
                </div>
                <Input
                  value={editSlots[iv.id] ?? iv.available_slots.join(', ')}
                  onChange={(v) => setEditSlots((m) => ({ ...m, [iv.id]: v as string }))}
                  placeholder="编辑可约时间，逗号分隔"
                  size="small"
                />
                <Button size="small" variant="outline" onClick={() => onSaveInterviewer(iv)}>
                  保存
                </Button>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* 待排期候选人 */}
      <div className="col-span-4 flex flex-col gap-4 min-h-0">
        <SectionCard title={`待排期（${toSchedule.length}）`} icon={<CalendarClock size={16} color="#F5A623" />} className="flex-1 min-h-0">
          <div className="flex flex-col gap-2 overflow-auto h-full pr-1">
            {toSchedule.length === 0 && <EmptyHint text="暂无待排期候选人" />}
            {toSchedule.map((c) => (
              <div
                key={c.id}
                className="rounded-lg p-2.5 flex flex-col gap-1.5"
                style={{ backgroundColor: 'var(--td-bg-color-component)', border: '1px solid var(--td-component-stroke)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                    {c.name}
                  </span>
                  <StageTag label={stageLabel(c.stage)} />
                </div>
                <div className="text-[11px]" style={{ color: 'var(--td-text-color-secondary)' }}>
                  求职者可约：
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(c.availability || []).map((s) => (
                      <Tag key={s} size="small" variant="light">
                        {s.slice(5)}
                      </Tag>
                    ))}
                  </div>
                </div>
                <Button
                  size="small"
                  theme="primary"
                  icon={<CalendarCheck size={14} />}
                  loading={busy === c.id}
                  onClick={() => onSchedule(c)}
                >
                  智能排期（{c.stage === 'interview_list' ? '群面' : '复试'}）
                </Button>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* 面试排期表 */}
      <div className="col-span-4 flex flex-col gap-4 min-h-0">
        <SectionCard title="面试排期表" icon={<UserCheck size={16} color="#07C160" />} className="flex-1 min-h-0">
          <div className="overflow-auto h-full pr-1">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs sticky top-0 bg-white" style={{ color: 'var(--td-text-color-secondary)' }}>
                  <th className="text-left font-medium py-2 px-1">候选人</th>
                  <th className="text-left font-medium py-2 px-1">类型</th>
                  <th className="text-left font-medium py-2 px-1">面试官</th>
                  <th className="text-left font-medium py-2 px-1">时间</th>
                </tr>
              </thead>
              <tbody>
                {schedule.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <EmptyHint text="暂无排期，点击「智能排期」生成" />
                    </td>
                  </tr>
                )}
                {schedule.map((it) => (
                  <tr key={it.id} className="border-t" style={{ borderColor: 'var(--td-component-stroke)' }}>
                    <td className="py-2 px-1 font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                      {it.candidate_name || '—'}
                    </td>
                    <td className="py-2 px-1">
                      <Tag size="small" variant="light">
                        {TYPE_LABEL[it.type] || it.type}
                      </Tag>
                    </td>
                    <td className="py-2 px-1 text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                      {(it.interviewers || []).join('、') || '—'}
                    </td>
                    <td className="py-2 px-1 text-xs tabular-nums" style={{ color: 'var(--td-text-color-secondary)' }}>
                      {it.scheduled_time ? it.scheduled_time.slice(5) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
