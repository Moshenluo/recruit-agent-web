import { DashboardPage } from './pages/DashboardPage';

/**
 * 招聘提效 Agent —— 应用入口
 * 形态：自动化控制中枢（看板），而非对话式 chatbot。
 * Agent 在后台自动监听数据源、采集录入、同步看板；HR 仅监控与处置异常。
 */
function App() {
  return <DashboardPage />;
}

export default App;
