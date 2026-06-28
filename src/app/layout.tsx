import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Subte Live · Buenos Aires en Tiempo Real",
  description:
    "Telemetría en vivo de la red de subterráneos de Buenos Aires: mapa interactivo, planificador de viaje, próximos arribos y alertas de servicio.",
};

export const viewport: Viewport = {
  themeColor: "#131313",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es-AR"
      className={`${inter.variable} ${jetbrains.variable} dark`}
      suppressHydrationWarning
    >
      <body
        className="min-h-screen bg-background text-on-background antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
