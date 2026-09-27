import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "../lib/store-context";
import { AuthGate } from "../components/AuthGate";
import Nav from "../components/Nav";
import ThemeApplier from "../components/ThemeApplier";
import NotificationManager from "../components/NotificationManager";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hábitos - Seguimiento Diario",
  description: "Aplicación para crear, seguir y mantener buenos hábitos diarios.",
  // Fase 3 (PWA): enlaza el manifest y el icono instalable.
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#E8491D",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background">
        <AuthGate>
          <StoreProvider>
            <ThemeApplier />
            <NotificationManager />
            <div className="flex min-h-screen">
            <Nav />
            <main id="contenido" className="flex-1 min-w-0 md:ml-60 pb-24 md:pb-0">
              {children}
            </main>
            </div>
          </StoreProvider>
        </AuthGate>
      </body>
    </html>
  );
}
