import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  // Linux containers use standalone; local Windows builds run with next start.
  output: process.platform === 'win32' ? undefined : 'standalone',
};

export default nextConfig;
