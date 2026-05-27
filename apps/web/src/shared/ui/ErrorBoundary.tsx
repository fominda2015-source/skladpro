import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crash:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="loginShell">
          <div className="card" style={{ maxWidth: 520 }}>
            <h2 style={{ marginTop: 0 }}>Ошибка интерфейса</h2>
            <p className="muted">Приложение не смогло отрисоваться. Попробуйте обновить страницу.</p>
            <pre
              style={{
                fontSize: 12,
                overflow: "auto",
                padding: 12,
                background: "#fef2f2",
                borderRadius: 8,
                color: "#991b1b"
              }}
            >
              {this.state.error.message}
            </pre>
            <button type="button" onClick={() => window.location.reload()}>
              Обновить страницу
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
