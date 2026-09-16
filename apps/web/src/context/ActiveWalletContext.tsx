'use client'

/**
 * Which wallet the trading screens should be talking about.
 *
 * Two custody models coexist: the server-held "platform" wallet that the bot can
 * sign with, and whatever browser wallet the user has connected. Every screen
 * used to assume the platform wallet, so connecting Phantom changed nothing on
 * the trading pages. This context resolves the active wallet per chain and lets
 * a page follow the connection the moment it changes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAccount } from 'wagmi'
import { useWallet } from '@solana/wallet-adapter-react'

export type WalletSource = 'platform' | 'browser'

// v2: earlier builds wrote 'browser' here whenever an extension auto-connected,
// so stored values from that era do not reflect a user choice and are ignored.
const STORAGE_KEY = 'active_wallet_source_v2'

type StoredPreference = { solana?: WalletSource; evm?: WalletSource }

type ActiveWalletValue = {
  solana: {
    /** Effective source after applying whether a browser wallet is actually connected. */
    source: WalletSource
    browserConnected: boolean
    browserAddress: string | null
    browserLabel: string | null
    /** User preference; may be 'browser' while nothing is connected. */
    preference: WalletSource
    setPreference: (source: WalletSource) => void
  }
  evm: {
    source: WalletSource
    browserConnected: boolean
    browserAddress: string | null
    browserLabel: string | null
    preference: WalletSource
    setPreference: (source: WalletSource) => void
  }
}

const ActiveWalletContext = createContext<ActiveWalletValue | null>(null)

function readPreference(): StoredPreference {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredPreference) : {}
  } catch {
    return {}
  }
}

function writePreference(next: StoredPreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* private mode — preference just won't persist */
  }
}

export function ActiveWalletProvider({ children }: { children: ReactNode }) {
  const { publicKey, connected: solConnected, wallet } = useWallet()
  const { address: evmAddress, isConnected: evmConnected, connector } = useAccount()

  const [solPreference, setSolPreferenceState] = useState<WalletSource>('platform')
  const [evmPreference, setEvmPreferenceState] = useState<WalletSource>('platform')

  useEffect(() => {
    const stored = readPreference()
    if (stored.solana) setSolPreferenceState(stored.solana)
    if (stored.evm) setEvmPreferenceState(stored.evm)
  }, [])

  const setSolPreference = useCallback((source: WalletSource) => {
    setSolPreferenceState(source)
    writePreference({ ...readPreference(), solana: source })
  }, [])

  const setEvmPreference = useCallback((source: WalletSource) => {
    setEvmPreferenceState(source)
    writePreference({ ...readPreference(), evm: source })
  }, [])

  // The trading screens only switch to a browser wallet when the user picks it
  // (the connect modal / wallet switcher call `setPreference('browser')`). A
  // connection appearing on its own is not treated as a choice: the wallet
  // adapter's autoConnect silently re-attaches any extension that exposes
  // Solana (MetaMask included), and routing trades to that account would drain
  // the wrong wallet or fail on an empty one while the user believes they are
  // trading from their personal wallet.
  //
  // If a browser wallet disconnects while it is the preferred source, fall back
  // to the platform wallet so the stored preference cannot point at nothing.
  const solWasConnected = useRef(solConnected)
  useEffect(() => {
    if (!solConnected && solWasConnected.current && solPreference === 'browser') {
      setSolPreference('platform')
    }
    solWasConnected.current = solConnected
  }, [solConnected, solPreference, setSolPreference])

  const evmWasConnected = useRef(evmConnected)
  useEffect(() => {
    if (!evmConnected && evmWasConnected.current && evmPreference === 'browser') {
      setEvmPreference('platform')
    }
    evmWasConnected.current = evmConnected
  }, [evmConnected, evmPreference, setEvmPreference])

  const value = useMemo<ActiveWalletValue>(() => {
    const browserSolAddress = publicKey?.toBase58() ?? null
    return {
      solana: {
        source: solConnected && solPreference === 'browser' ? 'browser' : 'platform',
        browserConnected: solConnected,
        browserAddress: browserSolAddress,
        browserLabel: wallet?.adapter.name ?? null,
        preference: solPreference,
        setPreference: setSolPreference,
      },
      evm: {
        source: evmConnected && evmPreference === 'browser' ? 'browser' : 'platform',
        browserConnected: evmConnected,
        browserAddress: evmAddress ?? null,
        browserLabel: connector?.name ?? null,
        preference: evmPreference,
        setPreference: setEvmPreference,
      },
    }
  }, [
    publicKey,
    solConnected,
    wallet,
    solPreference,
    setSolPreference,
    evmAddress,
    evmConnected,
    connector,
    evmPreference,
    setEvmPreference,
  ])

  return <ActiveWalletContext.Provider value={value}>{children}</ActiveWalletContext.Provider>
}

export function useActiveWallet(): ActiveWalletValue {
  const ctx = useContext(ActiveWalletContext)
  if (!ctx) throw new Error('useActiveWallet must be used inside ActiveWalletProvider')
  return ctx
}
