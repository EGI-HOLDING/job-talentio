import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    // Next 15 only serves qualities listed here. Hero images request 95.
    qualities: [75, 95],
    // Default "attachment" makes Chrome refuse to paint the optimized image.
    contentDispositionType: 'inline',
    localPatterns: [{ pathname: '/images/**' }, { pathname: '/icons/**' }],
  },
  // Google Identity Services needs postMessage across the GIS iframe/popup.
  // Default/isolation COOP (same-origin) blocks it and leaves sign-in stuck.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
