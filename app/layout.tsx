import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: {
    default: "RepoDrop — vos archives de code sur GitHub",
    template: "%s · RepoDrop",
  },
  description:
    "Importez un .rar ou un .zip de code directement sur GitHub : connectez-vous, déposez l'archive, pushez. Sans terminal, sans clone.",
};

export const viewport: Viewport = {
  themeColor: "#0a0d14",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="min-h-screen">
        <Header />
        {children}
      </body>
    </html>
  );
}
