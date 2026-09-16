const webpack = require('webpack')

/**
 * Public URL: use ngrok from repo root — `npm run tunnel:web` (with `npm run dev:web` running).
 * `--host-header=rewrite` keeps Next dev CSS/JS loading; ngrok v3 may warn it is deprecated but it still works.
 */
const apiInternal = process.env.API_INTERNAL_ORIGIN || 'http://127.0.0.1:8000'

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@cryptoflow/dex-pancake'],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      '@radix-ui/react-dialog',
      '@radix-ui/react-label',
      '@radix-ui/react-slot',
    ],
  },
  /** One public URL (e.g. single ngrok): browser calls same origin; dev server forwards to API. */
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiInternal}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${apiInternal}/socket.io/:path*` },
    ]
  },
  webpack: (config, { isServer, dev }) => {
    // @metamask/sdk pulls RN async-storage in browser builds; not used on web
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^@react-native-async-storage\/async-storage$/,
      })
    )
    // Windows dev compiles ~10k modules on first load; default chunk timeout is too short.
    if (dev && !isServer && config.output) {
      config.output.chunkLoadTimeout = 300_000
    }
    return config
  },
}

module.exports = nextConfig
