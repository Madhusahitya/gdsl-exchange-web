import type { Connector } from 'wagmi'

/** Live chain id from the wallet EIP-1193 provider (source of truth for signing). */
async function chainIdFromRequestProvider(provider: unknown): Promise<number | null> {
  if (!provider || typeof provider !== 'object') return null
  const req = (provider as { request?: (args: { method: string }) => Promise<unknown> }).request
  if (typeof req !== 'function') return null
  try {
    const hex = await req({ method: 'eth_chainId' })
    if (typeof hex !== 'string') return null
    const id = Number.parseInt(hex, 16)
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}

/** Prefer active wagmi connector; fall back to `window.ethereum` when connectors disagree with MetaMask’s overlay (multi-wallet injection). */
export async function readConnectorChainId(connector: Connector | undefined): Promise<number | null> {
  if (connector?.getProvider) {
    try {
      const provider = await connector.getProvider()
      const id = await chainIdFromRequestProvider(provider)
      if (id !== null) return id
    } catch {
      /* continue */
    }
  }
  if (typeof window === 'undefined') return null
  const eth = (window as Window & { ethereum?: unknown }).ethereum
  return chainIdFromRequestProvider(eth)
}

export async function waitForConnectorChain(
  connector: Connector | undefined,
  chainId: number,
  opts?: { timeoutMs?: number; pollMs?: number },
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 12_000
  const pollMs = opts?.pollMs ?? 200
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const current = await readConnectorChainId(connector)
    if (current === chainId) return true
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return (await readConnectorChainId(connector)) === chainId
}
