import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The retrieval index is read from disk at runtime, so it has to be traced
  // into the serverless bundle explicitly.
  outputFileTracingIncludes: {
    "/api/anden/**": ["./data/corpus/**"],
    "/anden": ["./data/corpus/**"],
  },
};

export default nextConfig;
