// The tool's answer for its published example URL (read 11 Nov 2026), shortened to the first two of its entries as a
// call with limit=2 returns them. Until 1.111.4 this showed a file on our own origin while the example input had moved
// to sitemaps.org (1.44.1), so a listing's example answer did not belong to its example input.
export const SITEMAP_OUTPUT_EXAMPLE = {
  "url": "https://www.sitemaps.org/sitemap.xml",
  "finalUrl": "https://www.sitemaps.org/sitemap.xml",
  "kind": "urlset",
  "entries": [
    {
      "url": "https://www.sitemaps.org/",
      "lastModified": "2016-11-21"
    },
    {
      "url": "https://www.sitemaps.org/protocol.html",
      "lastModified": "2022-12-15"
    }
  ],
  "reportedEntries": 84,
  "uniqueReportedLocations": 84,
  "missingOrInvalidLocations": 0,
  "duplicateReportedLocations": 0,
  "rejectedLocationsInPage": 0,
  "matchingReportedLocations": 84,
  "contains": "",
  "offset": 0,
  "nextOffset": 2,
  "hasMore": true,
  "warnings": [
    "counts_describe_reported_locations_before_public_url_validation",
    "locations_and_dates_are_source_reported_not_probed"
  ],
  "text": "https://www.sitemaps.org/\nhttps://www.sitemaps.org/protocol.html",
  "format": "text",
  "hashFormat": "text",
  "contentHash": "sha256:3dafd81033420b45ac1326612fc50790c7e9d0be0bb1707aa4ec4f1cfb0c7284",
  "sourceHash": "sha256:5be36d03d5aaeb4f498144c8d319bc651b3063b94f5012bfb554090dfcea2e55",
  "fetchedAt": "2026-11-10T19:47:32.627Z"
};
