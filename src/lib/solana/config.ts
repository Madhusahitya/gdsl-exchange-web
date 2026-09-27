/**
 * Solana RPC endpoint for browser-wallet reads (balances, transfer confirmation).
 *
 * Swaps and auto-trading still run server-side against the personal wallet —
 * this endpoint only serves what the connected browser wallet needs to display
 * and to sign its own transfers.
 */
const PUBLIC_MAINNET = 'https://api.mainnet-beta.solana.com'

export const solanaRpcEndpoint =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || PUBLIC_MAINNET

/** The public endpoint is heavily rate-limited — worth surfacing in the UI. */
export function isPublicSolanaRpc(): boolean {
  return solanaRpcEndpoint === PUBLIC_MAINNET
}

export const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

export function shortSolanaAddress(address?: string | null): string {
  if (!address) return ''
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}
