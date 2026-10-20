import { TestBed } from '@angular/core/testing';
import { AuthService } from '@core/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalRService } from './signalr.service';

interface FakeHub {
  handlers: Record<string, (...args: string[]) => void>;
  reconnected?: () => void;
  on: ReturnType<typeof vi.fn>;
  onreconnected: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const hub = vi.hoisted(() => ({
  instances: [] as unknown[],
  builderUrl: [] as { url: string; options: { accessTokenFactory: () => string } }[],
  reconnect: vi.fn(),
  startImpl: undefined as undefined | (() => Promise<void>),
  stopImpl: undefined as undefined | (() => Promise<void>),
}));

vi.mock('@microsoft/signalr', () => {
  class HubConnectionBuilder {
    private options!: { accessTokenFactory: () => string };
    private url = '';

    public withUrl(url: string, options: { accessTokenFactory: () => string }): this {
      this.url = url;
      this.options = options;
      hub.builderUrl.push({ url, options });
      return this;
    }

    public withAutomaticReconnect(): this {
      hub.reconnect();
      return this;
    }

    public build(): FakeHub {
      const instance: FakeHub = {
        handlers: {},
        on: vi.fn((name: string, cb: (...args: string[]) => void) => {
          instance.handlers[name] = cb;
        }),
        onreconnected: vi.fn((cb: () => void) => {
          instance.reconnected = cb;
        }),
        start: vi.fn(() => (hub.startImpl ? hub.startImpl() : Promise.resolve())),
        stop: vi.fn(() => (hub.stopImpl ? hub.stopImpl() : Promise.resolve())),
      };
      hub.instances.push(instance);
      return instance;
    }
  }
  return { HubConnectionBuilder };
});

describe('SignalRService', () => {
  let service: SignalRService;
  let token: string | null;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const instances = (): FakeHub[] => hub.instances as FakeHub[];

  beforeEach(() => {
    hub.instances.length = 0;
    hub.builderUrl.length = 0;
    hub.reconnect.mockReset();
    hub.startImpl = undefined;
    hub.stopImpl = undefined;
    token = 'jwt-token';
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { getToken: () => token } }],
    });
    service = TestBed.inject(SignalRService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a connection to the dashboard hub URL with automatic reconnect', () => {
    service.startDashboardHub();

    expect(hub.builderUrl).toHaveLength(1);
    expect(hub.builderUrl[0].url).toBe('http://localhost:5282/hubs/dashboard');
    expect(hub.builderUrl[0].options.accessTokenFactory()).toBe('jwt-token');
    expect(hub.reconnect).toHaveBeenCalledTimes(1);
    expect(instances()[0].start).toHaveBeenCalledTimes(1);
  });

  it('uses an empty access token when there is no token', () => {
    token = null;

    service.startDashboardHub();

    expect(hub.builderUrl[0].options.accessTokenFactory()).toBe('');
  });

  it('shares a single connection between multiple starts', () => {
    service.startDashboardHub();
    service.startDashboardHub();

    expect(instances()).toHaveLength(1);
    expect(instances()[0].start).toHaveBeenCalledTimes(1);
  });

  it('emits dashboardUpdated when the hub raises DashboardUpdated', () => {
    const next = vi.fn();
    service.dashboardUpdated.subscribe(next);
    service.startDashboardHub();

    instances()[0].handlers['DashboardUpdated']();
    instances()[0].handlers['DashboardUpdated']();

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('emits the order id on OrderUpdated and ignores empty ids', () => {
    const next = vi.fn();
    service.orderUpdated.subscribe(next);
    service.startDashboardHub();

    instances()[0].handlers['OrderUpdated']('order-1');
    instances()[0].handlers['OrderUpdated']('');

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith('order-1');
  });

  it('only stops the connection when the last consumer stops', () => {
    service.startDashboardHub();
    service.startDashboardHub();
    const connection = instances()[0];

    service.stopDashboardHub();
    expect(connection.stop).not.toHaveBeenCalled();

    service.stopDashboardHub();
    expect(connection.stop).toHaveBeenCalledTimes(1);
  });

  it('creates a fresh connection after the hub was stopped', async () => {
    service.startDashboardHub();
    await vi.waitFor(() => expect(instances()[0].start).toHaveBeenCalled());
    await Promise.resolve();
    service.stopDashboardHub();
    service.startDashboardHub();

    expect(instances()).toHaveLength(2);
  });

  it('creates a fresh connection when restarted before the first connect settles', () => {
    service.startDashboardHub();
    service.stopDashboardHub();
    service.startDashboardHub();

    expect(instances()).toHaveLength(2);
  });

  it('does nothing when stopping without a started hub', () => {
    service.stopDashboardHub();
    service.stopDashboardHub();

    expect(instances()).toHaveLength(0);

    service.startDashboardHub();
    service.stopDashboardHub();
    expect(instances()[0].stop).toHaveBeenCalledTimes(1);
  });

  it('logs start failures and allows a retry', async () => {
    hub.startImpl = () => Promise.reject(new Error('offline'));
    service.startDashboardHub();
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

    expect(errorSpy.mock.calls[0][0]).toBe('Dashboard SignalR hub connection error:');

    // The dead connection is dropped, so a further start creates a new one.
    service.startDashboardHub();
    expect(instances()).toHaveLength(2);
  });

  it('logs stop failures without throwing', async () => {
    hub.stopImpl = () => Promise.reject(new Error('stop failed'));
    service.startDashboardHub();

    service.stopDashboardHub();
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

    expect(errorSpy.mock.calls[0][0]).toBe('Error stopping dashboard hub:');
  });

  it('stops the hub and completes both streams on destroy', () => {
    const dashboardDone = vi.fn();
    const orderDone = vi.fn();
    service.dashboardUpdated.subscribe({ complete: dashboardDone });
    service.orderUpdated.subscribe({ complete: orderDone });
    service.startDashboardHub();

    TestBed.resetTestingModule();

    expect(instances()[0].stop).toHaveBeenCalledTimes(1);
    expect(dashboardDone).toHaveBeenCalledTimes(1);
    expect(orderDone).toHaveBeenCalledTimes(1);
  });
  describe('staff orders hub (chat)', () => {
    it('connects to its own hub, not the dashboard one, with the sign-in token', () => {
      service.startStaffOrdersHub();

      expect(hub.builderUrl).toHaveLength(1);
      expect(hub.builderUrl[0].url).toBe('http://localhost:5282/hubs/staff-orders');
      expect(hub.builderUrl[0].options.accessTokenFactory()).toBe('jwt-token');
      expect(hub.reconnect).toHaveBeenCalledTimes(1);
      expect(instances()[0].start).toHaveBeenCalledTimes(1);
    });

    it('reads the token again on every connect, so a refreshed sign-in is used', () => {
      service.startStaffOrdersHub();
      token = 'newer-token';

      expect(hub.builderUrl[0].options.accessTokenFactory()).toBe('newer-token');
    });

    it('uses an empty token when signed out', () => {
      token = null;
      service.startStaffOrdersHub();

      expect(hub.builderUrl[0].options.accessTokenFactory()).toBe('');
    });

    it('is a separate connection from the dashboard hub', () => {
      service.startDashboardHub();
      service.startStaffOrdersHub();

      expect(instances()).toHaveLength(2);
      expect(hub.builderUrl.map((b) => b.url)).toEqual([
        'http://localhost:5282/hubs/dashboard',
        'http://localhost:5282/hubs/staff-orders',
      ]);
    });

    it('shares one connection between consumers and stops with the last one', () => {
      service.startStaffOrdersHub();
      service.startStaffOrdersHub();
      const connection = instances()[0];
      expect(instances()).toHaveLength(1);

      service.stopStaffOrdersHub();
      expect(connection.stop).not.toHaveBeenCalled();

      service.stopStaffOrdersHub();
      expect(connection.stop).toHaveBeenCalledTimes(1);
    });

    it('tells which conversation and order a new message belongs to', () => {
      const next = vi.fn();
      service.orderMessage.subscribe(next);
      service.startStaffOrdersHub();

      instances()[0].handlers['OrderMessageReceived']('c1', 'o1');

      expect(next).toHaveBeenCalledWith({ conversationId: 'c1', orderId: 'o1' });
    });

    it('tells when a chat was read', () => {
      const next = vi.fn();
      service.conversationRead.subscribe(next);
      service.startStaffOrdersHub();

      instances()[0].handlers['ConversationRead']('c1', 'o1');

      expect(next).toHaveBeenCalledWith({ conversationId: 'c1', orderId: 'o1' });
    });

    it('logs a failed start and tries again later on the same connection', async () => {
      vi.useFakeTimers();
      try {
        const start = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
        hub.startImpl = start;
        service.startStaffOrdersHub();
        await vi.advanceTimersByTimeAsync(0);

        expect(errorSpy.mock.calls[0][0]).toBe('Staff orders SignalR hub connection error:');
        expect(start).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(2000);

        expect(start).toHaveBeenCalledTimes(2);
        expect(instances()).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops trying again once the hub is stopped', async () => {
      vi.useFakeTimers();
      try {
        const start = vi.fn().mockRejectedValue(new Error('offline'));
        hub.startImpl = start;
        service.startStaffOrdersHub();
        await vi.advanceTimersByTimeAsync(0);
        service.stopStaffOrdersHub();
        await vi.advanceTimersByTimeAsync(60000);

        expect(start).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs a failed stop without throwing', async () => {
      hub.stopImpl = () => Promise.reject(new Error('stop failed'));
      service.startStaffOrdersHub();

      service.stopStaffOrdersHub();
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

      expect(errorSpy.mock.calls[0][0]).toBe('Error stopping staff orders hub:');
    });

    it('does nothing when stopping without a start, and stops both hubs on destroy', () => {
      service.stopStaffOrdersHub();
      expect(instances()).toHaveLength(0);

      service.startDashboardHub();
      service.startStaffOrdersHub();
      TestBed.resetTestingModule();

      expect(instances().every((connection) => (connection.stop as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
    });
  });
  describe('notifications hub (bell and stock)', () => {
    it('connects to its own hub with the sign-in token, read again at every connect', () => {
      service.startNotificationsHub();

      expect(hub.builderUrl[0].url).toBe('http://localhost:5282/hubs/notifications');
      expect(hub.builderUrl[0].options.accessTokenFactory()).toBe('jwt-token');
      token = 'refreshed';
      expect(hub.builderUrl[0].options.accessTokenFactory()).toBe('refreshed');
      expect(hub.reconnect).toHaveBeenCalledTimes(1);
      expect(instances()[0].start).toHaveBeenCalledTimes(1);
    });

    it('shares one connection between consumers and stops with the last one', () => {
      service.startNotificationsHub();
      service.startNotificationsHub();
      expect(instances()).toHaveLength(1);

      service.stopNotificationsHub();
      expect(instances()[0].stop).not.toHaveBeenCalled();
      service.stopNotificationsHub();
      expect(instances()[0].stop).toHaveBeenCalledTimes(1);
    });

    it('says when the notifications changed', () => {
      const next = vi.fn();
      service.notificationsChanged.subscribe(next);
      service.startNotificationsHub();

      instances()[0].handlers['NotificationsChanged']();

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('says which item changed in stock', () => {
      const next = vi.fn();
      service.stockChanged.subscribe(next);
      service.startNotificationsHub();

      instances()[0].handlers['StockChanged']('item-1');

      expect(next).toHaveBeenCalledWith('item-1');
    });

    it('tells screens to reload everything after a dropped connection comes back', () => {
      const notifications = vi.fn();
      const stock = vi.fn();
      service.notificationsChanged.subscribe(notifications);
      service.stockChanged.subscribe(stock);
      service.startNotificationsHub();

      instances()[0].reconnected?.();

      expect(notifications).toHaveBeenCalledTimes(1);
      expect(stock).toHaveBeenCalledTimes(1);
    });

    it('logs a failed start and tries again later on the same connection', async () => {
      vi.useFakeTimers();
      try {
        const start = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
        hub.startImpl = start;
        service.startNotificationsHub();
        await vi.advanceTimersByTimeAsync(0);

        expect(errorSpy.mock.calls[0][0]).toBe('Notifications SignalR hub connection error:');
        await vi.advanceTimersByTimeAsync(2000);

        expect(start).toHaveBeenCalledTimes(2);
        expect(instances()).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops trying again once the hub is stopped', async () => {
      vi.useFakeTimers();
      try {
        const start = vi.fn().mockRejectedValue(new Error('offline'));
        hub.startImpl = start;
        service.startNotificationsHub();
        await vi.advanceTimersByTimeAsync(0);
        service.stopNotificationsHub();
        await vi.advanceTimersByTimeAsync(60000);

        expect(start).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs a failed stop without throwing, and does nothing when stopping without a start', async () => {
      service.stopNotificationsHub();
      expect(instances()).toHaveLength(0);

      hub.stopImpl = () => Promise.reject(new Error('stop failed'));
      service.startNotificationsHub();
      service.stopNotificationsHub();
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

      expect(errorSpy.mock.calls[0][0]).toBe('Error stopping notifications hub:');
    });
  });
});
