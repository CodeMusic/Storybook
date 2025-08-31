/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
  
    // Enable static export for Apache
    output: 'export',
  
    // Needed if you use <Image/> with export
    images: {
      unoptimized: true,
      remotePatterns: [
        { protocol: 'https', hostname: '**' }
      ]
    },
  
    // Optional but helps with static hosting
    trailingSlash: true
  };
  
  module.exports = nextConfig;