/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable React Strict Mode to prevent double-invocation of useEffect in
  // development, which causes duplicate API calls and Next.js link prefetches
  // to flood the terminal.  Strict Mode adds no value in production builds.
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  // @react-pdf/renderer must run in the Node.js runtime, not the Edge runtime.
  // Marking it as an external server component package prevents Next.js from
  // bundling it with the client and avoids canvas/worker import errors.
  serverExternalPackages: ['@react-pdf/renderer'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'fecy.co.ke',
        pathname: '/**',
      },
    ],
  },
}

export default nextConfig
