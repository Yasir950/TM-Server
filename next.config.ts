import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The home page moved from /home to /; the app itself is at /app
  async redirects() {
    return [{ source: "/home", destination: "/", permanent: true }];
  },
  // The call's own window (Huddle.tsx openCallWindow) shows /call rather than /call.html
  async rewrites() {
    return [{ source: "/call", destination: "/call.html" }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
