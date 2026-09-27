/**
 * Calls the Next.js route that forwards to Telegram Bot API.
 * Configure TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID on the server.
 * Optional: GDSL_ALERT_SECRET must match client header if set.
 */

export async function sendTelegramAlert(text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const secret = process.env.NEXT_PUBLIC_GDSL_ALERT_SECRET
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (secret) headers['x-gdsl-secret'] = secret

    const res = await fetch('/api/telegram', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: text.slice(0, 3500) }),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok) {
      return { ok: false, error: data.error ?? res.statusText }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network' }
  }
}
