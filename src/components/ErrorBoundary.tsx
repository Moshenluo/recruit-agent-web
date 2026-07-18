import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

// 全局错误边界：避免单个标签页运行时报错导致整页白屏（提升部署后的稳定性）
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[智聘通] 渲染错误被边界捕获：', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' });
    try {
      window.location.reload();
    } catch {
      /* ignore */
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f3f3', padding: 24 }}>
          <div style={{ maxWidth: 480, background: '#fff', borderRadius: 12, padding: 28, boxShadow: '0 6px 24px rgba(0,0,0,0.08)' }}>
            <h2 style={{ margin: '0 0 8px', color: '#d54941', fontSize: 18 }}>页面渲染出现异常</h2>
            <p style={{ color: '#555', fontSize: 14, lineHeight: 1.6, wordBreak: 'break-all' }}>
              {this.state.message || '未知错误'}
            </p>
            <button
              onClick={this.handleReset}
              style={{ marginTop: 16, background: '#0052d9', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 18px', fontSize: 14, cursor: 'pointer' }}
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
