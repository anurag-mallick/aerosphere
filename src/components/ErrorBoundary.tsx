import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Keeps one broken panel from white-screening the whole editor. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AeroSphere] UI crash:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="main-content">
          <div className="error-boundary">
            <h2>😵 Something went wrong</h2>
            <p className="small">{this.state.error.message}</p>
            <p className="empty-hint">
              Your project is still saved in this session — reloading restores it.
            </p>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload AeroSphere
            </button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}
