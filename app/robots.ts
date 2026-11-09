import type { MetadataRoute } from "next";

// Nothing here is for search engines.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
