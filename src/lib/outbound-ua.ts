// The User-Agent this service sends to outside hosts (21 Nov 2026). The page fetcher, the archive lookup and the
// DexScreener client named the software but gave a site's operator no address to write to, and a dozen routes sent a
// bare "AgentDataTools/1.0". A crawler that can be contacted is throttled or asked to slow down; one that cannot is
// blocked. Every outbound name is now built here from one contact address: the service's public site, which is
// the same origin the hosted pages are served from (routes/pages.ts `PUBLIC_ORIGIN`; a test keeps the two equal).
//
// Not built from this file, on purpose: the SEC and FAA reads (routes/gov-data.ts `SEC_UA`: SEC fair access asks for a
// contact e-mail in that exact form), the law reader's own name (lib/law-versions.ts), the self-check name used over
// the service binding (lib/self-fetch.ts), and the search-suggestion reads (routes/keywords.ts), whose answers'
// format depends on the browser name sent. Still bare, and wanted: the registry read in routes/domain.ts, which the
// domain report shares; that report was frozen when this file was written.

/** Where an operator of a site we fetched can find out who we are and how to reach us. */
export const CONTACT_URL = "https://agent-data-tools.revmesh2074.workers.dev";

/** For pages a caller names: sites that answer only browser-like agents still answer, and the contact is in the name. */
export const FETCH_UA = `Mozilla/5.0 (compatible; AgentDataTools/1.0; +${CONTACT_URL})`;

/** For the fixed public APIs the tools read. */
export const API_UA = `AgentDataTools/1.0 (+${CONTACT_URL})`;
