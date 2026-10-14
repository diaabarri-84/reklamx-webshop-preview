#!/usr/bin/env node
// localhost:<from> → the local test shop on 127.0.0.1:<to>, the address bar
// keeping <from>. Started by start-windows.mjs so the test shop answers on the
// developer's usual port (8080) too; 3100 stays the shop's own port, which the
// test suites in this folder use.
//
//   node scripts/local-e2e/forward.mjs [from=8080] [to=3100]
import http from 'node:http';
import net from 'node:net';

const [from = '8080', to = '3100'] = process.argv.slice(2);
const TARGET = { host: '127.0.0.1', port: Number(to) };

const server = http.createServer((req, res) => {
  const up = http.request(
    { ...TARGET, method: req.method, path: req.url, headers: { ...req.headers, host: `${TARGET.host}:${TARGET.port}` } },
    (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); },
  );
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`The test shop on ${to} is not running — node scripts/local-e2e/start-windows.mjs`);
  });
  req.pipe(up);
});
// WebSockets pass straight through (Vite's live reload, should it use this port).
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(TARGET.port, TARGET.host, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});
server.listen(Number(from), () => console.log(`localhost:${from} → 127.0.0.1:${to}`));
