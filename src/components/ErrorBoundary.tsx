import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/** Keeps a render failure in the collage from blanking the whole page; shows a
 *  quiet message instead. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Saezuri render error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <p className="mono" style={{ padding: '24px', color: 'var(--ink-soft)' }} data-error>
          Something went wrong rendering the collage: {this.state.error.message}
        </p>
      )
    }
    return this.props.children
  }
}
