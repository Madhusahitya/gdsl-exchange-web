/** Crypto Fear & Greed Index (0–100). https://alternative.me/crypto/fear-and-greed-index/ */

export async function fetchFearGreedIndex(): Promise<number | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1')
    if (!res.ok) return null
    const data = (await res.json()) as {
      data?: Array<{ value?: string }>
    }
    const v = data.data?.[0]?.value
    if (v === undefined) return null
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}
