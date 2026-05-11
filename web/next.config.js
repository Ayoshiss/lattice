/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // rpc-websockets (dep of @solana/web3.js) ships a .cjs file that tries to
  // require() a nested uuid package whose dist-node/index.js is ESM-only.
  // Next.js leaves node_modules external for server routes, so Node loads them
  // natively and throws ERR_REQUIRE_ESM at runtime.  Adding rpc-websockets to
  // transpilePackages forces webpack to bundle it, resolving the ESM boundary.
  transpilePackages: ["rpc-websockets"],
  webpack: (config, { isServer }) => {
    // fs/net/tls polyfill stubs are only needed for the client-side bundle
    if (!isServer) {
      config.resolve.fallback = { fs: false, net: false, tls: false };
    }
    return config;
  },
};
module.exports = nextConfig;
