import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Renovation Fit | Engineering verification",
  description: "Deterministic millimetre-based product fit verification for real rooms.",
  icons: {
    icon: [{ url: "/planner-build-icon.png", type: "image/png" }],
    apple: [{ url: "/planner-build-icon.png", type: "image/png" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
