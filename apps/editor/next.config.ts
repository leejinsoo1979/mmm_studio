import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Self-contained server bundle (`.next/standalone`) — the desktop app
  // (apps/desktop) embeds it and runs the editor locally inside Electron.
  // Harmless on Vercel, which uses its own output handling.
  output: 'standalone',
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  logging: {
    browserToTerminal: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  transpilePackages: [
    'three',
    '@pascal-app/viewer',
    '@pascal-app/core',
    '@pascal-app/editor',
    '@pascal-app/plugin-trees',
    '@dgreenheck/ez-tree',
  ],
  serverExternalPackages: ['@pascal-app/mcp'],
  turbopack: {
    root: new URL('../..', import.meta.url).pathname,
    resolveAlias: {
      react: './node_modules/react',
      three: './node_modules/three',
      '@react-three/fiber': './node_modules/@react-three/fiber',
      '@react-three/drei': './node_modules/@react-three/drei',
    },
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  images: {
    unoptimized: process.env.NEXT_PUBLIC_ASSETS_CDN_URL?.startsWith('http://localhost') ?? false,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
}

export default nextConfig
