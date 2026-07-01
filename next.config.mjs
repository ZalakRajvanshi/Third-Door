/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't let webpack bundle the JD parsers — pdfjs-dist (inside pdf-parse) breaks when
  // bundled ("Object.defineProperty called on non-object"). Require them natively at runtime.
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth"],
  },
};
export default nextConfig;
