#!/usr/bin/env node
// Stop the local test shop, the mail sink and the emulators started by
// start-windows.mjs. The Windows twin of stop.sh — the same ports.
import { spawnSync } from 'node:child_process';

for (const port of [8080, 3100, 2525, 8085, 9099, 9199, 4400, 4500]) {
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`]);
}
console.log('stopped');
