export const SITEMAP_ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
export const SITEMAP_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>${SITEMAP_ORIGIN}/examples/extract/sources/technical-guide.html</loc><lastmod>2026-10-15</lastmod><image:image><image:loc>https://images.example/ignored-extension.jpg</image:loc></image:image></url>
  <url><loc>${SITEMAP_ORIGIN}/examples/extract/sources/short-article.html</loc><lastmod>2026-10-15</lastmod></url>
  <url><loc>${SITEMAP_ORIGIN}/examples/extract/sources/long-document.html</loc></url>
</urlset>
`;
export const SITEMAP_INDEX = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${SITEMAP_ORIGIN}/examples/sitemap/source.xml</loc><lastmod>2026-10-15</lastmod></sitemap></sitemapindex>`;
