import { Tag } from 'tdesign-react';
import { Inbox, Zap, CircleDot, Bot, Cpu, AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const SOURCE_COLOR: Record<string, string> = {
  BOSS直聘: '#0052D9',
  企业微信: '#07C160',
  企业微信群: '#10AEFF',
  腾讯文档: '#F5A623',
  HR收集: '#7C3AED',
};

export const LOG_STYLE: Record<string, { icon: JSX.Element; color: string }> = {
  create: { icon: <Inbox size={14} />, color: '#07C160' },
  advance: { icon: <Zap size={14} />, color: '#0052D9' },
  result: { icon: <CircleDot size={14} />, color: '#0052D9' },
  intervention: { icon: <Bot size={14} />, color: '#F5A623' },
  ignore: { icon: <CircleDot size={14} />, color: '#999' },
  system: { icon: <Cpu size={14} />, color: '#7C3AED' },
  screen: { icon: <Bot size={14} />, color: '#7C3AED' },
  schedule: { icon: <Zap size={14} />, color: '#F5A623' },
};

export const ANOMALY_COLOR: Record<string, { color: string; bg: string; border: string }> = {
  slow_advance: { color: '#E34D59', bg: 'rgba(227,77,89,0.06)', border: 'rgba(227,77,89,0.2)' },
  slow_recognition: { color: '#ED7B2F', bg: 'rgba(237,123,47,0.06)', border: 'rgba(237,123,47,0.2)' },
  data_missing: { color: '#D9A400', bg: 'rgba(217,164,0,0.08)', border: 'rgba(217,164,0,0.25)' },
};

export const DECISION_META: Record<string, { label: string; color: string; bg: string }> = {
  pass: { label: '直接过', color: '#07C160', bg: 'rgba(7,193,96,0.1)' },
  review: { label: '人工审核', color: '#ED7B2F', bg: 'rgba(237,123,47,0.1)' },
  reject: { label: '淘汰', color: '#E34D59', bg: 'rgba(227,77,89,0.1)' },
};

export function KpiCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: JSX.Element;
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div
      className="rounded-xl p-3.5 flex flex-col gap-1.5 flex-1 min-w-0"
      style={{ backgroundColor: '#fff', border: '1px solid var(--td-component-stroke)' }}
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
          {label}
        </span>
      </div>
      <div className="text-2xl font-semibold tabular-nums" style={{ color: accent || 'var(--td-text-color-primary)' }}>
        {value}
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  icon,
  extra,
  children,
  className,
}: {
  title: string;
  icon?: JSX.Element;
  extra?: JSX.Element;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl flex flex-col ${className || ''}`}
      style={{ backgroundColor: '#fff', border: '1px solid var(--td-component-stroke)' }}
    >
      <div
        className="flex items-center justify-between px-4 h-12 flex-shrink-0 border-b"
        style={{ borderColor: 'var(--td-component-stroke)' }}
      >
        <div className="flex items-center gap-2 font-medium text-sm" style={{ color: 'var(--td-text-color-primary)' }}>
          {icon}
          {title}
        </div>
        {extra}
      </div>
      <div className="p-4 flex-1 min-h-0">{children}</div>
    </div>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const color = SOURCE_COLOR[source] || '#666';
  return (
    <span
      className="px-1.5 py-0.5 rounded text-white flex-shrink-0"
      style={{ backgroundColor: color, fontSize: 10 }}
    >
      {source}
    </span>
  );
}

export function EmptyHint({ text }: { text: string }) {
  return (
    <div className="text-xs py-8 text-center" style={{ color: 'var(--td-text-color-placeholder)' }}>
      {text}
    </div>
  );
}

export function StageTag({ label }: { label: string }) {
  return (
    <Tag size="small" variant="light" style={{ borderColor: 'var(--td-component-stroke)' }}>
      {label}
    </Tag>
  );
}
