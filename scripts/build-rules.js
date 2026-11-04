// Builds docs/rules.html from the rules in rules/*.md, so the rules have one source and a printable form.
// ### No packages are needed: this small converter handles what the rules use (headings, tables, lists, quotes, bold, italics,
// ### code and links). A test checks that docs/rules.html is up to date. To make the PDF, open the page and print it to PDF.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PARTS = ['README.md', 'room-1-escape-room.md', 'room-2-shard-heist.md'];

const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(text){
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    // links to the other rule files point inside this one page; anything else keeps its text only
    .replace(/\[([^\]]+)\]\((room-[^)]+)\.md\)/g, '<a href="#$2">$1</a>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}
// ### Turns one Markdown document into HTML, line by line. Each block ends where a line of another kind begins.
function markdown(md){
  const out = [], L = md.replace(/\r/g, '').split('\n');
  for (let i = 0; i < L.length;){
    const l = L[i];
    if (!l.trim()){ i++; continue; }
    const h = l.match(/^(#{1,3}) (.*)/);
    if (h){ out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (l.startsWith('> ')){ out.push(`<blockquote>${inline(l.slice(2))}</blockquote>`); i++; continue; }
    if (l.startsWith('|')){
      const rows = []; while (i < L.length && L[i].startsWith('|')) rows.push(L[i++]);
      const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      out.push('<table><tr>' + cells(rows[0]).map(c => `<th>${inline(c)}</th>`).join('') + '</tr>');
      rows.slice(2).forEach(r => out.push('<tr>' + cells(r).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'));
      out.push('</table>');
      continue;
    }
    if (/^(- |\d+\. )/.test(l)){
      const tag = l.startsWith('- ') ? 'ul' : 'ol', items = [];
      while (i < L.length && /^(- |\d+\. )/.test(L[i])) items.push(L[i++].replace(/^(- |\d+\. )/, ''));
      out.push(`<${tag}>` + items.map(t => `<li>${inline(t)}</li>`).join('') + `</${tag}>`);
      continue;
    }
    const para = []; while (i < L.length && L[i].trim() && !/^(#|> |\||- |\d+\. )/.test(L[i])) para.push(L[i++]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}
const STYLE = `
@page{size:A4;margin:18mm 16mm}
:root{--ink:#1c2233;--muted:#5b6275;--line:#d8dbe4;--accent:#0a7f99;--soft:#f2f4f8}
*{box-sizing:border-box}
body{margin:0 auto;max-width:800px;padding:24px;font:10.5pt/1.5 "Segoe UI",system-ui,sans-serif;color:var(--ink);background:#fff}
h1{font-size:21pt;line-height:1.15;margin:0 0 8pt}
h2{font-size:13.5pt;margin:18pt 0 6pt;padding-bottom:3pt;border-bottom:1px solid var(--line);color:var(--accent);break-after:avoid}
h3{font-size:11pt;margin:12pt 0 4pt;break-after:avoid}
section{margin-top:26pt}
section+section{break-before:page}
.cover{padding:18pt 20pt;background:#10162b;color:#fff;border-radius:6pt;margin-bottom:6pt}
.cover h1{color:#fff;font-size:27pt}
.cover p{margin:0;color:#c3cbe0}
p{margin:0 0 7pt}
ul,ol{margin:0 0 8pt;padding-left:17pt}
li{margin-bottom:3pt}
blockquote{margin:0 0 9pt;padding:6pt 10pt;background:var(--soft);border-left:3px solid var(--accent);color:var(--muted)}
table{width:100%;border-collapse:collapse;margin:5pt 0 11pt;font-size:9.4pt}
tr{break-inside:avoid}
th{text-align:left;background:var(--soft);font-weight:600}
th,td{padding:4pt 6pt;border:1px solid var(--line);vertical-align:top}
code{font:8.8pt Consolas,monospace;background:var(--soft);padding:0 2pt;border-radius:2pt}
a{color:var(--accent)}`;
function buildRulesHtml(){
  const sections = PARTS.map(f => `<section id="${f.replace('.md', '')}">\n${markdown(fs.readFileSync(path.join(ROOT, 'rules', f), 'utf8'))}\n</section>`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Shard Heist – Game Rules</title>
<style>${STYLE}
</style>
</head>
<body>
<div class="cover"><h1>Shard Heist</h1><p>The game rules, for both rooms. Built from <code style="background:none;color:inherit">rules/*.md</code>.</p></div>
${sections.join('\n')}
</body>
</html>
`;
}
if (require.main === module){
  fs.writeFileSync(path.join(ROOT, 'docs', 'rules.html'), buildRulesHtml());
  console.log('docs/rules.html written');
}
module.exports = { buildRulesHtml, markdown };
