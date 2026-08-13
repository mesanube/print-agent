import { serve } from '@hono/node-server';
import { createApi } from './routes.js';

let server = null;
let currentPort = null;

// Server functions
export async function startServer(findAvailablePort, tray, isDevelopmentMode = false) {
  try {
    const port = await findAvailablePort();
    currentPort = port;

    const app = createApi({ isDevelopmentMode, getCurrentPort });

    server = serve({
      fetch: app.fetch,
      port: port
    });
    console.log(`Print Agent server started on port ${port}`);

    if (tray) {
      tray.setToolTip(`Print Agent - Running on port ${port}`);
    }

    return server;
  } catch (error) {
    console.error('Failed to start server:', error);
    throw error;
  }
}

export function getServer() {
  return server;
}

export function getCurrentPort() {
  return currentPort;
}

export function stopServer() {
  if (server) {
    server.close();
    server = null;
    currentPort = null;
  }
}