import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  const serverSecret = process.env.GDSL_ALERT_SECRET

  if (serverSecret) {
    const sent = req.headers.get('x-gdsl-secret')
    if (sent !== serverSecret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
    }
  }

  if (!token || !chatId) {
    return NextResponse.json(
      { ok: false, error: 'not_configured', message: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the server.' },
      { status: 503 },
    )
  }

  let body: { text?: string }
  try {
    body = (await req.json()) as { text?: string }
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const text = String(body.text ?? '').trim()
  if (!text) {
    return NextResponse.json({ ok: false, error: 'text_required' }, { status: 400 })
  }

  const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      disable_web_page_preview: true,
    }),
  })

  const payload = (await tg.json().catch(() => ({}))) as { ok?: boolean; description?: string }
  if (!tg.ok || !payload.ok) {
    return NextResponse.json(
      { ok: false, error: 'telegram_error', detail: payload.description ?? tg.statusText },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
