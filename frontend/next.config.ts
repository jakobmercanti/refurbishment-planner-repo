import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";
import path from "node:path";

const localNetworkOrigins = Object.values(networkInterfaces())
  .flat()
  .filter((address) => address?.family === "IPv4" && !address.internal)
  .map((address) => address!.address);

// Keep browser auth requests same-origin in development, just as on the
// production Worker. Only these public Auth endpoints reach the fixed provider.
const authOrigin = (() => {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
})();

// Local geometry does not need a privileged account database key. Read only
// plan status from the existing hosted account service. Do not route catalogue
// flags or writes that could enable billing on an unconfigured local backend.
const accountReadOrigin = (() => {
  const url = new URL(process.env.COMMERCIAL_READ_API_ORIGIN ?? "https://freefloorplan3d-api-production.up.railway.app");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("COMMERCIAL_READ_API_ORIGIN must be a trusted HTTPS origin or a loopback test server.");
  return url.origin;
})();

const nextConfig: NextConfig = {
  ...(process.env.PLANNER_STATIC_EXPORT === "true" ? { output: "export", trailingSlash: true, images: { unoptimized: true } } : {}),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  reactStrictMode: true,
  // Shared release markup lives in deployment/, beside frontend/. Turbopack
  // otherwise fences resolution at frontend/pnpm-lock.yaml and rejects it.
  turbopack: { root: path.resolve(import.meta.dirname, "..") },
  allowedDevOrigins: ["localhost", "127.0.0.1", ...localNetworkOrigins],
  ...(process.env.PLANNER_STATIC_EXPORT === "true" ? {} : { async rewrites() {
    return [
      ...(authOrigin ? [{
        source: "/auth-api/:endpoint(token|signup|resend|otp|recover|user|logout|settings)",
        destination: `${authOrigin}/auth/v1/:endpoint`,
      }] : []),
      {
        source: "/engineering-api/commercial/summary",
        destination: `${accountReadOrigin}/commercial/summary`,
      },
      // The private worker is a separate Railway service; it validates every
      // bearer token and enabled account itself, including in local development.
      {
        source: "/engineering-api/climoptix/worker/:path*",
        destination: `${process.env.CFD_WORKER_ORIGIN ?? "https://climoptix-openfoam-production.up.railway.app"}/climoptix/worker/:path*`,
      },
      {
        source: "/engineering-api/:path*",
        destination: `${process.env.ENGINEERING_API_ORIGIN ?? "http://127.0.0.1:8000"}/:path*`,
      },
    ];
  } }),
};

export default nextConfig;
