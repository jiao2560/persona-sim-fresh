import { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // … your existing config …

  eslint: {
    // Allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
