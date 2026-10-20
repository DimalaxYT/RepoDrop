import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: {
    default: "RepoDrop — vos archives de code sur GitHub",
    template: "%s · RepoDrop",
  },
  description:
    "Importez un .rar, un .zip ou un .tar de code directement sur GitHub : connectez-vous, déposez l'archive, pushez. Sans terminal, sans clone.",
};

export const viewport: Viewport = {
  themeColor: "#080b12",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="flex min-h-screen flex-col">
        {/* Grain global : casse les aplats des dégradés. */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 noise-layer" />
        <Header />
        <div className="flex flex-1 flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
