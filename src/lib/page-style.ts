// Shared light/dark page style for plain content pages (lexglyph pages). Moved here from compare-pages.ts when the
// comparison pages were removed (owner, 17 Nov 2026: no rival comparisons on glyphcall.com).
export const STYLE = `:root{--bg:#fff;--fg:#16181d;--muted:#5b616b;--card:#f5f6f8;--line:#e2e5ea;--accent:#0b57d0;--accent-fg:#fff;--ok:#0b6e4f}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e9ebee;--muted:#a2a8b0;--card:#1a1d22;--line:#2b3037;--accent:#8ab4f8;--accent-fg:#0b1a33;--ok:#5fd0a5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 16px 56px}nav.crumbs{color:var(--muted);font-size:.9rem;margin-bottom:18px}
h1{font-size:2rem;line-height:1.15;margin:0 0 10px;letter-spacing:-.01em}.tag{font-size:1.1rem;color:var(--muted);margin:0 0 18px}
h2{font-size:1.25rem;margin:36px 0 10px}p{margin:8px 0}a{color:var(--accent)}ul{padding-left:22px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 6px}.btn{display:inline-block;padding:11px 18px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
.small{color:var(--muted);font-size:.9rem}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.93rem}
td,th{border-bottom:1px solid var(--line);padding:9px 8px;text-align:left;vertical-align:top}th{white-space:nowrap}tr.us td{background:var(--card)}
footer{margin-top:40px;color:var(--muted);font-size:.9rem}`;
