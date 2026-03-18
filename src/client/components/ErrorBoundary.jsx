import { Component } from 'react';
import { Shield, RefreshCw } from 'lucide-react';

/**
 * ErrorBoundary — global crash recovery for the React tree.
 *
 * When React throws during render, this catches it and shows a
 * full-screen recovery UI with a hard-reload button. Critical for
 * iOS PWA where there's no browser chrome (no URL bar / refresh).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  handleReload = async () => {
    // Clear service worker + caches for a clean slate
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch {
      // best-effort cleanup
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100dvh', padding: 24,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#1a1a2e', color: '#e5e7eb', textAlign: 'center',
        }}>
          <Shield size={48} style={{ color: '#f59e0b', marginBottom: 16 }} />
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p style={{ color: '#9ca3af', fontSize: 14, marginBottom: 24, maxWidth: 320 }}>
            The app encountered an error. Tap below to reload with a fresh start.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#2563eb', color: '#fff', border: 'none',
              borderRadius: 8, padding: '12px 24px', fontSize: 15,
              fontWeight: 600, cursor: 'pointer', marginBottom: 16,
            }}
          >
            <RefreshCw size={16} /> Reload App
          </button>
          {import.meta.env.DEV && this.state.error && (
            <pre style={{
              fontSize: 11, color: '#f87171', background: 'rgba(255,255,255,0.05)',
              borderRadius: 6, padding: 12, maxWidth: '90vw', overflow: 'auto',
              textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
