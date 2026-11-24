import type { NextConfig } from "next";

// 화면만 맡는다. /api/* 는 03_web/server(Node API)로 넘긴다(같은 주소라 로그인 쿠키가 그대로 동작).
const API_ORIGIN = process.env.API_ORIGIN || "http://127.0.0.1:8781";

const nextConfig: NextConfig = {
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
