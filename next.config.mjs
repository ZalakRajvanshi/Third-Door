/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the JD parsers out of the webpack bundle. mammoth (DOCX) must be external.
  // unpdf (PDF) ships its own serverless pdfjs build and works either way; listing it is safe.
  experimental: {
    serverComponentsExternalPackages: ["unpdf", "mammoth"],
  },
};
export default nextConfig;
