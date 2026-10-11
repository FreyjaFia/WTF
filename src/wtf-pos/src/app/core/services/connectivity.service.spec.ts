import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '@environments/environment.development';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectivityService, ConnectivityState } from './connectivity.service';

describe('ConnectivityService', () => {
  const healthUrl = `${environment.apiUrl.replace(/\/$/, '')}/health`;
  let http: HttpTestingController;
  let service: ConnectivityService;

  const settle = () => vi.advanceTimersByTimeAsync(0);

  function create(): ConnectivityService {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(ConnectivityService);
  }

  /** Answers the pending health request, then lets the async check finish. */
  async function answerHealth(ok: boolean): Promise<void> {
    await settle();
    const req = http.expectOne(healthUrl);
    if (ok) {
      req.flush('ok');
    } else {
      req.flush('down', { status: 503, statusText: 'Unavailable' });
    }
    await settle();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts as SERVER_UNREACHABLE when the browser is online, then verifies the API', async () => {
    service = create();
    expect(service.state()).toBe(ConnectivityState.SERVER_UNREACHABLE);
    expect(service.isOnline()).toBe(false);

    await answerHealth(true);

    expect(service.state()).toBe(ConnectivityState.ONLINE);
    expect(service.isOnline()).toBe(true);
    expect(service.canSendOrders()).toBe(true);
    expect(service.lastSuccessfulApiCheckAt()).toBe(Date.now());
  });

  it('starts OFFLINE when the browser reports offline, without calling the API', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    service = create();
    expect(service.state()).toBe(ConnectivityState.OFFLINE);

    await settle();

    http.expectNone(healthUrl);
    expect(service.state()).toBe(ConnectivityState.OFFLINE);
    expect(service.canSendOrders()).toBe(false);
  });

  it('reports SERVER_UNREACHABLE when the health check fails', async () => {
    service = create();

    await answerHealth(false);

    expect(service.state()).toBe(ConnectivityState.SERVER_UNREACHABLE);
    expect(service.canSendOrders()).toBe(false);
    expect(service.lastSuccessfulApiCheckAt()).toBeNull();
  });

  it('treats a health check that never answers as unreachable after 3 seconds', async () => {
    service = create();
    await settle();
    http.expectOne(healthUrl);

    await vi.advanceTimersByTimeAsync(3000);

    expect(service.state()).toBe(ConnectivityState.SERVER_UNREACHABLE);
  });

  it('goes OFFLINE on the browser offline event', async () => {
    service = create();
    await answerHealth(true);

    window.dispatchEvent(new Event('offline'));

    expect(service.state()).toBe(ConnectivityState.OFFLINE);
    expect(service.isOnline()).toBe(false);
  });

  it('re-verifies the API on the browser online event', async () => {
    service = create();
    await answerHealth(false);

    window.dispatchEvent(new Event('online'));
    await answerHealth(true);

    expect(service.state()).toBe(ConnectivityState.ONLINE);
  });

  it('shows "reconnected" for 3 seconds after recovering from a loss', async () => {
    service = create();
    await answerHealth(true);
    expect(service.showReconnected()).toBe(false);

    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    await answerHealth(true);

    expect(service.showReconnected()).toBe(true);
    await vi.advanceTimersByTimeAsync(2999);
    expect(service.showReconnected()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.showReconnected()).toBe(false);
  });

  it('does not show "reconnected" for the first successful check', async () => {
    service = create();

    await answerHealth(true);

    expect(service.showReconnected()).toBe(false);
  });

  it('hides "reconnected" immediately if the connection drops again', async () => {
    service = create();
    await answerHealth(true);
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    await answerHealth(true);
    expect(service.showReconnected()).toBe(true);

    window.dispatchEvent(new Event('offline'));

    expect(service.showReconnected()).toBe(false);
  });

  describe('checkNow throttling', () => {
    it('ignores a second manual check within 3 seconds, allows it after', async () => {
      service = create();
      await answerHealth(false);

      service.checkNow();
      await answerHealth(true);
      expect(service.state()).toBe(ConnectivityState.ONLINE);

      window.dispatchEvent(new Event('offline'));
      service.checkNow();
      await settle();
      http.expectNone(healthUrl);

      await vi.advanceTimersByTimeAsync(3000);
      service.checkNow();
      await answerHealth(true);
      expect(service.state()).toBe(ConnectivityState.ONLINE);
    });

    it('does not start a second check while one is in flight', async () => {
      service = create();
      await settle();
      const first = http.expectOne(healthUrl);

      service.verifyConnection(true);
      await settle();

      http.expectNone(healthUrl);
      first.flush('ok');
      await settle();
      expect(service.state()).toBe(ConnectivityState.ONLINE);
    });
  });

  describe('offline re-check schedule', () => {
    it('re-checks every 5 seconds while not online', async () => {
      service = create();
      await answerHealth(false);

      await vi.advanceTimersByTimeAsync(5000);
      await answerHealth(true);

      expect(service.state()).toBe(ConnectivityState.ONLINE);
    });

    it('stops re-checking once online', async () => {
      service = create();
      await answerHealth(true);

      await vi.advanceTimersByTimeAsync(20000);

      http.expectNone(healthUrl);
    });

    it('stops its timers on destroy and detaches the window listeners', async () => {
      service = create();
      await answerHealth(false);

      TestBed.resetTestingModule();
      await vi.advanceTimersByTimeAsync(20000);
      window.dispatchEvent(new Event('offline'));

      expect(service.state()).toBe(ConnectivityState.SERVER_UNREACHABLE);
    });
  });
});
