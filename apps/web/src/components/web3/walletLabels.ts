import type { Connector } from 'wagmi'

/** User-friendly labels for wagmi connectors (MetaMask, Trust via WC, Coinbase, …). */
export function getWalletConnectorPresentation(c: Connector): { title: string; subtitle: string } {
  const id = c.id.toLowerCase()
  const name = c.name.toLowerCase()

  if (id === 'metamask' || name.includes('metamask')) {
    return {
      title: 'MetaMask',
      subtitle: 'Extension, MetaMask Mobile',
    }
  }
  if (name.includes('trust') || id.includes('trust')) {
    return {
      title: 'Trust Wallet',
      subtitle: 'Extension (injected) — or use WalletConnect on mobile',
    }
  }
  if (id === 'walletconnect' || name.includes('walletconnect')) {
    return {
      title: 'WalletConnect',
      subtitle: 'Trust Wallet, Rainbow, OKX — scan QR or deep link',
    }
  }
  if (id.includes('coinbase') || name.includes('coinbase')) {
    return {
      title: 'Coinbase Wallet',
      subtitle: 'App & browser extension',
    }
  }
  if (id === 'injected' || name === 'injected') {
    return {
      title: 'Browser wallet',
      subtitle: 'Trust extension, Rabby, Brave, other injected wallets',
    }
  }

  return {
    title: c.name,
    subtitle: 'Ethereum wallet',
  }
}
