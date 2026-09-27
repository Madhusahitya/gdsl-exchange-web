import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { AppProviders } from '@/components/AppProviders'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'koie.fin',
  description:
    'Non-custodial BSC trading terminal. Signals, risk gates, PancakeSwap execution. Not financial advice.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#030705' }],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${mono.variable}`}>
      <body className="font-sans bg-[#030705] text-white antialiased [font-family:var(--font-sans),system-ui,sans-serif]">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
