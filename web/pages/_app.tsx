import type { AppProps } from "next/app";
import React from "react";
import "../styles/globals.css";

interface ErrorState { hasError: boolean; message: string }

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(error: Error): ErrorState {
    return { hasError: true, message: error.message };
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-[#05050f] text-[#f1f0f7] flex flex-col items-center justify-center px-6 font-mono">
        <div className="rounded-2xl border border-[#ff3b5c44] bg-[#ff3b5c0a] px-8 py-8 max-w-lg w-full text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
              <path d="M7 1.5L12.5 11.5H1.5L7 1.5Z" stroke="#ff3b5c" strokeWidth="1.2" strokeLinejoin="round"/>
              <line x1="7" y1="5.5" x2="7" y2="8.5" stroke="#ff3b5c" strokeWidth="1.2" strokeLinecap="round"/>
              <circle cx="7" cy="10" r="0.7" fill="#ff3b5c"/>
            </svg>
            <span className="text-[#ff3b5c] font-bold text-sm uppercase tracking-wider">Something went wrong</span>
          </div>
          <p className="text-[#3a3a5a] text-xs leading-5 mb-6 break-all">{this.state.message}</p>
          <button
            onClick={() => { this.setState({ hasError: false, message: "" }); window.location.reload(); }}
            className="px-5 py-2.5 rounded-xl border border-[#ff3b5c44] text-[#ff3b5c] text-sm
                       hover:border-[#ff3b5c88] hover:bg-[#ff3b5c10] transition-all"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ErrorBoundary>
      <Component {...pageProps} />
    </ErrorBoundary>
  );
}
