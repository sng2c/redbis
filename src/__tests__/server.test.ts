import * as net from 'net';
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, startServer, shutdownServer } from '../server';
import { Config } from '../config';

// Helper config for tests using port 0 (OS-assigned)
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: '127.0.0.1',
    logLevel: 'info',
    ...overrides,
  };
}

describe('createServer', () => {
  it('net.Server 인스턴스를 생성한다', () => {
    const cfg = makeConfig();
    const server = createServer(cfg);
    expect(server).toBeInstanceOf(net.Server);
    server.close();
  });
});

describe('startServer', () => {
  let server: net.Server | null = null;

  afterEach(async () => {
    if (server) {
      try {
        await new Promise<void>((resolve) => {
          server!.close(() => resolve());
        });
      } catch {
        // Already closed
      }
      server = null;
    }
  });

  it('서버가 지정된 포트에서 수신 대기한다', async () => {
    const cfg = makeConfig();
    server = await startServer(cfg);
    expect(server).toBeInstanceOf(net.Server);
    expect(server.listening).toBe(true);

    const addr = server.address() as net.AddressInfo;
    expect(addr.port).toBeGreaterThan(0);
  });

  it('서버가 수신 대기 시작 시 Promise를 해결한다', async () => {
    const cfg = makeConfig();
    const result = startServer(cfg);
    expect(result).toBeInstanceOf(Promise);
    server = await result;
    expect(server).toBeDefined();
    expect(server.listening).toBe(true);
  });
});

describe('EADDRINUSE', () => {
  let firstServer: net.Server | null = null;
  let secondServer: net.Server | null = null;

  afterEach(async () => {
    const closeServer = (srv: net.Server | null) => {
      if (srv) {
        return new Promise<void>((resolve) => {
          if (srv.listening) {
            srv.close(() => resolve());
          } else {
            resolve();
          }
        });
      }
      return Promise.resolve();
    };

    await closeServer(secondServer);
    await closeServer(firstServer);
    firstServer = null;
    secondServer = null;
  });

  it('이미 사용 중인 포트에서 EADDRINUSE 에러가 발생한다', async () => {
    // Start first server on port 0 to get an OS-assigned port
    const cfg1 = makeConfig();
    firstServer = await startServer(cfg1);
    const usedPort = (firstServer.address() as net.AddressInfo).port;

    // Try to start second server on the same port
    const cfg2 = makeConfig({ port: usedPort });
    await expect(startServer(cfg2)).rejects.toThrow();
  });
});

describe('shutdownServer', () => {
  let server: net.Server | null = null;

  afterEach(async () => {
    if (server) {
      try {
        await new Promise<void>((resolve) => {
          if (server!.listening) {
            server!.close(() => resolve());
          } else {
            resolve();
          }
        });
      } catch {
        // Already closed
      }
      server = null;
    }
  });

  it('서버를 정상적으로 종료한다', async () => {
    const cfg = makeConfig();
    server = await startServer(cfg);
    expect(server.listening).toBe(true);

    await shutdownServer(server);
    // After shutdown, the server should no longer be listening
    expect(server.listening).toBe(false);
  });

  it('연결된 클라이언트가 없을 때 즉시 종료된다', async () => {
    const cfg = makeConfig();
    server = await startServer(cfg);

    const start = Date.now();
    await shutdownServer(server);
    const elapsed = Date.now() - start;

    // Should resolve quickly (no clients to wait for)
    expect(elapsed).toBeLessThan(2000);
  });

  it('타임아웃이 지나면 강제 종료한다', async () => {
    const cfg = makeConfig();
    server = await startServer(cfg);

    // Connect a client that stays connected
    const addr = server.address() as net.AddressInfo;
    const client = net.createConnection({ port: addr.port, host: '127.0.0.1' });

    // Wait for client to connect
    await new Promise<void>((resolve) => {
      client.on('connect', () => resolve());
    });

    // shutdownServer with a short timeout should still resolve
    const start = Date.now();
    await shutdownServer(server, 500);
    const elapsed = Date.now() - start;

    // Should resolve around the timeout (500ms), not hang indefinitely
    expect(elapsed).toBeLessThan(3000);

    // Clean up client
    client.destroy();
  });
});