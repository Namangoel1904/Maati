import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const configuredBackend = process.env.MAATI_BACKEND_URL || "http://127.0.0.1:3000";
const backendOrigin = configuredBackend.startsWith("http") ? configuredBackend : `http://${configuredBackend}`;

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Keep image posts intact while they pass through the Next rewrite.
    proxyClientMaxBodySize: '12mb',
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
  turbopack: {
    root: projectRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
