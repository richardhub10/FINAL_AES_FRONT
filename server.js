const http = require('http');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function safeResolve(requestPath) {
  const urlPath = decodeURIComponent((requestPath || '/').split('?', 1)[0]);
  const clean = urlPath.replace(/\0/g, '');
  const rel = clean.startsWith('/') ? clean.slice(1) : clean;
  const resolved = path.resolve(distDir, rel);
  if (!resolved.startsWith(path.resolve(distDir) + path.sep) && resolved !== path.resolve(distDir)) {
    return null;
  }
  return resolved;
}

async function readFileIfExists(filePath) {
  try {
    const data = await fs.promises.readFile(filePath);
    return data;
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return null;
    throw e;
  }
}

function createStaticServer() {
  return http.createServer(async (req, res) => {
    try {
      if (!req || !req.url) {
        res.statusCode = 400;
        res.end('Bad Request');
        return;
      }

      // Basic health endpoint
      if (req.url === '/healthz' || req.url === '/healthz/') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // Serve static files from dist/
      let filePath = safeResolve(req.url);
      if (!filePath) {
        res.statusCode = 400;
        res.end('Bad Request');
        return;
      }

      // If root, serve index.html
      if (filePath === path.resolve(distDir)) {
        filePath = path.join(distDir, 'index.html');
      }

      // If path is directory, try index.html
      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
      } catch (e) {
        // ignore
      }

      let body = await readFileIfExists(filePath);

      // SPA fallback to index.html
      if (!body) {
        const indexPath = path.join(distDir, 'index.html');
        body = await readFileIfExists(indexPath);
        if (!body) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('dist/index.html not found. Build step may have failed.');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', contentTypes['.html']);
        res.end(body);
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.statusCode = 200;
      res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
      res.end(body);
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Server error');
      console.error('[static-server] error', e);
    }
  });
}

function toPort(value) {
  const n = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const envPort = toPort(process.env.PORT);
  const primaryPort = envPort || 3000;
  const extraPorts = new Set();
  extraPorts.add(primaryPort);
  // Railway/service configs sometimes route HTTP to 3000 or 8080 regardless of PORT.
  extraPorts.add(3000);
  extraPorts.add(8080);

  const ports = Array.from(extraPorts);
  const server = createStaticServer();

  // Listen on the primary port first; if 3000 differs, also listen on 3000 via a second server.
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(primaryPort, '0.0.0.0', () => {
      console.log(`[static-server] PORT env: ${process.env.PORT || '(not set)'}`);
      console.log(`[static-server] Listening on 0.0.0.0:${primaryPort}`);
      resolve();
    });
  });

  console.log(`[static-server] Will listen on: ${ports.join(', ')}`);

  const secondaryPorts = ports.filter((p) => p !== primaryPort);
  for (const p of secondaryPorts) {
    const s = createStaticServer();
    s.listen(p, '0.0.0.0', () => {
      console.log(`[static-server] Also listening on 0.0.0.0:${p}`);
    });
  }
}

main().catch((e) => {
  console.error('[static-server] Failed to start', e);
  process.exit(1);
});
