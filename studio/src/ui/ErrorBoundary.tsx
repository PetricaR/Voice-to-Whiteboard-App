/**
 * Keeps a rendering failure local: a chart that throws shows a message in its
 * own card, and a failure anywhere else shows a page that explains the saved
 * work is still in this browser, instead of a blank screen.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** What to show instead; `retry` renders the children again. */
  fallback: (error: Error, retry: () => void) => ReactNode;
  /** The boundary clears itself when this changes (e.g. the widget was edited). */
  resetKey?: unknown;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[studio] rendering failed', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error != null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private retry = () => this.setState({ error: null });

  render() {
    return this.state.error != null ? this.props.fallback(this.state.error, this.retry) : this.props.children;
  }
}

/** The page-level fallback: the work is saved after every change, so a reload is safe. */
export function AppCrashScreen({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className="crash-screen" role="alert">
      <h1>The studio hit an error</h1>
      <p>Your pages are saved in this browser after every change, so nothing is lost. Try again, or reload the page.</p>
      <pre>{error.message}</pre>
      <div className="crash-actions">
        <button type="button" className="filled-btn" onClick={retry}>Try again</button>
        <button type="button" className="text-btn" onClick={() => window.location.reload()}>Reload</button>
      </div>
    </div>
  );
}
