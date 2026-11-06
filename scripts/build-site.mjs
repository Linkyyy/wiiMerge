import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, ".."),
  source = path.join(root, "website"),
  output = path.join(source, "dist");
const pkg = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  ),
  release = JSON.parse(
    await fs.readFile(path.join(source, "release.json"), "utf8"),
  );
if (release.version !== pkg.version)
  throw new Error(
    "Update website/release.json to the desktop release before building the website.",
  );
if (
  !new URL(release.downloadUrl).href.startsWith(
    "https://github.com/Linkyyy/wiiMerge/actions/runs/",
  )
)
  throw new Error("Website downloads must point to a verified project build.");
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, "assets"), { recursive: true });
const hash = (buffer) =>
    createHash("sha256").update(buffer).digest("hex").slice(0, 12),
  replacements = new Map();
for (const name of await fs.readdir(path.join(source, "assets"))) {
  const bytes = await fs.readFile(path.join(source, "assets", name)),
    ext = path.extname(name),
    destination = `assets/${path.basename(name, ext)}.${hash(bytes)}${ext}`;
  replacements.set(`assets/${name}`, destination);
  await fs.writeFile(path.join(output, destination), bytes);
}
const values = {
  VERSION: release.version,
  REPOSITORY: release.repository,
  DOWNLOAD_URL: release.downloadUrl,
  LITE_SIZE: release.liteSize,
  COMPAT_SIZE: release.compatSize,
};
const escaped = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const originValue =
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "");
let origin = "";
if (originValue) {
  const url = new URL(originValue);
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Invalid website origin");
  origin = url.origin;
}
const replaceAssets = (text) => {
  for (const [from, to] of replacements) text = text.replaceAll(from, to);
  return text;
};
for (const name of ["site.css", "site.js"]) {
  let text = replaceAssets(await fs.readFile(path.join(source, name), "utf8"));
  for (const [key, value] of Object.entries(values))
    text = text.replaceAll(`{{${key}}}`, value);
  if (/\{\{[A-Z_]+\}\}/.test(text))
    throw new Error(`Unresolved placeholder in ${name}`);
  const ext = path.extname(name),
    destination = `${path.basename(name, ext)}.${hash(text)}${ext}`;
  replacements.set(name, destination);
  await fs.writeFile(path.join(output, destination), text);
}
let html = await fs.readFile(path.join(source, "index.html"), "utf8");
for (const [key, value] of Object.entries(values))
  html = html.replaceAll(`{{${key}}}`, escaped(value));
html = html.replace(
  "{{SOCIAL_META}}",
  origin
    ? `<link rel="canonical" href="${escaped(origin)}/" /><meta property="og:url" content="${escaped(origin)}/" /><meta property="og:image" content="${escaped(origin)}/${replacements.get("assets/workspace-text.png")}" />`
    : "",
);
html = replaceAssets(html);
if (/\{\{[A-Z_]+\}\}/.test(html))
  throw new Error("Unresolved HTML placeholder");
await fs.writeFile(path.join(output, "index.html"), html);
await fs.writeFile(
  path.join(output, "robots.txt"),
  `User-agent: *\nAllow: /\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ""}`,
);
if (origin)
  await fs.writeFile(
    path.join(output, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escaped(origin)}/</loc></url></urlset>\n`,
  );
console.log(
  `Website v${release.version} built: ${path.relative(root, output)}; ${replacements.size + 2 + (origin ? 1 : 0)} static files.`,
);
