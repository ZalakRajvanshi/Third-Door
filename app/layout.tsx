import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { ShortlistProvider } from "@/lib/store";
import { TopNav } from "@/components/TopNav";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "Third Door — find the right people, just by describing them",
  description: "Describe who you're looking for in plain words. Meet a shortlist of great people, with a clear reason each one fits.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <div className="grain" aria-hidden />
        <ShortlistProvider>
          <TopNav />
          {children}
        </ShortlistProvider>
      </body>
    </html>
  );
}
