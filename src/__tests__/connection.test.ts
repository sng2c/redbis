import * as net from 'net';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionHandler, getActiveConnectionCount } from '../server/connection';
import { InMemoryStorage } from '../storage/memory';
import { PubSubManager } from '../pubsub/manager';
import { EventEmitter } from 'events';

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

function sendAndReceive(client: net.Socket, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Response timeout'));
    }, 3000);

    client.once('data', (data) => {
      clearTimeout(timeout);
      resolve(data.toString());
    });

    client.write(command);
  });
}

function sendCommand(client: net.Socket, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.write(command, () => resolve());
  });
}

function collectResponses(
  client: net.Socket,
  expectedCount: number,
  timeoutMs: number = 3000
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const responses: string[] = [];
    let buffer = '';

    const timer = setTimeout(() => {
      client.removeListener('data', onData);
      if (responses.length >= expectedCount) {
        resolve(responses);
      } else {
        // Try to split buffer into responses
        if (buffer.length > 0) {
          resolve(splitResponses(buffer));
        } else {
          reject(
            new Error(`Timeout: expected ${expectedCount} responses, got ${responses.length}`)
          );
        }
      }
    }, timeoutMs);

    function onData(data: Buffer) {
      buffer += data.toString();
      const parts = splitResponses(buffer);
      if (parts.length >= expectedCount) {
        clearTimeout(timer);
        client.removeListener('data', onData);
        resolve(parts);
      }
    }

    client.on('data', onData);
  });
}

function splitResponses(data: string): string[] {
  const responses: string[] = [];
  let remaining = data;

  while (remaining.length > 0) {
    if (remaining.startsWith('+') || remaining.startsWith('-')) {
      // Simple string or error: ends at \r\n
      const idx = remaining.indexOf('\r\n');
      if (idx === -1) break;
      responses.push(remaining.substring(0, idx + 2));
      remaining = remaining.substring(idx + 2);
    } else if (remaining.startsWith(':')) {
      // Integer: ends at \r\n
      const idx = remaining.indexOf('\r\n');
      if (idx === -1) break;
      responses.push(remaining.substring(0, idx + 2));
      remaining = remaining.substring(idx + 2);
    } else if (remaining.startsWith('$')) {
      // Bulk string: $len\r\ndata\r\n or $-1\r\n
      const idx = remaining.indexOf('\r\n');
      if (idx === -1) break;
      const lenStr = remaining.substring(1, idx);
      const len = parseInt(lenStr, 10);
      if (len === -1) {
        responses.push(remaining.substring(0, idx + 2));
        remaining = remaining.substring(idx + 2);
      } else {
        const endIdx = idx + 2 + len + 2; // $len\r\ndata\r\n
        if (endIdx > remaining.length) break;
        responses.push(remaining.substring(0, endIdx));
        remaining = remaining.substring(endIdx);
      }
    } else if (remaining.startsWith('*')) {
      // Array: *count\r\n followed by count elements
      const idx = remaining.indexOf('\r\n');
      if (idx === -1) break;
      const count = parseInt(remaining.substring(1, idx), 10);
      if (isNaN(count)) break;
      let pos = idx + 2;
      let valid = true;
      for (let i = 0; i < count; i++) {
        if (pos >= remaining.length) {
          valid = false;
          break;
        }
        if (remaining[pos] === '$') {
          const lenIdx = remaining.indexOf('\r\n', pos);
          if (lenIdx === -1) {
            valid = false;
            break;
          }
          const blen = parseInt(remaining.substring(pos + 1, lenIdx), 10);
          if (isNaN(blen)) {
            valid = false;
            break;
          }
          if (blen === -1) {
            pos = lenIdx + 2;
          } else {
            pos = lenIdx + 2 + blen + 2;
          }
        } else if (remaining[pos] === '+' || remaining[pos] === '-' || remaining[pos] === ':') {
          const eolIdx = remaining.indexOf('\r\n', pos);
          if (eolIdx === -1) {
            valid = false;
            break;
          }
          pos = eolIdx + 2;
        } else {
          valid = false;
          break;
        }
      }
      if (!valid || pos > remaining.length) break;
      responses.push(remaining.substring(0, pos));
      remaining = remaining.substring(pos);
    } else {
      break;
    }
  }

  return responses;
}

describe('handleConnection', () => {
  let server: net.Server;
  let port: number;
  let baseCount: number;
  let clients: net.Socket[];

  beforeEach(async () => {
    clients = [];
    baseCount = getActiveConnectionCount();
    const storage = new InMemoryStorage();
    const pubsub = new PubSubManager();
    const connectionHandler = createConnectionHandler(storage, pubsub);
    server = net.createServer((socket) => connectionHandler(socket));
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

  it('TCP E2E — PING 명령어 왕복', async () => {
    const client = await connectClient(port);
    clients.push(client);

    const response = await sendAndReceive(client, 'PING\r\n');
    expect(response).toBe('+PONG\r\n');
  });

  it('TCP E2E — SET/GET 명령어 왕복', async () => {
    const client = await connectClient(port);
    clients.push(client);

    const setResponse = await sendAndReceive(client, 'SET mykey myvalue\r\n');
    expect(setResponse).toBe('+OK\r\n');

    const getResponse = await sendAndReceive(client, 'GET mykey\r\n');
    expect(getResponse).toBe('$7\r\nmyvalue\r\n');
  });

  it('TCP E2E — 존재하지 않는 키 GET (null bulk string 응답)', async () => {
    const client = await connectClient(port);
    clients.push(client);

    const response = await sendAndReceive(client, 'GET nonexistent\r\n');
    expect(response).toBe('$-1\r\n');
  });

  it('TCP E2E — 지원하지 않는 명령어 에러 응답', async () => {
    const client = await connectClient(port);
    clients.push(client);

    const response = await sendAndReceive(client, 'FOOBAR\r\n');
    expect(response).toBe("-ERR unknown command 'FOOBAR'\r\n");
  });

  it('TCP E2E — RESP 배열 형식 커맨드 전송', async () => {
    const client = await connectClient(port);
    clients.push(client);

    const response = await sendAndReceive(client, '*1\r\n$4\r\nPING\r\n');
    expect(response).toBe('+PONG\r\n');
  });

  it('TCP E2E — 멀티커맨드 파이프라인', async () => {
    const client = await connectClient(port);
    clients.push(client);

    // Send PING and SET commands together as a pipeline
    const pipeline = '*1\r\n$4\r\nPING\r\n*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n';
    const responsePromise = collectResponses(client, 2);
    await sendCommand(client, pipeline);
    const responses = await responsePromise;

    expect(responses.length).toBeGreaterThanOrEqual(2);
    expect(responses[0]).toBe('+PONG\r\n');
    expect(responses[1]).toBe('+OK\r\n');
  });

  it('커넥션 카운트 — 연결/해제 시 getActiveConnectionCount 변경', async () => {
    const initialCount = getActiveConnectionCount();

    const client1 = await connectClient(port);
    clients.push(client1);
    await delay(100);
    expect(getActiveConnectionCount()).toBe(initialCount + 1);

    const client2 = await connectClient(port);
    clients.push(client2);
    await delay(100);
    expect(getActiveConnectionCount()).toBe(initialCount + 2);

    // Destroy client1
    const closePromise = new Promise<void>((resolve) => {
      client1.on('close', () => resolve());
    });
    client1.destroy();
    await closePromise;
    await delay(100);
    expect(getActiveConnectionCount()).toBe(initialCount + 1);
  });

  it('다중 클라이언트 동시 연결 — 독립적으로 명령 처리', async () => {
    const client1 = await connectClient(port);
    const client2 = await connectClient(port);
    const client3 = await connectClient(port);
    clients.push(client1, client2, client3);

    await delay(100);

    // Each client independently executes SET/GET
    // Client 1: SET key1 value1
    const response1_p = sendAndReceive(client1, 'SET key1 value1\r\n');
    // Client 2: SET key2 value2
    const response2_p = sendAndReceive(client2, 'SET key2 value2\r\n');
    // Client 3: PING
    const response3_p = sendAndReceive(client3, 'PING\r\n');

    const [response1, response2, response3] = await Promise.all([
      response1_p,
      response2_p,
      response3_p,
    ]);

    expect(response1).toBe('+OK\r\n');
    expect(response2).toBe('+OK\r\n');
    expect(response3).toBe('+PONG\r\n');

    // Verify GET works for each key via different client
    const getResponse = await sendAndReceive(client1, 'GET key2\r\n');
    expect(getResponse).toBe('$6\r\nvalue2\r\n');
  });
});

describe('getActiveConnectionCount', () => {
  it('초기 활성 연결 수를 반환한다', () => {
    const count = getActiveConnectionCount();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

describe('소켓 이벤트 핸들링', () => {
  let storage: InMemoryStorage;
  let pubsub: PubSubManager;
  let handler: (socket: net.Socket) => void;

  beforeEach(() => {
    storage = new InMemoryStorage();
    pubsub = new PubSubManager();
    handler = createConnectionHandler(storage, pubsub);
  });

  it('소켓 에러 이벤트 — error 이벤트 발생 시 서버 크래시 없이 처리', () => {
    const mockSocket = new EventEmitter() as unknown as net.Socket;
    (mockSocket as any).remoteAddress = '127.0.0.1';
    (mockSocket as any).remotePort = 12345;
    (mockSocket as any).setTimeout = vi.fn();
    (mockSocket as any).destroy = vi.fn();
    (mockSocket as any).write = vi.fn();
    (mockSocket as any).destroyed = false;

    // Call the handler with the mock socket
    handler(mockSocket);

    const beforeCount = getActiveConnectionCount();

    // Emit error event on the mock socket
    // Should not throw — just logs the error
    expect(() => {
      mockSocket.emit('error', new Error('test socket error'));
    }).not.toThrow();

    // Connection should still be tracked (error doesn't remove from activeSockets)
    expect(getActiveConnectionCount()).toBe(beforeCount);
  });

  it('소켓 timeout 이벤트 — timeout 발생 시 socket.destroy 호출', () => {
    const mockSocket = new EventEmitter() as unknown as net.Socket;
    (mockSocket as any).remoteAddress = '127.0.0.1';
    (mockSocket as any).remotePort = 12346;
    (mockSocket as any).setTimeout = vi.fn();
    (mockSocket as any).destroy = vi.fn();
    (mockSocket as any).write = vi.fn();
    (mockSocket as any).destroyed = false;

    handler(mockSocket);

    // Verify setTimeout was called with 300000ms (5 minutes)
    expect((mockSocket as any).setTimeout).toHaveBeenCalledWith(300000);

    // Emit timeout event
    mockSocket.emit('timeout');

    // Destroy should have been called
    expect((mockSocket as any).destroy).toHaveBeenCalled();
  });

  it('소켓 close 이벤트 — 연결 해제 시 activeSockets에서 제거', () => {
    const mockSocket = new EventEmitter() as unknown as net.Socket;
    (mockSocket as any).remoteAddress = '127.0.0.1';
    (mockSocket as any).remotePort = 12347;
    (mockSocket as any).setTimeout = vi.fn();
    (mockSocket as any).destroy = vi.fn();
    (mockSocket as any).write = vi.fn();
    (mockSocket as any).destroyed = false;

    const beforeCount = getActiveConnectionCount();

    handler(mockSocket);

    // Socket should be added to active connections
    expect(getActiveConnectionCount()).toBe(beforeCount + 1);

    // Emit close event
    mockSocket.emit('close');

    // Socket should be removed
    expect(getActiveConnectionCount()).toBe(beforeCount);
  });
});
