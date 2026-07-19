import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Input, Tag, MessagePlugin, Dialog } from 'tdesign-react';
import { FileUp, FileText, CheckCircle2, UserPlus, FolderOpen, FilePlus2, Pencil, Trash2 } from 'lucide-react';
import type { Candidate, TencentDoc } from '../../hooks/useAutomation';
import { stageLabel } from '../../hooks/useAutomation';
import { SectionCard, EmptyHint, StageTag, fmtDateTime } from './shared';

interface Props {
  candidates: Candidate[];
  tencentDoc: TencentDoc | null;
  uploadResume: (payload: any) => Promise<any>;
  updateCandidate: (id: string, patch: any) => Promise<any>;
  deleteCandidate: (id: string) => Promise<any>;
}

// 用于从简历正文中猜测技能标签（命中即作为初筛/二筛参考）
const SKILL_KEYWORDS = [
  'React', 'TypeScript', 'Vue', 'Node', 'Java', 'Spring', 'Go', 'Python', 'SQL',
  'Figma', '产品', '运营', 'HR', '算法', '测试', '微服务', '分布式', 'NLP', '深度学习', '数据分析', '前端', '后端',
];

// 从 PDF 文本提取（浏览器侧，CDN 动态加载 pdf.js，无需本地安装依赖）
async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.text')) {
    return await file.text();
  }
  if (name.endsWith('.pdf')) {
    try {
      const base = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/';
      // @ts-ignore - 运行时从 CDN 加载，构建期忽略
      const pdfjs: any = await import(/* @vite-ignore */ base + 'pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.mjs';
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      let text = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((it: any) => it.str || '').join(' ') + '\n';
      }
      return text;
    } catch (e: any) {
      throw new Error('PDF 解析失败（需联网加载解析库）：' + (e?.message || e));
    }
  }
  throw new Error('暂仅支持 .txt / .md / .pdf，其他格式请手动填写');
}

function guessTags(text: string): string[] {
  const t = text || '';
  return SKILL_KEYWORDS.filter((k) => t.includes(k)).slice(0, 8);
}

function guessName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 20) || '未命名';
}

interface ParsedFile {
  file: File;
  name: string;
  tags: string[];
  text: string;
  error?: string;
}

export function TencentDocTab({ candidates, tencentDoc, uploadResume, updateCandidate, deleteCandidate }: Props) {
  const [form, setForm] = useState({ name: '', position: '', source: 'HR收集', phone: '', email: '', tags: '', education: '', school: '' });
  const [busy, setBusy] = useState(false);

  // 拖拽 / 文件夹导入
  const [dragOver, setDragOver] = useState(false);
  const [parsed, setParsed] = useState<ParsedFile[]>([]);
  const [busyBatch, setBusyBatch] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  // 手动编辑 / 删除简历记录
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', position: '', source: 'HR收集', phone: '', email: '', education: '', school: '', tags: '' });
  const [editBusy, setEditBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [delName, setDelName] = useState('');

  const openEdit = (c: Candidate) => {
    setEditId(c.id);
    setEditForm({
      name: c.name,
      position: c.position || '',
      source: c.source || 'HR收集',
      phone: c.phone || '',
      email: c.email || '',
      education: c.education || '',
      school: c.school || '',
      tags: (c.tags || []).join('、'),
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editId) return;
    if (!editForm.name.trim()) {
      MessagePlugin.warning('姓名不能为空');
      return;
    }
    setEditBusy(true);
    const res = await updateCandidate(editId, {
      name: editForm.name.trim(),
      position: editForm.position.trim() || undefined,
      source: editForm.source.trim() || undefined,
      phone: editForm.phone.trim() || undefined,
      email: editForm.email.trim() || undefined,
      education: editForm.education.trim() || undefined,
      school: editForm.school.trim() || undefined,
      tags: editForm.tags ? editForm.tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean) : [],
    });
    setEditBusy(false);
    if (res?.ok) {
      MessagePlugin.success(res.message || '已保存');
      setEditOpen(false);
    } else {
      MessagePlugin.error(res?.error || res?.message || '保存失败');
    }
  };

  const openDelete = (c: Candidate) => {
    setDelId(c.id);
    setDelName(c.name);
    setDelOpen(true);
  };

  const confirmDelete = async () => {
    if (!delId) return;
    const res = await deleteCandidate(delId);
    setDelOpen(false);
    if (res?.ok) MessagePlugin.success(res.message || '已删除');
    else MessagePlugin.error(res?.error || res?.message || '删除失败');
    setDelId(null);
  };

  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '');
    folderRef.current?.setAttribute('directory', '');
  }, []);

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
      education: form.education.trim() || undefined,
      school: form.school.trim() || undefined,
      tags: form.tags
        ? form.tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean)
        : undefined,
    });
    setBusy(false);
    if (res.ok) {
      MessagePlugin.success(res.message);
      setForm({ name: '', position: '', source: 'HR收集', phone: '', email: '', tags: '', education: '', school: '' });
    } else {
      MessagePlugin.error(res.error || '上传失败');
    }
  };

  const parseFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => !f.name.startsWith('.'));
    const results = await Promise.all(
      files.map(async (file): Promise<ParsedFile> => {
        try {
          const text = await extractText(file);
          return { file, name: guessName(file.name), tags: guessTags(text), text };
        } catch (e: any) {
          return { file, name: guessName(file.name), tags: [], text: '', error: e?.message || String(e) };
        }
      }),
    );
    setParsed((prev) => [...prev, ...results]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) parseFiles(e.dataTransfer.files);
  };

  const removeParsed = (idx: number) => setParsed((prev) => prev.filter((_, i) => i !== idx));

  const batchUpload = async () => {
    const ok = parsed.filter((p) => !p.error);
    if (ok.length === 0) {
      MessagePlugin.warning('没有可提交的简历');
      return;
    }
    setBusyBatch(true);
    let success = 0;
    await Promise.all(
      ok.map((p) =>
        uploadResume({
          name: p.name,
          source: '文件夹/拖拽导入',
          tags: p.tags,
        }).then((r: any) => {
          if (r.ok) success++;
        }),
      ),
    );
    setBusyBatch(false);
    MessagePlugin.success(`已汇总 ${success} 份简历至腾讯文档`);
    setParsed([]);
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      {/* 左：采集入口 */}
      <div className="col-span-4 flex flex-col gap-4 min-h-0 overflow-auto pr-1">
        {/* 拖拽 / 文件夹导入 */}
        <SectionCard title="简历拖拽 / 文件夹导入" icon={<FilePlus2 size={16} color="#0052D9" />}>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className="rounded-xl border-2 border-dashed p-4 flex flex-col items-center gap-2 text-center transition-colors"
            style={{
              borderColor: dragOver ? '#0052D9' : 'var(--td-component-stroke)',
              backgroundColor: dragOver ? 'rgba(0,82,217,0.05)' : 'transparent',
            }}
          >
            <FileUp size={22} color="#0052D9" />
            <div className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
              把简历文件拖到这里，或选择文件 / 整个文件夹
            </div>
            <div className="flex gap-2">
              <Button size="small" variant="outline" icon={<FileText size={14} />} onClick={() => filesRef.current?.click()}>
                选择文件
              </Button>
              <Button size="small" variant="outline" icon={<FolderOpen size={14} />} onClick={() => folderRef.current?.click()}>
                选择文件夹
              </Button>
            </div>
            <div className="text-[10px]" style={{ color: 'var(--td-text-color-placeholder)' }}>
              支持 .txt / .md / .pdf（PDF 解析需联网加载解析库）
            </div>
            <input ref={filesRef} type="file" multiple accept=".txt,.md,.pdf" style={{ display: 'none' }} onChange={(e) => e.target.files && parseFiles(e.target.files)} />
            <input ref={folderRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && parseFiles(e.target.files)} />
          </div>

          {parsed.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {parsed.map((p, i) => (
                <div
                  key={i}
                  className="rounded-lg p-2 flex flex-col gap-1"
                  style={{ backgroundColor: 'var(--td-bg-color-component)', border: `1px solid ${p.error ? 'rgba(227,77,89,0.3)' : 'var(--td-component-stroke)'}` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>{p.name}</span>
                    <button className="text-xs" style={{ color: '#E34D59' }} onClick={() => removeParsed(i)}>移除</button>
                  </div>
                  {p.error ? (
                    <span className="text-[11px]" style={{ color: '#E34D59' }}>{p.error}</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {p.tags.length ? p.tags.map((t) => <Tag key={t} size="small" theme="success" variant="light">{t}</Tag>) : <span className="text-[11px]" style={{ color: 'var(--td-text-color-placeholder)' }}>未识别到技能标签</span>}
                    </div>
                  )}
                </div>
              ))}
              <Button theme="primary" icon={<UserPlus size={14} />} loading={busyBatch} onClick={batchUpload}>
                批量汇总至腾讯文档（{parsed.filter((p) => !p.error).length} 份）
              </Button>
            </div>
          )}
        </SectionCard>

        {/* 手动录入 */}
        <SectionCard title="HR 简历收集（手动）" icon={<UserPlus size={16} color="#7C3AED" />}>
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
            <Field label="学历（初筛硬闸口 · 本科及以上）">
              <Input value={form.education} onChange={(v) => set('education', v as string)} placeholder="如：本科 / 硕士 / 博士" />
            </Field>
            <Field label="院校（初筛硬闸口 · 985/211/双一流/海外名校）">
              <Input value={form.school} onChange={(v) => set('school', v as string)} placeholder="如：985 / 211 / 双一流 / 海外名校" />
            </Field>
            <Field label="技能标签（逗号分隔）">
              <Input value={form.tags} onChange={(v) => set('tags', v as string)} placeholder="如：React, TypeScript" />
            </Field>
            <Button theme="primary" icon={<FileUp size={16} />} loading={busy} onClick={submit} block>
              提交并汇总至腾讯文档
            </Button>
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
                  <th className="text-left font-medium py-2 px-2">学历/院校</th>
                  <th className="text-left font-medium py-2 px-2">关键标签</th>
                  <th className="text-left font-medium py-2 px-2">当前阶段</th>
                  <th className="text-left font-medium py-2 px-2">收集时间</th>
                  <th className="text-left font-medium py-2 px-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {candidates.length === 0 && (
                  <tr>
                    <td colSpan={8}>
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
                    <td className="py-2 px-2 text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                      {c.education || '—'} · {c.school || '—'}
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
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1">
                        <button
                          className="inline-flex items-center gap-0.5 text-xs px-1.5 py-1 rounded transition-colors"
                          style={{ color: '#0052D9' }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(0,82,217,0.08)')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          onClick={() => openEdit(c)}
                        >
                          <Pencil size={13} /> 编辑
                        </button>
                        <button
                          className="inline-flex items-center gap-0.5 text-xs px-1.5 py-1 rounded transition-colors"
                          style={{ color: '#E34D59' }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(227,77,89,0.08)')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          onClick={() => openDelete(c)}
                        >
                          <Trash2 size={13} /> 删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* 编辑弹窗：手动修改 / 修复简历记录 */}
      <Dialog
        header="编辑候选人信息"
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        onConfirm={saveEdit}
        confirmBtn={{ content: '保存', loading: editBusy }}
        cancelBtn="取消"
      >
        <div className="flex flex-col gap-2.5">
          <Field label="候选人姓名 *">
            <Input value={editForm.name} onChange={(v) => setEditForm((f) => ({ ...f, name: v as string }))} placeholder="如：张三" />
          </Field>
          <Field label="应聘岗位">
            <Input value={editForm.position} onChange={(v) => setEditForm((f) => ({ ...f, position: v as string }))} placeholder="如：前端工程师" />
          </Field>
          <Field label="简历来源">
            <Input value={editForm.source} onChange={(v) => setEditForm((f) => ({ ...f, source: v as string }))} placeholder="HR收集 / BOSS / 内推" />
          </Field>
          <Field label="联系电话">
            <Input value={editForm.phone} onChange={(v) => setEditForm((f) => ({ ...f, phone: v as string }))} placeholder="选填" />
          </Field>
          <Field label="邮箱">
            <Input value={editForm.email} onChange={(v) => setEditForm((f) => ({ ...f, email: v as string }))} placeholder="选填" />
          </Field>
          <Field label="学历（初筛硬闸口 · 本科及以上）">
            <Input value={editForm.education} onChange={(v) => setEditForm((f) => ({ ...f, education: v as string }))} placeholder="如：本科 / 硕士 / 博士" />
          </Field>
          <Field label="院校（初筛硬闸口 · 985/211/双一流/海外名校）">
            <Input value={editForm.school} onChange={(v) => setEditForm((f) => ({ ...f, school: v as string }))} placeholder="如：985 / 211 / 双一流 / 海外名校" />
          </Field>
          <Field label="技能标签（顿号 / 逗号分隔）">
            <Input value={editForm.tags} onChange={(v) => setEditForm((f) => ({ ...f, tags: v as string }))} placeholder="如：React、TypeScript" />
          </Field>
        </div>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog
        header="确认删除"
        visible={delOpen}
        onClose={() => setDelOpen(false)}
        onConfirm={confirmDelete}
        confirmBtn={{ content: '删除', theme: 'danger' }}
        cancelBtn="取消"
      >
        <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
          确认删除候选人「{delName}」？删除后该简历将从简历库中移除，此操作不可恢复。
        </div>
      </Dialog>
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
