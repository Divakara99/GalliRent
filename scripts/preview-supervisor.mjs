#!/usr/bin/env node
/**
 * Keeps the GalliRent UI preview alive.
 *
 * The sandbox can terminate the child process independently of this wrapper
 * (idle reaping, tool timeouts). This supervisor restarts it on 0.0.0.0:4173
 * with a short backoff so the live preview recovers on its own.
 *
 *   node scripts/preview-supervisor.mjs
 *   PORT=8080 node scripts/preview-supervisor.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, 'preview-server.mjs');
const port = process.env.PORT || '4173';

let child = null;
let shuttingDown = false;
let restarts = 0;

function startChild() {
  child = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    env: { ...process.env, PORT: port, HOST: process.env.HOST || '0.0.0.0' },
  });

  child.on('exit', (code, signal) => {
    child = null;
    if (shuttingDown) {
      process.exit(0);
    }
    restarts += 1;
    const delay = Math.min(500 * restarts, 5000);
    console.log(`[supervisor] preview server exited (code=${code} signal=${signal}); restarting in ${delay}ms`);
    setTimeout(startChild, delay);
  });

  child.on('error', (error) => {
    console.error('[supervisor] failed to start preview server:', error);
  });
}

function shutdown(signal) {
  shuttingDown = true;
  console.log(`[supervisor] ${signal} received; stopping preview server.`);
  if (child) {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child) child.kill('SIGKILL');
      process.exit(0);
    }, 2000).unref();
  } else {
    process.exit(0);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}

console.log(`[supervisor] starting GalliRent UI preview on 0.0.0.0:${port}`);
startChild();
