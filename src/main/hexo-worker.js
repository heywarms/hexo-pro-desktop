'use strict';

const HexoProServer = require('./hexo-server');
const server = new HexoProServer(process.argv[2] || null);
const allowed = new Set(['start', 'startStaticServer', 'restart', 'stop', 'generate', 'deploy', 'clean', 'getBlogConfig', 'saveBlogConfig']);
let queue = Promise.resolve();
let stopping = false;

function send(message) {
  if (process.connected) process.send(message, () => {});
}

process.on('message', message => {
  if (!message || !Number.isSafeInteger(message.id) || !allowed.has(message.method) || !Array.isArray(message.args)) return;
  queue = queue.then(async () => {
    try {
      const result = await server[message.method](...message.args);
      send({ id: message.id, result, info: { url: server.getUrl(), port: server.getPort() } });
    } catch (error) {
      send({ id: message.id, error: { message: error.message, code: error.code } });
    }
  });
});

async function shutdown() {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 2500);
  timer.unref();
  try { await server.stop(); } finally { process.exit(0); }
}

process.on('disconnect', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
