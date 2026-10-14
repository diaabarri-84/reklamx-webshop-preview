import React from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Catches a render error instead of letting it blank the page.
 *
 * React unmounts the entire tree when a render throws anywhere and nothing
 * catches it. Without this, one bad value in one component — a product with a
 * missing field, a malformed order — left the customer looking at a white screen
 * with no explanation and no way back.
 *
 * Deliberately a class: this is the one thing hooks cannot do.
 */
type Props = { children: React.ReactNode; fallbackLabel?: string };

/** The import of a page's code failed (Chrome, Firefox and Safari word it differently). */
const isStaleChunk = (error: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(String((error as Error)?.message ?? error));
type State = { error: Error | null };

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Kept in the console rather than shown: a stack trace tells a customer
    // nothing and can leak internals. Replace with a reporting service later.
    console.error('Unhandled render error:', error, info.componentStack);

    // A PAGE WHOSE CODE FILE IS GONE. Every page but the home page is loaded on
    // demand (React.lazy), from a file named after the build. After a deploy — or
    // a restart of the dev server — a tab that was already open asks for the OLD
    // file and the import fails, which landed here as "something went wrong" on
    // /about (2026-10-14). A reload fetches the current files; once per page per
    // minute, so a page that is truly broken shows this box instead of looping.
    if (isStaleChunk(error)) {
      const key = `rx-chunk-reload:${window.location.pathname}`;
      let last = 0;
      try { last = Number(sessionStorage.getItem(key)) || 0; } catch { /* storage blocked */ }
      if (Date.now() - last > 60_000) {
        try { sessionStorage.setItem(key, String(Date.now())); } catch { /* storage blocked */ }
        window.location.reload();
      }
    }
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-20">
        <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-5 text-2xl">
          !
        </div>
        <h1 className="text-2xl font-black text-gray-900 mb-2">Something went wrong on this page</h1>
        <p className="text-gray-500 max-w-md mb-8 leading-relaxed">
          The rest of the shop is fine. Try again, or go back to the home page — your basket has not been lost.
        </p>
        {/* Local development only: what broke, so it can be fixed. A production build drops this. */}
        {import.meta.env.DEV && (
          <pre className="max-w-2xl mb-8 whitespace-pre-wrap break-words rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-left text-xs text-red-700">
            {String(this.state.error?.message || this.state.error)}
          </pre>
        )}
        <div className="flex flex-wrap gap-3 justify-center">
          <button
            onClick={this.reset}
            className="px-6 py-3 bg-gray-900 text-white font-black rounded-2xl hover:bg-orange-600 transition-colors"
          >
            Try again
          </button>
          <a
            href="/"
            className="px-6 py-3 bg-gray-100 text-gray-900 font-black rounded-2xl hover:bg-gray-200 transition-colors"
          >
            Back to the shop
          </a>
        </div>
      </div>
    );
  }
}

/**
 * What actually gets mounted.
 *
 * A class boundary has no way of knowing the user navigated, so once it had
 * caught anything it went on rendering the error screen for the rest of the
 * session: every link in the navbar changed the URL and appeared to do nothing.
 * Keying it on the path throws the crashed boundary away and mounts a fresh one
 * the moment the route changes, which is the reset React does not give us.
 */
export default function RouteErrorBoundary(props: Props) {
  const location = useLocation();
  return <ErrorBoundary key={location.pathname} {...props} />;
}
