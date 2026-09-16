import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DexQuickTrade from './DexQuickTrade'
import { wagmiConfig } from '../../lib/wagmi/config'

// Mock environment variables
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

const renderWithProviders = (component: React.ReactElement) => {
  const testQueryClient = createTestQueryClient()
  return render(
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={testQueryClient}>
        {component}
      </QueryClientProvider>
    </WagmiProvider>
  )
}

describe('DexQuickTrade Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders the DEX trading interface', () => {
    renderWithProviders(<DexQuickTrade />)

    expect(screen.getByText('Quick DEX swap')).toBeInTheDocument()
    expect(screen.getByText('Buy on PancakeSwap when BNB ≤ target and sell when BNB ≥ target. Uses your wallet on BSC.')).toBeInTheDocument()
  })

  it('shows wallet picker when not connected', async () => {
    renderWithProviders(<DexQuickTrade />)

    await waitFor(() => {
      expect(screen.getByText(/WalletConnect|Browser wallet|Trust Wallet/i)).toBeInTheDocument()
    })
  })

  it('displays safety controls', () => {
    renderWithProviders(<DexQuickTrade />)

    expect(screen.getByText('Daily Trading Limits')).toBeInTheDocument()
    expect(screen.getByText('Safety Controls')).toBeInTheDocument()
    expect(screen.getByText('Emergency Stop')).toBeInTheDocument()
  })

  it('shows trading limits from environment variables', () => {
    renderWithProviders(<DexQuickTrade />)

    expect(screen.getByText('Trades: 0/10')).toBeInTheDocument()
    expect(screen.getByText(/Volume: \$0\.00\/500/)).toBeInTheDocument()
    expect(screen.getByText(/Max trade: \$100/)).toBeInTheDocument()
  })

  it('emergency stop button toggles state', async () => {
    renderWithProviders(<DexQuickTrade />)

    const emergencyButton = screen.getByText('Emergency Stop')
    fireEvent.click(emergencyButton)

    await waitFor(() => {
      expect(screen.getByText('Emergency Stop: ACTIVE')).toBeInTheDocument()
    })

    const deactivateButton = screen.getByText('Deactivate Stop')
    fireEvent.click(deactivateButton)

    await waitFor(() => {
      expect(screen.getByText('Emergency Stop: Inactive')).toBeInTheDocument()
    })
  })

  it('persists emergency stop state in localStorage', async () => {
    renderWithProviders(<DexQuickTrade />)

    const emergencyButton = screen.getByText('Emergency Stop')
    fireEvent.click(emergencyButton)

    await waitFor(
      () => {
        expect(localStorage.getItem('dex_emergency_stop')).toBe('1')
      },
      { timeout: 3000 },
    )

    const deactivateButton = screen.getByText('Deactivate Stop')
    fireEvent.click(deactivateButton)

    await waitFor(() => {
      expect(localStorage.getItem('dex_emergency_stop')).toBe('0')
    })
  })
})