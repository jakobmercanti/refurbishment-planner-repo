import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Script from "next/script";
import { APP_APPEARANCE_STORAGE_KEY } from "@/lib/appPreferences";
import "./globals.css";
import "./ui-theme.css";
import "./mobile.css";
import "./plannerbuild-entry.css";
import "./privacy.css";
import "./commercial.css";
import "./density.css";
import "./appearance.css";

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

const appearanceBootstrap = `(() => {
  const root = document.documentElement;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(${JSON.stringify(APP_APPEARANCE_STORAGE_KEY)}) || "null"); } catch {}
  const requestedTheme = ["system", "light", "dark"].includes(saved?.theme) ? saved.theme : "system";
  let systemPrefersDark = false;
  try { systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch {}
  root.dataset.themeMode = requestedTheme;
  root.dataset.theme = requestedTheme === "system" ? (systemPrefersDark ? "dark" : "light") : requestedTheme;
  root.dataset.density = ["comfortable", "compact"].includes(saved?.density) ? saved.density : "comfortable";
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" data-theme-mode="system" data-density="comfortable" suppressHydrationWarning>
      <body>
        <Script id="appearance-preferences-bootstrap" strategy="beforeInteractive">{appearanceBootstrap}</Script>
        {children}<noscript><div style={{ padding: 24 }}><h1>Free floorplan creator in 2D and 3D</h1><p>Enable JavaScript to draw your floorplan, explore in 3D and download it for free. No registration or payment required.</p><Link href="/">About FreeFloorplan3D</Link> · <Link href="/guides/">Read the planning guides</Link></div></noscript>
        <Script src="/google-consent.js?v=ads-consent-20260926" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
