import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true
  },
  images: {
    unoptimized: true
  },
  serverExternalPackages: []
};

export default nextConfig;
