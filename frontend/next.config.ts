import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

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

const nextConfig: NextConfig = {
  ...(process.env.PLANNER_STATIC_EXPORT === "true" ? { output: "export", trailingSlash: true, images: { unoptimized: true } } : {}),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  reactStrictMode: true,
  allowedDevOrigins: ["localhost", "127.0.0.1", ...localNetworkOrigins],
  ...(process.env.PLANNER_STATIC_EXPORT === "true" ? {} : { async rewrites() {
    return [
      ...(authOrigin ? [{
        source: "/auth-api/:endpoint(token|signup|resend|otp|recover|user|logout|settings)",
        destination: `${authOrigin}/auth/v1/:endpoint`,
      }] : []),
      {
        source: "/engineering-api/:path*",
        destination: `${process.env.ENGINEERING_API_ORIGIN ?? "http://127.0.0.1:8000"}/:path*`,
      },
    ];
  } }),
};

export default nextConfig;
