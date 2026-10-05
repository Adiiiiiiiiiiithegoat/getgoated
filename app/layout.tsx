import type { Metadata } from "next";
import Link from "next/link";
import { Barlow_Condensed, Inter } from "next/font/google";
import { quotaToday } from "@/lib/db";
import "./globals.css";

const display = Barlow_Condensed({ variable: "--font-display", subsets: ["latin"], weight: ["600", "800"], style: ["normal", "italic"] });
const body = Inter({ variable: "--font-body", subsets: ["latin"] });

export const metadata: Metadata = { title: "GetGoated", description: "Staged skill paths with verified video demos" };
export const dynamic = "force-dynamic"; // everything reads the local DB

export default function RootLayout({ children }: LayoutProps<"/">) {
  const units = quotaToday();
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="mx-auto w-full max-w-3xl px-4 pt-5">
          <Link href="/" className="font-display text-2xl font-extrabold italic tracking-tight uppercase">
            Get<span className="text-volt">Goated</span>
          </Link>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
        <footer className="mx-auto w-full max-w-3xl px-4 py-4 text-xs text-muted">
          YouTube quota today: <span className={units > 9000 ? "text-red-400" : ""}>{units.toLocaleString()}</span> / 10,000 units
        </footer>
      </body>
    </html>
  );
}
