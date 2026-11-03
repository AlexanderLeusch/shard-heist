// Local static server for development and the browser tests: `npm start`, then open http://localhost:8080
// ### Serves only files inside the project folder, only with GET/HEAD, and only known file types. Paths that try to climb
// ### out of the folder (../), hidden files (.git, .env) and anything unknown get a 4xx answer instead of a file.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf' };

// Returns the absolute file for a request path, or an HTTP status when the request is refused
function resolvePath(urlPath, root = ROOT){
  let p;
  try { p = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]); } catch (e) { return 400; }
  if (p.includes('\0')) return 400;
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(root, '.' + path.posix.normalize('/' + p.replace(/\\/g, '/')));
  if (file !== root && !file.startsWith(root + path.sep)) return 403;
  if (path.relative(root, file).split(path.sep).some(seg => seg.startsWith('.') || seg === 'node_modules')) return 403;
  if (!TYPES[path.extname(file).toLowerCase()]) return 404;
  return file;
}

function createServer(root = ROOT){
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD'){ res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    const file = resolvePath(req.url, root);
    if (typeof file === 'number'){ res.writeHead(file); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err){ res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

if (require.main === module){
  const port = Number(process.env.PORT) || 8080;
  createServer().listen(port, '127.0.0.1', () => console.log(`Shard Heist on http://localhost:${port}`));
}
module.exports = { createServer, resolvePath, ROOT };
