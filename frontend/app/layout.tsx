import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./ui-theme.css";
import "./mobile.css";
import "./privacy.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.freefloorplan3d.com"),
  title: "Free 2D & 3D Floorplan Creator | FreeFloorplan3D",
  robots: { index: true, follow: true },
  description: "Draw a free floorplan in 2D, review it in 3D, and export PDF, PNG or JPG views. Save an editable project in your browser. No account required.",
  alternates: { canonical: "/planner/" },
  openGraph: { title: "Create a free floorplan in 2D & 3D", description: "Open the planner, draw your space and download your design. No sign-up. No payment.", url: "/planner/", siteName: "FreeFloorplan3D", type: "website", images: [{ url: "/assets/social-floorplan.png", width: 1200, height: 630, alt: "FreeFloorplan3D — free 2D and 3D floorplans, no sign-up" }] },
  twitter: { card: "summary_large_image", title: "Create a free floorplan in 2D & 3D", images: ["/assets/social-floorplan.png"] },
  icons: {
    icon: [{ url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/planner-build-icon.png`, type: "image/png" }],
    apple: [{ url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/planner-build-icon.png`, type: "image/png" }],
  },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<noscript><div style={{ padding: 24 }}><h2>Free floorplan creator in 2D and 3D</h2><p>Enable JavaScript to draw your floorplan, explore in 3D and download it for free. No registration or payment required.</p><a href="https://www.freefloorplan3d.com/">About FreeFloorplan3D</a> · <a href="/guides/">Read the planning guides</a></div></noscript></body>
    </html>
  );
}
