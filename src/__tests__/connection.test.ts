import * as net from 'net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleConnection, getActiveConnectionCount } from '../server/connection';

function waitForServerListen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address() as net.AddressInfo;
      resolve(addr.port);
    });
  });
}

function waitForServerClose(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function connectClient(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
      resolve(client);
    });
    client.on('error', reject);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('handleConnection', () => {
  let server: net.Server;
  let port: number;
  let baseCount: number;
  let clients: net.Socket[];

  beforeEach(async () => {
    clients = [];
    baseCount = getActiveConnectionCount();
    server = net.createServer((socket) => handleConnection(socket));
    port = await waitForServerListen(server);
  });

  afterEach(async () => {
    // Close all client sockets
    for (const client of clients) {
      if (!client.destroyed) {
        client.destroy();
      }
    }
    await waitForServerClose(server);
    // Give a small amount of time for connection close events to propagate
    await delay(150);
  });

  it('클라이언트가 연결되면 활성 연결 수가 증가한다', async () => {
    const client = await connectClient(port);
    clients.push(client);

    await delay(100);
    expect(getActiveConnectionCount()).toBe(baseCount + 1);
  });

  it('클라이언트가 연결을 종료하면 활성 연결 수가 감소한다', async () => {
    const client = await connectClient(port);
    clients.push(client);

    await delay(100);
    expect(getActiveConnectionCount()).toBe(baseCount + 1);

    const closePromise = new Promise<void>((resolve) => {
      client.on('close', () => resolve());
    });
    client.destroy();
    await closePromise;
    await delay(100);

    expect(getActiveConnectionCount()).toBe(baseCount);
  });

  it('여러 클라이언트가 동시에 연결될 수 있다', async () => {
    const numClients = 3;

    for (let i = 0; i < numClients; i++) {
      const client = await connectClient(port);
      clients.push(client);
    }

    await delay(100);
    expect(getActiveConnectionCount()).toBe(baseCount + numClients);
  });
});

describe('getActiveConnectionCount', () => {
  it('초기 활성 연결 수를 반환한다', () => {
    const count = getActiveConnectionCount();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});