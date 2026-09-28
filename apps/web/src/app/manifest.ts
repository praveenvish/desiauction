import type { MetadataRoute } from "next";

// The installed app: Android's home screen and splash, and the icon a desktop
// browser shows when someone installs the site. Android masks every icon to
// its own shape (circle, squircle), so the maskable icon is a full-bleed gold
// square with the glyph inside the central 80% safe zone; the plain icons keep
// the tile's own rounded corners for launchers that do not mask.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DesiAuction",
    short_name: "DesiAuction",
    description: "Run your player auction live.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B1018",
    theme_color: "#0B1018",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/brand/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
