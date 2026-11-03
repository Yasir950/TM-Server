import type { MetadataRoute } from "next";
import { APP_NAME, RAIL } from "@/lib/brand";

// Makes the app installable; iOS only delivers Web Push to apps added to the home screen
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: `${APP_NAME} team messaging`,
    start_url: "/",
    display: "standalone",
    background_color: RAIL,
    theme_color: RAIL,
    icons: [{ src: "/asset/AppIcon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
