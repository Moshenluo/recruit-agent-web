import { useState, useEffect } from 'react';
import { Input, Tag } from 'tdesign-react';
import { FolderOpenIcon } from 'tdesign-icons-react';
import { Bot, Workflow, FileText, CalendarClock, BarChart3, ArrowRight, Zap } from 'lucide-react';
import { APP_CONFIG, RECRUIT_STAGES } from '../config';
import { Model, Agent, PermissionMode } from '../types';
import { ICON_MAP } from '../utils/iconMap';

interface NewChatViewProps {
  agents: Agent[];
  models: Model[];
  selectedModel: string;
  newChatAgentId: string;
  newChatCwd: string;
  newChatPermissionMode: PermissionMode;
  onSelectModel: (modelId: string) => void;
  onSelectAgent: (agentId: string) => void;
  onSetCwd: (cwd: string) => void;
  onSetPermissionMode: (mode: PermissionMode) => void;
}

// 快捷提示语
const QUICK_PROMPTS = [
  { icon: 'FileText', text: '录入新候选人：张三，Java开发，5年经验，BOSS直聘来源', color: '#00a870' },
  { icon: 'ListChecks', text: '查看当前各阶段候选人数量统计', color: '#0052d9' },
  { icon: 'CalendarClock', text: '安排明天下午的群面，面试官：李总监、王经理', color: '#ed7b2f' },
  { icon: 'BarChart3', text: '生成本月招聘漏斗报表', color: '#8b5cf6' },
];

export function NewChatView({
  agents,
  newChatAgentId,
  newChatCwd,
  onSelectAgent,
  onSetCwd,
  onSetPermissionMode,
}: NewChatViewProps) {
  const [stats, setStats] = useState<{ totalCandidates: number; totalInterviews: number } | null>(null);
  const selectedAgent = agents.find(a => a.id === newChatAgentId);

  // 获取统计数据
  useEffect(() => {
    fetch('/api/pipeline-stats')
      .then(res => res.json())
      .then(data => {
        if (data.stats) {
          setStats({
            totalCandidates: data.stats.totalCandidates || 0,
            totalInterviews: data.stats.totalInterviews || 0,
          });
        }
      })
      .catch(() => {
        // 静默失败
      });
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full overflow-y-auto py-8">
      <div className="w-full max-w-4xl px-6">
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center mb-4 shadow-xl mx-auto"
            style={{
              background: 'linear-gradient(135deg, #0052d9, #266fe8)',
            }}
          >
            <span className="text-4xl font-bold text-white">{APP_CONFIG.nameInitial}</span>
          </div>
          <h2
            className="text-3xl font-bold mb-2"
            style={{ color: 'var(--td-text-color-primary)' }}
          >
            {APP_CONFIG.name}
          </h2>
          <p style={{ color: 'var(--td-text-color-secondary)' }} className="text-sm">
            {APP_CONFIG.description}
          </p>
        </div>

        {/* 数据概览 */}
        {stats && (
          <div className="flex justify-center gap-4 mb-8">
            <div
              className="px-6 py-3 rounded-xl text-center"
              style={{ backgroundColor: 'var(--td-bg-color-component)' }}
            >
              <div className="text-2xl font-bold" style={{ color: 'var(--td-brand-color)' }}>
                {stats.totalCandidates}
              </div>
              <div className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                候选人总数
              </div>
            </div>
            <div
              className="px-6 py-3 rounded-xl text-center"
              style={{ backgroundColor: 'var(--td-bg-color-component)' }}
            >
              <div className="text-2xl font-bold" style={{ color: '#ed7b2f' }}>
                {stats.totalInterviews}
              </div>
              <div className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                面试记录
              </div>
            </div>
          </div>
        )}

        {/* 招聘流程可视化 */}
        <div
          className="mb-8 p-5 rounded-2xl"
          style={{ backgroundColor: 'var(--td-bg-color-component)' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Workflow size={18} color="var(--td-brand-color)" />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
              招聘全流程（11 阶段）
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {RECRUIT_STAGES.map((stage, index) => {
              const Icon = ICON_MAP[stage.icon] || FileText;
              return (
                <div key={stage.key} className="flex items-center">
                  <div
                    className="flex flex-col items-center px-3 py-2 rounded-lg"
                    style={{ backgroundColor: 'var(--td-bg-color-page)' }}
                    title={stage.desc}
                  >
                    <Icon size={16} color="var(--td-brand-color)" />
                    <span
                      className="text-xs mt-1 whitespace-nowrap"
                      style={{ color: 'var(--td-text-color-secondary)' }}
                    >
                      {stage.label}
                    </span>
                  </div>
                  {index < RECRUIT_STAGES.length - 1 && (
                    <ArrowRight size={12} color="var(--td-text-color-placeholder)" className="mx-0.5" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Agent 选择 */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-3" style={{ color: 'var(--td-text-color-primary)' }}>
            选择 AI 助手
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {agents.map(agent => {
              const AgentIcon = ICON_MAP[agent.icon || 'Bot'] || Bot;
              const isSelected = agent.id === newChatAgentId;
              return (
                <div
                  key={agent.id}
                  className="p-4 rounded-xl cursor-pointer transition-all border-2"
                  style={{
                    borderColor: isSelected ? (agent.color || 'var(--td-brand-color)') : 'transparent',
                    backgroundColor: isSelected ? 'var(--td-brand-color-light)' : 'var(--td-bg-color-component)',
                  }}
                  onClick={() => {
                    onSelectAgent(agent.id);
                    if (agent.permissionMode) {
                      onSetPermissionMode(agent.permissionMode);
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: agent.color || '#0052d9' }}
                    >
                      <AgentIcon size={20} color="white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                          {agent.name}
                        </span>
                        {isSelected && (
                          <Tag size="small" theme="primary" variant="light">
                            已选择
                          </Tag>
                        )}
                      </div>
                      {agent.description && (
                        <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                          {agent.description}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 工作目录 */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--td-text-color-primary)' }}>
            工作目录 <span style={{ color: 'var(--td-text-color-placeholder)' }}>(可选 - 用于存储招聘数据文件)</span>
          </label>
          <Input
            value={newChatCwd}
            onChange={(v) => onSetCwd(v as string)}
            placeholder="例如：/data/recruitment"
            prefixIcon={<FolderOpenIcon />}
          />
          <p className="text-xs mt-1.5" style={{ color: 'var(--td-text-color-placeholder)' }}>
            Agent 将在此目录维护 candidates.json、interviews.json 等招聘数据文件
          </p>
        </div>

        {/* 快捷提示 */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={16} color="var(--td-warning-color)" />
            <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
              快捷操作
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {QUICK_PROMPTS.map((prompt, i) => {
              const Icon = ICON_MAP[prompt.icon] || FileText;
              return (
                <div
                  key={i}
                  className="flex items-center gap-2.5 p-3 rounded-lg cursor-pointer transition-colors"
                  style={{
                    backgroundColor: 'var(--td-bg-color-component)',
                    border: '1px solid var(--td-component-border)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--td-bg-color-component-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--td-bg-color-component)';
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: prompt.color + '15' }}
                  >
                    <Icon size={14} color={prompt.color} />
                  </div>
                  <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                    {prompt.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 选中的 Agent 预览 */}
        {selectedAgent && (
          <div
            className="p-4 rounded-xl mb-4"
            style={{ backgroundColor: 'var(--td-bg-color-component)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              {(() => {
                const Icon = ICON_MAP[selectedAgent.icon || 'Bot'] || Bot;
                return (
                  <>
                    <div
                      className="w-6 h-6 rounded-md flex items-center justify-center"
                      style={{ backgroundColor: selectedAgent.color || '#0052d9' }}
                    >
                      <Icon size={14} color="white" />
                    </div>
                    <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                      {selectedAgent.name}
                    </span>
                  </>
                );
              })()}
            </div>
            <p className="text-xs line-clamp-3" style={{ color: 'var(--td-text-color-secondary)' }}>
              {selectedAgent.systemPrompt.slice(0, 200)}...
            </p>
          </div>
        )}

        {/* 提示文字 */}
        <p className="text-center text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
          在下方输入框输入消息开始对话，AI 助手将自动记录和管理招聘数据
        </p>
      </div>
    </div>
  );
}
