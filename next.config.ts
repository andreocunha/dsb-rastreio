import type { NextConfig } from "next";

// Spectators read the live stream straight from dsb-server (CORS). Proxied by a function on this
// host, every open map kept that function running for as long as it was watched.
const liveServer = process.env.NODE_ENV === 'production' ? process.env.DSB_SERVER_URL : undefined;
const liveStream = liveServer ? new URL('/api/tracker/stream', liveServer).href : '/api/tracker/stream';

const nextConfig: NextConfig = {
  devIndicators: false,
  env: { LIVE_STREAM_URL: liveStream },
  async headers() {
    return [{
      source: '/:file(sw.js|offline-manifest.js)',
      headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
    }];
  },
  async redirects() {
    // Pages from an earlier build still ask this host for the stream: send them to the server too.
    return liveServer ? [{ source: '/api/tracker/stream', destination: liveStream, permanent: false }] : [];
  },
};

export default nextConfig;
