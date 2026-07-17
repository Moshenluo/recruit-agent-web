import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Input, Tag, MessagePlugin } from 'tdesign-react';
import { FileUp, FileText, CheckCircle2, UserPlus } from 'lucide-react';
import type { Candidate, TencentDoc } from '../../hooks/useAutomation';
import { stageLabel } from '../../hooks/useAutomation';
import { SectionCard, EmptyHint, StageTag, fmtDateTime } from './shared';

interface Props {
  candidates: Candidate[];
  tencentDoc: TencentDoc | null;
  uploadResume: (payload: any) => Promise<any>;
}

export function TencentDocTab({ candidates, tencentDoc, uploadResume }: Props) {
  const [form, setForm] = useState({ name: '', position: '', source: 'HR收集', phone: '', email: '', tags: '' });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) {
      MessagePlugin.warning('请填写候选人姓名');
      return;
    }
    setBusy(true);
    const res = await uploadResume({
      name: form.name.trim(),
      position: form.position.trim() || undefined,
      source: form.source,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      tags: form.tags
        ? form.tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean)
        : undefined,
    });
    setBusy(false);
    if (res.ok) {
      MessagePlugin.success(res.message);
      setForm({ name: '', position: '', source: 'HR收集', phone: '', email: '', tags: '' });
    } else {
      MessagePlugin.error(res.error || '上传失败');
    }
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      {/* 左：HR 简历收集 */}
      <div className="col-span-4 flex flex-col gap-4 min-h-0">
        <SectionCard title="HR 简历收集" icon={<UserPlus size={16} color="#7C3AED" />}>
          <div className="flex flex-col gap-2.5">
            <Field label="候选人姓名 *">
              <Input value={form.name} onChange={(v) => set('name', v as string)} placeholder="如：张三" />
            </Field>
            <Field label="应聘岗位">
              <Input value={form.position} onChange={(v) => set('position', v as string)} placeholder="如：前端工程师" />
            </Field>
            <Field label="简历来源">
              <Input value={form.source} onChange={(v) => set('source', v as string)} placeholder="HR收集 / BOSS / 内推" />
            </Field>
            <Field label="联系电话">
              <Input value={form.phone} onChange={(v) => set('phone', v as string)} placeholder="选填" />
            </Field>
            <Field label="邮箱">
              <Input value={form.email} onChange={(v) => set('email', v as string)} placeholder="选填" />
            </Field>
            <Field label="技能标签（逗号分隔）">
              <Input value={form.tags} onChange={(v) => set('tags', v as string)} placeholder="如：React, TypeScript" />
            </Field>
            <Button theme="primary" icon={<FileUp size={16} />} loading={busy} onClick={submit} block>
              提交并汇总至腾讯文档
            </Button>
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--td-text-color-placeholder)' }}>
              HR 完成收集与上传后，Agent 会自动将简历聚合成统一格式、同步到腾讯文档《招聘简历库》，并继续推进招聘流程。
            </div>
          </div>
        </SectionCard>
      </div>

      {/* 右：腾讯文档（统一简历库） */}
      <div className="col-span-8 flex flex-col gap-4 min-h-0">
        <SectionCard
          title="腾讯文档 · 招聘简历库"
          icon={<FileText size={16} color="#F5A623" />}
          className="flex-1 min-h-0"
          extra={
            tencentDoc ? (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: '#07C160' }}>
                <CheckCircle2 size={14} />
                <span>已同步 · {fmtDateTime(tencentDoc.updated_at)}</span>
              </div>
            ) : undefined
          }
        >
          <div className="overflow-auto h-full pr-1">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ color: 'var(--td-text-color-secondary)' }} className="text-xs sticky top-0 bg-white">
                  <th className="text-left font-medium py-2 px-2">#</th>
                  <th className="text-left font-medium py-2 px-2">姓名</th>
                  <th className="text-left font-medium py-2 px-2">应聘岗位</th>
                  <th className="text-left font-medium py-2 px-2">来源</th>
                  <th className="text-left font-medium py-2 px-2">关键标签</th>
                  <th className="text-left font-medium py-2 px-2">当前阶段</th>
                  <th className="text-left font-medium py-2 px-2">收集时间</th>
                </tr>
              </thead>
              <tbody>
                {candidates.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <EmptyHint text="暂无简历，HR 提交后将自动汇总至此" />
                    </td>
                  </tr>
                )}
                {candidates.map((c, i) => (
                  <tr key={c.id} className="border-t" style={{ borderColor: 'var(--td-component-stroke)' }}>
                    <td className="py-2 px-2 tabular-nums" style={{ color: 'var(--td-text-color-placeholder)' }}>
                      {i + 1}
                    </td>
                    <td className="py-2 px-2 font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                      {c.name}
                    </td>
                    <td className="py-2 px-2" style={{ color: 'var(--td-text-color-secondary)' }}>
                      {c.position || '—'}
                    </td>
                    <td className="py-2 px-2">
                      <Tag size="small" variant="light">
                        {c.source || '—'}
                      </Tag>
                    </td>
                    <td className="py-2 px-2" style={{ color: 'var(--td-text-color-secondary)' }}>
                      {(c.tags || []).join('、') || '—'}
                    </td>
                    <td className="py-2 px-2">
                      <StageTag label={stageLabel(c.stage)} />
                    </td>
                    <td className="py-2 px-2 tabular-nums text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                      {fmtDateTime(c.created_at)}
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}
