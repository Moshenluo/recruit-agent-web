/**
 * 应用配置文件
 * 统一管理应用名称和其他全局配置
 */

export const APP_CONFIG = {
  /** 应用名称 */
  name: '智聘通',

  /** 应用名称首字母（用于 Logo） */
  nameInitial: '聘',

  /** 应用描述 */
  description: 'AI 驱动的招聘流程自动化助手 — 数据自动记录 · 实时同步 · 可视化看板',

  /** 版本号 */
  version: '1.0.0',
};

/** 招聘流程阶段定义 */
export const RECRUIT_STAGES = [
  { key: 'resume_collection', label: '简历收集', icon: 'FileText', desc: 'BOSS 收集简历 + HR 人工收集' },
  { key: 'initial_screening', label: 'AI 初筛', icon: 'Filter', desc: 'Agent 对简历进行 AI 初筛（首轮筛选）' },
  { key: 'group_creation', label: '拉群协作', icon: 'Users', desc: 'HR 与用人部门企业微信拉群' },
  { key: 'secondary_screening', label: '部门二筛', icon: 'CheckSquare', desc: '用人部门对简历进行二筛' },
  { key: 'interview_list', label: '群面名单', icon: 'ListChecks', desc: 'HR 确认群面面试名单' },
  { key: 'interview_schedule', label: '群面安排', icon: 'CalendarClock', desc: '沟通确定群面面试时间' },
  { key: 'interview_result', label: '群面结果', icon: 'ClipboardCheck', desc: '汇总群面面试结果' },
  { key: 'result_notification', label: '结果通知', icon: 'Bell', desc: '通知候选人面试结果' },
  { key: 'retest_list', label: '复试名单', icon: 'Repeat', desc: '汇总需要复试的候选人' },
  { key: 'retest_schedule', label: '复试安排', icon: 'CalendarClock', desc: '沟通确定复面面试时间' },
  { key: 'retest_result', label: '复试结果', icon: 'ClipboardCheck', desc: '汇总复面面试结果' },
] as const;

export default APP_CONFIG;
