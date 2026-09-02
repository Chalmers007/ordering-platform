import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Enables forbidden()/unauthorized(), which is how /admin returns a real
    // HTTP 403 to a signed-in non-super-admin instead of a 200 that merely
    // looks like a refusal.
    authInterrupts: true,
  },
  /* config options here */
};

export default nextConfig;
