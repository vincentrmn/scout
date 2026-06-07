import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BBInvest — atHome",
  description: "Recherche et scoring achat-revente",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
