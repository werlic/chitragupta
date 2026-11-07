/** @type {import('next').NextConfig} */
const nextConfig = {
  // Socket.io needs custom server, so we disable default runtime
  experimental: {
    serverComponentsExternalPackages: ['socket.io'],
  },
};

module.exports = nextConfig;
