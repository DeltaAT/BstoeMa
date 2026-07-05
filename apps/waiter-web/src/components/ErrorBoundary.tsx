import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches any error thrown by a descendant and renders a friendly fallback.
 * Handles both ApiError (auth-context) and ApiClientError (@bstoema/api-client).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error.message, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <div className="error-fallback">
          <h2>Etwas ist schiefgelaufen</h2>
          <p className="error-message">{error.message}</p>
          <button onClick={() => this.setState({ error: null })}>
            Erneut versuchen
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
