import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Enables forbidden()/unauthorized(), which is how /admin returns a real
    // HTTP 403 to a signed-in non-super-admin instead of a 200 that merely
    // looks like a refusal.
    authInterrupts: true,
    // Preview images may be 4 MB; leave room for multipart form metadata.
    // The default 1 MB rejects banners before the action can return an error.
    serverActions: { bodySizeLimit: '4.25mb' },
  },
  /* config options here */
};

export default nextConfig;
