import net from 'net';

const DEFAULT_PORT = 8847;
const MAX_PORT_ATTEMPTS = 10;

// Port detection helpers
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const testServer = net.createServer();
    testServer.once('error', () => resolve(false));
    testServer.once('listening', () => {
      testServer.close();
      resolve(true);
    });
    testServer.listen(port);
  });
}

export async function findAvailablePort(startPort = DEFAULT_PORT, maxAttempts = MAX_PORT_ATTEMPTS) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available ports found in range ${startPort}-${startPort + maxAttempts - 1}`);
}