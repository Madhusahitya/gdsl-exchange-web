import { getAddress, isAddress } from 'viem'

/**
 * Same rules as API: trim, optional 0x prefix, checksum for display/submit.
 */
export function tryNormalizeEvmAddress(input: string): string | null {
  const trimmed = input.trim().replace(/\s+/g, '')
  let candidate = trimmed
  if (/^[a-fA-F0-9]{40}$/i.test(trimmed) && !trimmed.toLowerCase().startsWith('0x')) {
    candidate = `0x${trimmed}`
  }
  if (!isAddress(candidate as `0x${string}`)) return null
  return getAddress(candidate as `0x${string}`)
}
