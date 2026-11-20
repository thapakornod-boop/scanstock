import type { Metadata, Viewport } from "next";
import { Prompt } from "next/font/google";
import "./globals.css";

const prompt = Prompt({
  variable: "--font-prompt",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "เช็คสต็อกพาเลท | RSM Group",
  description: "ระบบเช็คสต็อกพาเลทสินค้า RSM Group — สแกนบาร์โค้ด นับทุกชิ้น แยกล็อตและวันหมดอายุ ส่งสรุปเข้า LINE",
  icons: {
    icon: "https://i.postimg.cc/RVy6cmjv/RSM-group-logo-outline-1.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${prompt.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
