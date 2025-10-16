import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true
  },
  output: 'export',
  trailingSlash: true,
  basePath: '/timeboxing-app',
  assetPrefix: '/timeboxing-app',
  images: {
    unoptimized: true
  },
  serverExternalPackages: []
};

export default nextConfig;
