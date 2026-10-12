import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const base = "docs/product/UI-REFINEMENT/prototype";
const assets = new Map([
  ["/", [`${base}/index.html`, "text/html"]],
  ["/prototype.js", [`${base}/prototype.js`, "text/javascript"]],
  ["/prototype.css", [`${base}/prototype.css`, "text/css"]],
  ...["primitives", "daylight", "floodlight"].map((name) => [
    `/tokens/${name}.css`,
    [`packages/ui/src/generated/${name}.css`, "text/css"],
  ]),
  [
    "/fonts/text.woff2",
    ["apps/web/.next-e2e/static/media/geist-sans-latin-400-normal.6bb98460.woff2", "font/woff2"],
  ],
]);
http
  .createServer(async (req, res) => {
    const item = assets.get(new URL(req.url, "http://127.0.0.1:3052").pathname);
    if (!item || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const body = await fs.readFile(path.join(root, item[0]));
      res.writeHead(200, {
        "Content-Type": item[1],
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; frame-ancestors 'none'",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(3052, "127.0.0.1", () =>
    process.stdout.write("Isolated synthetic design study at http://127.0.0.1:3052\n"),
  );
