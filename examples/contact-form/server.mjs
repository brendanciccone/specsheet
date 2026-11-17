// A tiny server for the example prototype: static files plus one mock endpoint.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app');
const port = Number(process.env.PORT ?? 4173);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

http
  .createServer((request, response) => {
    const url = new URL(request.url, `http://localhost:${port}`);

    if (request.method === 'POST' && url.pathname === '/api/contact') {
      // Mock data: every message is accepted after a short delay.
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true }));
      }, 300);
      return;
    }

    if (url.pathname === '/') {
      response.writeHead(302, { location: '/help' });
      response.end();
      return;
    }

    const name = url.pathname === '/help' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(root, path.normalize(name));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': `${types[path.extname(file)] ?? 'text/plain'}; charset=utf-8` });
    fs.createReadStream(file).pipe(response);
  })
  .listen(port, () => console.log(`Example prototype on http://localhost:${port}/help`));
