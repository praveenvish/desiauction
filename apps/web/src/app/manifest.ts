import type { MetadataRoute } from "next";

// The installed app: Android's home screen and splash, and the icon a desktop
// browser shows when someone installs the site. Android masks every icon to
// its own shape (circle, squircle), so the maskable icon is a full-bleed gold
// square with the glyph inside the central 80% safe zone; the plain icons keep
// the tile's own rounded corners for launchers that do not mask.
//
// `id` is the app's identity to the browser. It must never change: a new id
// is a different app, and everyone who installed the old one keeps a stale
// icon beside the new one. The screenshots are what Android's richer install
// sheet shows (real screens, see scripts/capture-marketing-screens.ts).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "DesiAuction",
    short_name: "DesiAuction",
    description: "Run your player auction live.",
    lang: "en-IN",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0B1018",
    theme_color: "#0B1018",
    categories: ["sports"],
    prefer_related_applications: false,
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
    // A long-press on the home-screen icon. Both are signed-in pages; a guest
    // is sent to sign in and brought back.
    shortcuts: [
      { name: "Home", url: "/home", icons: [{ src: "/brand/icon-192.png", sizes: "192x192" }] },
      {
        name: "Notifications",
        url: "/inbox",
        icons: [{ src: "/brand/icon-192.png", sizes: "192x192" }],
      },
    ],
    screenshots: [
      {
        src: "/marketing/product/owner-phone-bidding-v2.webp",
        sizes: "560x1212",
        type: "image/webp",
        form_factor: "narrow",
        label: "A team owner bidding from their phone",
      },
      {
        src: "/marketing/product/auction-board-v2.webp",
        sizes: "1600x900",
        type: "image/webp",
        form_factor: "wide",
        label: "The auction board on the big screen",
      },
    ],
  };
}
