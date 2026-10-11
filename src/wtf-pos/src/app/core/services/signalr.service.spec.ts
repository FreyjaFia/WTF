import { TestBed } from '@angular/core/testing';
import { AuthService } from '@core/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalRService } from './signalr.service';

interface FakeHub {
  handlers: Record<string, (...args: string[]) => void>;
  on: ReturnType<typeof vi.fn>;
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
});
