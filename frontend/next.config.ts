import type { NextConfig } from "next";

const backendUrl = (process.env.BACKEND_URL ?? "http://localhost:5001").replace(/\/$/, "");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["illusion-extinct-unripe.ngrok-free.dev"],
  async rewrites() {
    return [
      {
        source: "/backend-api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
