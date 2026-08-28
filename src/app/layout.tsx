import type { Metadata } from "next";
import { Outfit, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Satrn.io | AI Portrait & 3D Avatar Video Studio",
  description: "A premium video recorder with customizable portrait dimensions and real-time 2D/3D cartoon animal filters using browser face landmark tracking.",
  keywords: ["video recorder", "portrait video", "avatar camera", "cartoon filters", "ready player me", "mediapipe", "threejs", "9:16 recorder"],
  authors: [{ name: "SpeakGarden" }],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className={`${outfit.variable} ${jakarta.variable}`}>
      <body>{children}</body>
    </html>
  );
}
