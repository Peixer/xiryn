import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Server action arguments can contain API keys; keep them out of the terminal
  logging: { serverFunctions: false },
  // Xiryn ships its own contributor guide; don't let `next dev` write one
  agentRules: false,
  // Native or Node-only packages that must not be bundled
  serverExternalPackages: [
    "better-sqlite3",
    "ws",
    "web-push",
    "@aws-sdk/client-bedrock",
    "@aws-sdk/credential-providers",
  ],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ]
  },
}

export default nextConfig
