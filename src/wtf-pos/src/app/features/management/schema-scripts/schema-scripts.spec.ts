import { TestBed } from '@angular/core/testing';
import { AlertService, SchemaScriptHistoryService } from '@core/services';
import { SchemaScriptHistoryDto } from '@shared/models';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchemaScriptsComponent } from './schema-scripts';

const SCRIPTS: SchemaScriptHistoryDto[] = [
  { id: 1, scriptName: '001_init.sql', appliedAt: '2026-01-02T03:04:05Z' },
  { id: 2, scriptName: '002_items.sql', appliedAt: '2026-02-03T04:05:06Z' },
];

describe('SchemaScriptsComponent', () => {
  let service: { getExecutedScripts: ReturnType<typeof vi.fn> };
  let alerts: { error: ReturnType<typeof vi.fn> };

  function create() {
    TestBed.configureTestingModule({
      providers: [
        { provide: SchemaScriptHistoryService, useValue: service },
        { provide: AlertService, useValue: alerts },
      ],
    });
    const fixture = TestBed.createComponent(SchemaScriptsComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    service = { getExecutedScripts: vi.fn(() => of(SCRIPTS)) };
    alerts = { error: vi.fn() };
  });

  it('loads scripts on init and renders one row per script', () => {
    const fixture = create();
    const el: HTMLElement = fixture.nativeElement;
    expect(service.getExecutedScripts).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('001_init.sql');
    expect(el.textContent).toContain('002_items.sql');
    expect(el.textContent).toContain('2026-01-02');
  });

  it('shows the empty state when there are no scripts', () => {
    service.getExecutedScripts.mockReturnValue(of([]));
    const fixture = create();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No scripts found');
  });

  it('shows a spinner while loading', () => {
    const pending = new Subject<SchemaScriptHistoryDto[]>();
    service.getExecutedScripts.mockReturnValue(pending);
    const fixture = create();
    expect((fixture.nativeElement as HTMLElement).querySelector('.loading')).not.toBeNull();
    pending.next(SCRIPTS);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.loading')).toBeNull();
  });

  it('alerts and stops loading on error', () => {
    service.getExecutedScripts.mockReturnValue(throwError(() => new Error('boom')));
    const fixture = create();
    expect(alerts.error).toHaveBeenCalledWith('boom');
    expect((fixture.nativeElement as HTMLElement).querySelector('.loading')).toBeNull();
  });

  it('reloads when the refresh button is clicked and clears the refreshing flag', () => {
    const fixture = create();
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button[aria-label="Refresh schema scripts"]',
    ) as HTMLButtonElement;
    button.click();
    expect(service.getExecutedScripts).toHaveBeenCalledTimes(2);
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
  });
});
