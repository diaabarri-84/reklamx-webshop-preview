// PM2, the thing that keeps the shop running.
//
// The server is bound to LOOPBACK on purpose: on a shared machine, binding
// 0.0.0.0 would publish the shop on every neighbour's address and on the raw
// server IP, bypassing the domain, the certificate and Cloudflare. Apache is
// the only thing that talks to it (see deploy/htaccess-proxy.txt).
module.exports = {
  apps: [
    {
      name: 'reklamx-shop',
      script: './dist/server.cjs',
      cwd: '/home/shopreklam/reklamx',      // adjust if the account name differs
      instances: 1,
      exec_mode: 'fork',                     // NOT cluster: the stage sweep must
                                             // run in one process, not four
      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      // A leak restarts the process instead of taking the machine down with it.
      max_memory_restart: '500M',
      env: {
        // Without this the server loads Vite and behaves like a dev machine.
        NODE_ENV: 'production',
        PORT: 3060,
        HOST: '127.0.0.1',
      },
      // Everything else — Firebase, Mollie, SMTP, Zendr — comes from .env in
      // `cwd`, which dotenv reads at boot. Secrets never live in this file.
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
