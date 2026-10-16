export type MetadataNode = { tag: string; attrs: Record<string, string>; children: (MetadataNode | string)[] };
type Declaration = { value: string; source: string };
export type SourceMetadata = {
  verification: "not_verified";
  authors: Declaration[];
  dates: (Declaration & { kind: "published" | "modified" })[];
  truncated: boolean;
};
export const emptySourceMetadata = (): SourceMetadata => ({ verification: "not_verified", authors: [], dates: [], truncated: false });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const schemaContext = (v: unknown, depth=0): boolean => depth > 4 ? false :
  typeof v === "string" ? /^https?:\/\/schema\.org\/?$/.test(v) :
  Array.isArray(v) ? v.some(item=>schemaContext(item,depth+1)) : record(v) && schemaContext(v["@vocab"],depth+1);
const types = new Set(["Article", "BlogPosting", "NewsArticle", "TechArticle", "ScholarlyArticle", "WebPage", "CreativeWork"]);

/** Bounded source declarations, not verified authorship, freshness or JSON-LD expansion. */
export function readSourceMetadata(root: MetadataNode, finalUrl: string, canonical: string | null, linkBaseUrl: string) {
  const metadata = emptySourceMetadata(), warnings = new Set<string>();
  let budget = 2000, scripts = 0, nodes = 0;
  const seen = new Set<string>();
  const add = (kind: "author" | "published" | "modified", raw: unknown, source: string) => {
    if (typeof raw !== "string" || !raw.trim()) return;
    const value = raw.trim(), target = kind === "author" ? metadata.authors : metadata.dates;
    const key = `${kind}\u0000${value}\u0000${source}`;
    if (seen.has(key)) return;
    if (value.length > (kind === "author" ? 256 : 128) || target.length >= (kind === "author" ? 5 : 10) || value.length + source.length > budget) {
      metadata.truncated = true; return;
    }
    budget -= value.length + source.length; seen.add(key);
    if (kind === "author") metadata.authors.push({value,source});
    else metadata.dates.push({kind,value,source});
  };
  const normalizedUrl = (value: unknown): string | null => {
    if (record(value)) value = value.url ?? value["@id"];
    if (typeof value !== "string" || !value || value.length > 4096) return null;
    try { const u=new URL(value,linkBaseUrl); if(!/^https?:$/.test(u.protocol)||u.username||u.password)return null; u.hash="";return u.href; } catch { return null; }
  };
  const identities = new Set([normalizedUrl(finalUrl),normalizedUrl(canonical)].filter((v):v is string=>v!==null));
  const localAuthors = new Map<string,{name:string;source:string}[]>();
  const referenceId = (value: unknown): string | null => {
    if(typeof value!=="string" || !value || value.length>4096)return null;
    if(value.startsWith("_:"))return value;
    try{const u=new URL(value,linkBaseUrl);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
  };
  const candidates: {value:Record<string,unknown>;path:string;match:boolean}[] = [];
  const walkJson = (value: unknown, path: string, context: boolean, depth: number) => {
    if (++nodes > 100 || depth > 8) { metadata.truncated=true; return; }
    if (Array.isArray(value)) { for(let i=0;i<value.length;i++){if(nodes>=100){metadata.truncated=true;break;}walkJson(value[i],`${path}[${i}]`,context,depth+1);}return; }
    if (!record(value)) return;
    const schema = "@context" in value ? schemaContext(value["@context"]) : context;
    const declaredTypes = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    const localEntity=declaredTypes.some(t=>typeof t==="string" && ["Person","Organization"].includes(t.replace(/^https?:\/\/schema\.org\//,"")) && (schema || /^https?:\/\/schema\.org\//.test(t)));
    const entityId=referenceId(value["@id"]);
    if(localEntity && entityId && typeof value.name==="string"){
      const entries=localAuthors.get(entityId)??[];entries.push({name:value.name,source:path+".name"});localAuthors.set(entityId,entries);
    }
    const eligible = declaredTypes.some(t=>typeof t==="string" && types.has(t.replace(/^https?:\/\/schema\.org\//,"")) && (schema || /^https?:\/\/schema\.org\//.test(t)));
    if (eligible) {
      const urls=[value.url,value["@id"],value.mainEntityOfPage].map(normalizedUrl).filter((v):v is string=>v!==null);
      // An explicit different page identity is not a fallback candidate for this page.
      if(!urls.length || urls.some(url=>identities.has(url)))candidates.push({value,path,match:urls.some(url=>identities.has(url))});
    }
    if ("@graph" in value) walkJson(value["@graph"],path+".@graph",schema,depth+1);
  };
  const text = (n: MetadataNode): string => n.children.map(c=>typeof c==="string"?c:text(c)).join("");
  const visit = (n: MetadataNode, inHead=false, parent="") => {
    if (["template","svg","math","iframe","noscript"].includes(n.tag)) return;
    const head = inHead || n.tag === "head";
    if(n.tag==="meta" && (head || parent==="root")) {
      const key=(n.attrs.name??n.attrs.property??"").toLowerCase();
      const kind=key==="author"||key==="article:author"?"author":key==="article:published_time"?"published":key==="article:modified_time"?"modified":null;
      if(kind)add(kind,n.attrs.content,`meta:${n.attrs.name!==undefined?"name":"property"}=${key}`);
    }
    if(n.tag==="script" && /^application\/ld\+json(?:\s*;|$)/i.test((n.attrs.type??"").trim())) {
      const index=scripts++;
      if(index>=8){metadata.truncated=true;return;}
      if(n.attrs.src){warnings.add("source_metadata_external_jsonld_ignored");return;}
      const json=text(n);
      if(new TextEncoder().encode(json).length>65536){metadata.truncated=true;return;}
      try{walkJson(JSON.parse(json),`jsonld[${index}]`,false,0);}catch{warnings.add("source_metadata_jsonld_invalid");}
      return;
    }
    for(const child of n.children)if(typeof child!=="string")visit(child,head,n.tag);
  };
  visit(root);
  const matched=candidates.filter(c=>c.match);
  const selected=matched.length?matched:candidates.length===1?candidates:[];
  if(!matched.length && candidates.length>1)warnings.add("source_metadata_jsonld_ambiguous");
  for(const {value,path} of selected){
    const authors=Array.isArray(value.author)?value.author:[value.author];
    for(let i=0;i<authors.length;i++){
      if(i>=20){metadata.truncated=true;break;}
      const author=authors[i];
      const authorPath=`${path}.author${Array.isArray(value.author)?`[${i}]`:""}`;
      if(record(author) && typeof author.name!=="string" && author["@id"]!==undefined){
        const id=referenceId(author["@id"]), entries=id?localAuthors.get(id):undefined;
        if(!entries?.length)warnings.add("source_metadata_references_unresolved");
        else if(new Set(entries.map(e=>e.name)).size>1)warnings.add("source_metadata_author_reference_ambiguous");
        else add("author",entries[0].name,`${authorPath}.@id -> ${entries[0].source}`);
      } else add("author",record(author)?author.name:author,`${authorPath}${record(author)?".name":""}`);
    }
    for(const [field,kind] of [["datePublished","published"],["dateModified","modified"]] as const){
      const values=Array.isArray(value[field])?value[field]:[value[field]];
      for(let i=0;i<values.length;i++){if(i>=20){metadata.truncated=true;break;}add(kind,values[i],`${path}.${field}${Array.isArray(value[field])?`[${i}]`:""}`);}
    }
  }
  if(metadata.authors.length||metadata.dates.length)warnings.add("source_metadata_unverified");
  if(metadata.truncated)warnings.add("source_metadata_truncated");
  for(const kind of ["published","modified"] as const)if(new Set(metadata.dates.filter(d=>d.kind===kind).map(d=>d.value)).size>1)warnings.add("source_date_values_differ");
  return {metadata,warnings:[...warnings]};
}
