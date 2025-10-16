import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true
  },
  output: 'standalone',
  trailingSlash: false,
  experimental: {
    serverComponentsExternalPackages: []
  }
};

export default nextConfig;
