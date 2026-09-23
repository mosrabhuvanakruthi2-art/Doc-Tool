import { Component } from 'react';
import { reportClientError } from '../reportClientError';

// Catches render-time crashes in the tree below it, keeps the app from going
// blank, reports the error to the Errors tab, and offers a way back.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: (error && error.message) || 'Something went wrong' };
  }

  componentDidCatch(error, info) {
    reportClientError({
      category: 'frontend',
      message: (error && error.message) || 'React render error',
      stack: (error && error.stack) || '',
      context: { componentStack: (info && info.componentStack || '').slice(0, 2000) },
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="app-error-fallback">
        <h2>Something went wrong</h2>
        <p>The page hit an unexpected error. It has been logged for the team.</p>
        <p className="app-error-msg">{this.state.message}</p>
        <div className="app-error-actions">
          <button className="btn-save" onClick={() => window.location.reload()}>Reload page</button>
          <button className="btn-cancel" onClick={() => { this.setState({ hasError: false, message: '' }); }}>Try again</button>
        </div>
      </div>
    );
  }
}
