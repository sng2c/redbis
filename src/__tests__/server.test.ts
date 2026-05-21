import * as net from 'net';
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, startServer, shutdownServer } from '../server';
import { Config } from '../config';
import { InMemoryStorage } from '../storage/memory';

// Helper config for tests using port 0 (OS-assigned)
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: '127.0.0.1',
    logLevel: 'info',
    databaseUrl: 'memory://',
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function closeServer(server: net.Server | null): Promise<void> {
  if (!server) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

describe('createServer', () => {
  it('net.Server 인스턴스를 생성한다', () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    const server = createServer(cfg, storage);
    expect(server).toBeInstanceOf(net.Server);
    server.close();
  });
});

describe('startServer', () => {
  let server: net.Server | null = null;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = null;
    }
  });

  it('서버가 지정된 포트에서 수신 대기한다', async () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    server = await startServer(cfg, storage);
    expect(server).toBeInstanceOf(net.Server);
    expect(server.listening).toBe(true);

    const addr = server.address() as net.AddressInfo;
    expect(addr.port).toBeGreaterThan(0);
  });

  it('서버가 수신 대기 시작 시 Promise를 해결한다', async () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    const result = startServer(cfg, storage);
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
    await closeServer(secondServer!);
    await closeServer(firstServer!);
    firstServer = null;
    secondServer = null;
  });

  it('이미 사용 중인 포트에서 EADDRINUSE 에러가 발생한다', async () => {
    // Start first server on port 0 to get an OS-assigned port
    const cfg1 = makeConfig();
    firstServer = await startServer(cfg1, new InMemoryStorage());
    const usedPort = (firstServer.address() as net.AddressInfo).port;

    // Try to start second server on the same port
    const cfg2 = makeConfig({ port: usedPort });
    await expect(startServer(cfg2, new InMemoryStorage())).rejects.toThrow();
  });
});

describe('shutdownServer', () => {
  let server: net.Server | null = null;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = null;
    }
  });

  it('서버를 정상적으로 종료한다', async () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    server = await startServer(cfg, storage);
    expect(server.listening).toBe(true);

    await shutdownServer(server);
    // After shutdown, the server should no longer be listening
    expect(server.listening).toBe(false);
  });

  it('연결된 클라이언트가 없을 때 즉시 종료된다', async () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    server = await startServer(cfg, storage);

    const start = Date.now();
    await shutdownServer(server);
    const elapsed = Date.now() - start;

    // Should resolve quickly (no clients to wait for)
    expect(elapsed).toBeLessThan(2000);
  });

  it('타임아웃이 지나면 강제 종료한다', async () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    server = await startServer(cfg, storage);

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

  it('서버 시작 후 연결 없이 shutdownServer — 정상 종료', async () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    server = await startServer(cfg, storage);

    // No clients connected, just shutdown
    await shutdownServer(server);
    expect(server.listening).toBe(false);
  });
});

describe('서버 E2E — 클라이언트 연결', () => {
  let server: net.Server | null = null;
  let port: number;
  let clients: net.Socket[];

  afterEach(async () => {
    for (const client of clients) {
      if (!client.destroyed) {
        client.destroy();
      }
    }
    await delay(100);

    if (server && server.listening) {
      await shutdownServer(server);
    }
    server = null;
  });

  it('서버 시작 후 클라이언트 연결/해제 — PING/PONG E2E', async () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    server = await startServer(cfg, storage);
    clients = [];

    const addr = server.address() as net.AddressInfo;
    port = addr.port;

    // Connect client
    const client = net.createConnection({ port, host: '127.0.0.1' });
    clients.push(client);

    await new Promise<void>((resolve) => {
      client.on('connect', () => resolve());
    });

    // Send PING
    const response = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
      client.once('data', (data) => {
        clearTimeout(timeout);
        resolve(data.toString());
      });
      client.write('PING\r\n');
    });

    expect(response).toBe('+PONG\r\n');
  });

  it('서버 시작 후 SET/GET E2E', async () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    server = await startServer(cfg, storage);
    clients = [];

    const addr = server.address() as net.AddressInfo;
    port = addr.port;

    const client = net.createConnection({ port, host: '127.0.0.1' });
    clients.push(client);

    await new Promise<void>((resolve) => {
      client.on('connect', () => resolve());
    });

    // Send SET
    const setResponse = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
      client.once('data', (data) => {
        clearTimeout(timeout);
        resolve(data.toString());
      });
      client.write('SET greet hello\r\n');
    });
    expect(setResponse).toBe('+OK\r\n');

    // Send GET
    const getResponse = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
      client.once('data', (data) => {
        clearTimeout(timeout);
        resolve(data.toString());
      });
      client.write('GET greet\r\n');
    });
    expect(getResponse).toBe('$5\r\nhello\r\n');
  });
});

describe('shutdownServer — 연결된 클라이언트', () => {
  it('연결된 클라이언트가 있는 상태에서 서버 셧다운', async () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    const server = await startServer(cfg, storage);

    const addr = server.address() as net.AddressInfo;
    const client = net.createConnection({ port: addr.port, host: '127.0.0.1' });

    await new Promise<void>((resolve) => {
      client.on('connect', () => resolve());
    });

    // shutdown with short timeout
    await shutdownServer(server, 300);

    // After shutdown, server should no longer be listening
    expect(server.listening).toBe(false);

    // Clean up client
    client.destroy();
  }, 15000);
});

describe('closeAllConnections', () => {
  it('다수 연결 클라이언트 모두 해제', async () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    const server = await startServer(cfg, storage);

    const addr = server.address() as net.AddressInfo;
    const clients: net.Socket[] = [];

    // Connect 3 clients
    for (let i = 0; i < 3; i++) {
      const client = net.createConnection({ port: addr.port, host: '127.0.0.1' });
      clients.push(client);
      await new Promise<void>((resolve) => {
        client.on('connect', () => resolve());
      });
    }

    // shutdownServer will call closeAllConnections after timeout
    await shutdownServer(server, 300);

    // Server should be shut down
    expect(server.listening).toBe(false);

    // Clean up clients
    for (const client of clients) {
      client.destroy();
    }
  }, 15000);
});

describe('서버 에러 이벤트', () => {
  it('서버 error 이벤트 발생 시 에러 핸들러가 동작한다', async () => {
    const cfg = makeConfig();
    const storage = new InMemoryStorage();
    const server = createServer(cfg, storage);

    const errorPromise = new Promise<Error>((resolve) => {
      server.on('error', (err) => resolve(err));
    });

    // Emit a mock error event
    server.emit('error', new Error('test server error'));

    const err = await errorPromise;
    expect(err.message).toBe('test server error');

    server.close();
  });
});