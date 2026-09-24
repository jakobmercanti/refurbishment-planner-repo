import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const localNetworkOrigins = Object.values(networkInterfaces())
  .flat()
  .filter((address) => address?.family === "IPv4" && !address.internal)
  .map((address) => address!.address);

const nextConfig: NextConfig = {
  ...(process.env.PLANNER_STATIC_EXPORT === "true" ? { output: "export", trailingSlash: true, images: { unoptimized: true } } : {}),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  reactStrictMode: true,
  allowedDevOrigins: ["localhost", "127.0.0.1", ...localNetworkOrigins],
  ...(process.env.PLANNER_STATIC_EXPORT === "true" ? {} : { async rewrites() {
    return [
      {
        source: "/engineering-api/:path*",
        destination: `${process.env.ENGINEERING_API_ORIGIN ?? "http://127.0.0.1:8000"}/:path*`,
      },
    ];
  } }),
};

export default nextConfig;
