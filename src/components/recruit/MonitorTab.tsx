import { Radio, Cpu } from 'lucide-react';
import type { RawEvent, AgentLog } from '../../hooks/useAutomation';
import { SectionCard, EmptyHint, SourceBadge, LOG_STYLE, fmtTime } from './shared';

interface Props {
  events: RawEvent[];
  logs: AgentLog[];
}

export function MonitorTab({ events, logs }: Props) {
  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <SectionCard
        title="实时事件流（采集层）"
        icon={<Radio size={16} color="#10AEFF" />}
        className="min-h-0"
        extra={
          <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
            企业微信 / 群 / BOSS / 腾讯文档
          </span>
        }
      >
        <div className="h-full overflow-auto pr-1 flex flex-col gap-2">
          {events.length === 0 && <EmptyHint text="等待数据源事件…" />}
          {events.map((ev) => (
            <div key={ev.id} className="flex gap-2 items-start text-xs">
              <SourceBadge source={ev.source} />
              <div className="flex-1 min-w-0">
                <div style={{ color: 'var(--td-text-color-primary)' }} className="break-words">
                  {ev.content}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  {ev.channel ? `${ev.channel} · ` : ''}
                  {fmtTime(ev.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Agent 自动化日志（执行层）" icon={<Cpu size={16} color="#0052D9" />} className="min-h-0">
        <div className="h-full overflow-auto pr-1 flex flex-col gap-2">
          {logs.length === 0 && <EmptyHint text="Agent 尚未执行动作" />}
          {logs.map((log) => {
            const style = LOG_STYLE[log.type] || LOG_STYLE.system;
            return (
              <div key={log.id} className="flex gap-2 items-start text-xs">
                <span className="mt-0.5 flex-shrink-0" style={{ color: style.color }}>
                  {style.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div style={{ color: 'var(--td-text-color-primary)' }} className="break-words">
                    {log.message}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    {fmtTime(log.created_at)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
