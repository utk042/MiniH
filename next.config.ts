import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // Off, not on: several redirects carry a genuinely dynamic "return to this
  // page" path (requireProfile's returnTo, the sign-in "next" param), and
  // typed routes wants those as literal unions, not runtime strings.
  typedRoutes: false,
};

export default nextConfig;
