'use client'

import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0f0f0f] px-4">
          <div className="max-w-md w-full rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 text-center">
            <h2 className="text-xl font-semibold text-white">Something went wrong</h2>
            <p className="mt-2 text-sm text-gray-400">An unexpected error occurred while rendering this page.</p>
            <button
              onClick={this.handleRetry}
              className="mt-5 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
