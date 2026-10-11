import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicOrderHubService } from './public-order-hub.service';

interface FakeHub {
  handlers: Record<string, (...args: string[]) => void>;
  on: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const hub = vi.hoisted(() => ({
  instances: [] as unknown[],
  builder: [] as { url: string; options: { accessTokenFactory: () => string } }[],
  startImpl: undefined as undefined | (() => Promise<void>),
}));

vi.mock('@microsoft/signalr', () => {
  class HubConnectionBuilder {
    public withUrl(url: string, options: { accessTokenFactory: () => string }): this {
      hub.builder.push({ url, options });
      return this;
    }

    public withAutomaticReconnect(): this {
      return this;
    }

    public build(): FakeHub {
      const instance: FakeHub = {
        handlers: {},
        on: vi.fn((name: string, cb: (...args: string[]) => void) => {
          instance.handlers[name] = cb;
        }),
        start: vi.fn(() => (hub.startImpl ? hub.startImpl() : Promise.resolve())),
        stop: vi.fn(() => Promise.resolve()),
      };
      hub.instances.push(instance);
      return instance;
    }
  }
  return { HubConnectionBuilder };
});

describe('PublicOrderHubService', () => {
  let service: PublicOrderHubService;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const instances = (): FakeHub[] => hub.instances as FakeHub[];

  beforeEach(() => {
    hub.instances.length = 0;
    hub.builder.length = 0;
    hub.startImpl = undefined;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    service = TestBed.inject(PublicOrderHubService);
  });

  afterEach(() => vi.restoreAllMocks());

  it('connects to the customer hub with the link token as the only credential', () => {
    service.connect('tok-1');

    expect(hub.builder[0].url).toBe('http://localhost:5282/hubs/customer-orders');
    expect(hub.builder[0].options.accessTokenFactory()).toBe('tok-1');
    expect(instances()[0].start).toHaveBeenCalledTimes(1);
  });

  it('keeps one connection for the same token, and replaces it for another', () => {
    service.connect('tok-1');
    service.connect('tok-1');
    expect(instances()).toHaveLength(1);

    service.connect('tok-2');
    expect(instances()).toHaveLength(2);
    expect(instances()[0].stop).toHaveBeenCalledTimes(1);
  });

  it('only ever listens: it registers handlers and sends nothing', () => {
    service.connect('tok-1');

    expect(Object.keys(instances()[0].handlers).sort()).toEqual([
      'ConversationRead',
      'LinkRevoked',
      'OrderMessageReceived',
      'OrderStatusChanged',
    ]);
    expect(instances()[0]).not.toHaveProperty('invoke');
    expect(instances()[0]).not.toHaveProperty('send');
  });

  it('passes on a new message with its conversation and order', () => {
    const next = vi.fn();
    service.orderMessage.subscribe(next);
    service.connect('tok-1');

    instances()[0].handlers['OrderMessageReceived']('c1', 'o1');

    expect(next).toHaveBeenCalledWith({ conversationId: 'c1', orderId: 'o1' });
  });

  it('passes on a chat that was read', () => {
    const next = vi.fn();
    service.conversationRead.subscribe(next);
    service.connect('tok-1');

    instances()[0].handlers['ConversationRead']('c1', 'o1');

    expect(next).toHaveBeenCalledWith({ conversationId: 'c1', orderId: 'o1' });
  });

  it('passes on the order that changed, and ignores an empty id', () => {
    const next = vi.fn();
    service.orderStatusChanged.subscribe(next);
    service.connect('tok-1');

    instances()[0].handlers['OrderStatusChanged']('o1');
    instances()[0].handlers['OrderStatusChanged']('');

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith('o1');
  });

  it('tells the page when the link was revoked, and closes the connection', () => {
    const next = vi.fn();
    service.linkRevoked.subscribe(next);
    service.connect('tok-1');
    const connection = instances()[0];

    connection.handlers['LinkRevoked']();

    expect(next).toHaveBeenCalledTimes(1);
    expect(connection.stop).toHaveBeenCalledTimes(1);
  });

  it('can connect again after a revoked link or a disconnect', () => {
    service.connect('tok-1');
    service.disconnect();
    service.connect('tok-1');

    expect(instances()).toHaveLength(2);
  });

  it('logs a failed connection and tries again later on the same connection', async () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValue(undefined);
      hub.startImpl = start;
      service.connect('tok-1');
      await vi.advanceTimersByTimeAsync(0);

      expect(errorSpy.mock.calls[0][0]).toBe('Customer orders hub connection error:');
      expect(start).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);

      expect(start).toHaveBeenCalledTimes(2);
      expect(instances()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops trying again once disconnected', async () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn().mockRejectedValue(new Error('refused'));
      hub.startImpl = start;
      service.connect('tok-1');
      await vi.advanceTimersByTimeAsync(0);
      service.disconnect();
      await vi.advanceTimersByTimeAsync(60000);

      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when disconnecting without a connection', () => {
    service.disconnect();

    expect(instances()).toHaveLength(0);
  });

  it('closes the connection and the streams on destroy', () => {
    const done = vi.fn();
    service.orderMessage.subscribe({ complete: done });
    service.connect('tok-1');

    TestBed.resetTestingModule();

    expect(instances()[0].stop).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
