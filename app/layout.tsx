import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DSB · Solar Boat Race",
  description: "Acompanhe os barcos solares na Lagoa de Imboassica, Macaé.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DSB · Solar Boat Race",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#edf0e4",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      {/* Extensões (ex.: ColorZilla injeta cz-shortcut-listen) alteram o <body> antes da hidratação. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
