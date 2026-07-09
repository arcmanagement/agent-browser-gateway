export const prerender = true;

const SITE = "https://agent-browser-gateway.com";

// Public HTML surfaces only. Direct download artifacts are intentionally omitted.
const pages = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/docs/", priority: "0.9", changefreq: "weekly" },
  { path: "/docs/install/", priority: "0.9", changefreq: "weekly" },
  { path: "/docs/distribution/", priority: "0.8", changefreq: "weekly" },
  { path: "/docs/cli/", priority: "0.8", changefreq: "weekly" },
  { path: "/docs/plugins/", priority: "0.7", changefreq: "monthly" },
  { path: "/docs/architecture/", priority: "0.7", changefreq: "monthly" },
  { path: "/docs/security/", priority: "0.7", changefreq: "monthly" },
  { path: "/docs/faq/", priority: "0.6", changefreq: "monthly" },
  { path: "/privacy/", priority: "0.6", changefreq: "monthly" },
  { path: "/ja/docs/", priority: "0.6", changefreq: "monthly" },
  { path: "/ja/docs/install/", priority: "0.6", changefreq: "monthly" },
  { path: "/ja/docs/distribution/", priority: "0.5", changefreq: "monthly" },
  { path: "/ja/docs/cli/", priority: "0.5", changefreq: "monthly" },
  { path: "/ja/docs/plugins/", priority: "0.5", changefreq: "monthly" },
  { path: "/ja/docs/architecture/", priority: "0.5", changefreq: "monthly" },
  { path: "/ja/docs/security/", priority: "0.5", changefreq: "monthly" },
  { path: "/ja/docs/faq/", priority: "0.5", changefreq: "monthly" },
];

function urlFor(path: string): string {
  return `${SITE}${path}`;
}

export function GET() {
  const entries = pages
    .map(
      (page) => `  <url>
    <loc>${urlFor(page.path)}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
    )
    .join("\n");

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
