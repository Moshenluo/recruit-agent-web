import { useState } from 'react';
import { Button } from 'tdesign-react';
import { Bot, LayoutDashboard, FileText, ScanSearch, CalendarClock, Activity, Pause, Play, RotateCcw, Filter } from 'lucide-react';
import { useAutomation } from '../hooks/useAutomation';
import { APP_CONFIG } from '../config';
import { OverviewTab } from '../components/recruit/OverviewTab';
import { TencentDocTab } from '../components/recruit/TencentDocTab';
import { InitialScreeningTab } from '../components/recruit/InitialScreeningTab';
import { AiScreeningTab } from '../components/recruit/AiScreeningTab';
import { ScheduleTab } from '../components/recruit/ScheduleTab';
import { MonitorTab } from '../components/recruit/MonitorTab';

type TabKey = 'overview' | 'doc' | 'initial' | 'screen' | 'schedule' | 'monitor';

const TABS: Array<{ key: TabKey; label: string; icon: JSX.Element }> = [
  { key: 'overview', label: '总览看板', icon: <LayoutDashboard size={16} /> },
  { key: 'doc', label: '腾讯文档', icon: <FileText size={16} /> },
  { key: 'initial', label: 'AI 初筛', icon: <Filter size={16} /> },
  { key: 'screen', label: 'AI 二筛', icon: <ScanSearch size={16} /> },
  { key: 'schedule', label: '约面排期', icon: <CalendarClock size={16} /> },
  { key: 'monitor', label: '实时监控', icon: <Activity size={16} /> },
];

export function DashboardPage() {
  const a = useAutomation();
  const [tab, setTab] = useState<TabKey>('overview');

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
      {/* 顶部栏 */}
      <header
        className="flex items-center justify-between px-5 h-14 flex-shrink-0 border-b"
        style={{ backgroundColor: '#fff', borderColor: 'var(--td-component-stroke)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#0052D9,#10AEFF)' }}
          >
            <Bot size={18} color="white" />
          </div>
          <div>
            <div className="text-base font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
              {APP_CONFIG.name} · 招聘提效 Agent
            </div>
            <div className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              HR 收集上传 → Agent 聚合腾讯文档 → AI 初筛 → AI 二筛 → 约面 / 复试排期，全程自动化
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: a.connected ? '#07C160' : '#E34D59' }} />
            <span style={{ color: 'var(--td-text-color-secondary)' }}>
              {a.connected ? '已连接' : '断开'} · {a.running ? '运行中' : '已暂停'}
            </span>
          </div>
          {a.running ? (
            <Button size="small" variant="outline" icon={<Pause size={14} />} onClick={() => a.control('stop')}>
              暂停
            </Button>
          ) : (
            <Button size="small" theme="primary" icon={<Play size={14} />} onClick={() => a.control('start')}>
              启动
            </Button>
          )}
          <Button size="small" variant="outline" icon={<RotateCcw size={14} />} onClick={() => a.control('reset')}>
            重置演示
          </Button>
        </div>
      </header>

      {/* Tab 导航 */}
      <nav
        className="flex items-center gap-1 px-4 h-12 flex-shrink-0 border-b"
        style={{ backgroundColor: '#fff', borderColor: 'var(--td-component-stroke)' }}
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 px-3.5 h-8 rounded-lg text-sm transition-colors"
              style={{
                backgroundColor: active ? 'rgba(0,82,217,0.08)' : 'transparent',
                color: active ? '#0052D9' : 'var(--td-text-color-secondary)',
                fontWeight: active ? 600 : 400,
              }}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
        <div className="ml-auto text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
          共 {a.stats?.totalCandidates ?? 0} 位候选人 · 异常 {a.anomalies.length}
        </div>
      </nav>

      {/* 主体 */}
      <main className="flex-1 overflow-hidden p-4">
        {tab === 'overview' && (
          <OverviewTab
            stats={a.stats}
            anomalies={a.anomalies}
            candidates={a.candidates}
            running={a.running}
            control={a.control}
            intervene={a.intervene}
          />
        )}
        {tab === 'doc' && (
          <TencentDocTab candidates={a.candidates} tencentDoc={a.tencentDoc} uploadResume={a.uploadResume} />
        )}
        {tab === 'initial' && (
          <InitialScreeningTab
            candidates={a.candidates}
            screenings={a.screenings}
            generatePrompt={a.generateInitialPrompt}
            runScreening={a.runInitialScreening}
          />
        )}
        {tab === 'screen' && (
          <AiScreeningTab
            candidates={a.candidates}
            screenings={a.screenings}
            generatePrompt={a.generatePrompt}
            runScreening={a.runScreening}
          />
        )}
        {tab === 'schedule' && (
          <ScheduleTab
            candidates={a.candidates}
            interviewers={a.interviewers}
            schedule={a.schedule}
            saveInterviewer={a.saveInterviewer}
            scheduleInterview={a.scheduleInterview}
          />
        )}
        {tab === 'monitor' && <MonitorTab events={a.events} logs={a.logs} />}
      </main>
    </div>
  );
}

export default DashboardPage;
