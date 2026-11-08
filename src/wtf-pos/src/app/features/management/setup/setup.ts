import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorMessages } from '@core/messages';
import {
  AlertService,
  AuthService,
  CatalogSetupService,
  SupplierService,
  WasteReasonService,
} from '@core/services';
import { ConnectionErrorComponent } from '@shared/components';
import { PullToRefreshComponent } from '@shared/components/pull-to-refresh/pull-to-refresh';
import { AppRoutes } from '@shared/constants/app-routes';
import { CatalogSetupDto } from '@shared/models';
import { map } from 'rxjs';
import { CatalogComponent, CatalogSection } from '../catalog/catalog';
import { WasteReasonsComponent } from '../waste-reasons/waste-reasons';
import { SetupKind, SetupKindId, visibleSetupKinds } from './setup-kinds';

@Component({
  selector: 'app-setup',
  imports: [
    RouterLink,
    ConnectionErrorComponent,
    PullToRefreshComponent,
    CatalogComponent,
    WasteReasonsComponent,
  ],
  templateUrl: './setup.html',
  host: { class: 'flex-1 min-h-0' },
})
export class SetupComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly alertService = inject(AlertService);
  private readonly catalogService = inject(CatalogSetupService);
  private readonly wasteReasonService = inject(WasteReasonService);
  private readonly supplierService = inject(SupplierService);

  protected readonly setupRoute = AppRoutes.ManagementSetup;

  protected readonly kinds = computed(() => visibleSetupKinds(this.authService));
  protected readonly kindId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('kind'))),
    { initialValue: this.route.snapshot.paramMap.get('kind') },
  );
  protected readonly current = computed<SetupKind | null>(() => {
    const id = this.kindId();
    return this.kinds().find((kind) => kind.id === id) ?? null;
  });
  protected readonly catalogSection = computed<CatalogSection | null>(() => {
    const id = this.current()?.id;
    return id === 'categories' || id === 'subcategories' || id === 'addon-types' ? id : null;
  });
  protected readonly groups = computed(() => {
    const descriptions: Record<string, string> = {
      Menu: 'How products are grouped and the choices a customer can add to a drink.',
      Inventory: 'Suppliers, and the reasons staff choose when they record stock losses.',
    };
    const groups: { name: string; description: string; kinds: SetupKind[] }[] = [];
    for (const kind of this.kinds()) {
      const group = groups.find((g) => g.name === kind.group);
      if (group) {
        group.kinds.push(kind);
      } else {
        groups.push({ name: kind.group, description: descriptions[kind.group] ?? '', kinds: [kind] });
      }
    }
    return groups;
  });

  protected readonly connectionFailed = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly counts = signal<Partial<Record<SetupKindId, number>>>({});

  public ngOnInit(): void {
    // A kind the role cannot open (or a mistyped one) goes back to the hub.
    if (this.kindId() && !this.current()) {
      void this.router.navigate([this.setupRoute], { replaceUrl: true });
      return;
    }

    if (!this.kindId()) {
      this.loadCounts();
    }
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadCounts();
  }

  protected countText(kind: SetupKind): string {
    const count = this.counts()[kind.id];
    return count === undefined ? '' : `${count} active`;
  }

  private loadCounts(): void {
    this.connectionFailed.set(false);
    let pending = 0;
    const done = (): void => {
      pending -= 1;
      if (pending <= 0) {
        this.isRefreshing.set(false);
      }
    };
    if (this.authService.canReadProducts()) {
      pending += 1;
      this.catalogService.getSetup().subscribe({
        next: (setup) => {
          this.setCatalogCounts(setup);
          done();
        },
        error: (err: Error) => {
          this.onLoadError(err);
          done();
        },
      });
    }

    if (this.authService.canManageWasteReasons()) {
      pending += 1;
      this.wasteReasonService.getReasons().subscribe({
        next: (reasons) => {
          this.counts.update((c) => ({
            ...c,
            'waste-reasons': reasons.filter((r) => r.isActive).length,
          }));
          done();
        },
        error: (err: Error) => {
          this.onLoadError(err);
          done();
        },
      });
    }

    if (this.authService.canReadStockMovements()) {
      pending += 1;
      this.supplierService.getSuppliers().subscribe({
        next: (suppliers) => {
          this.counts.update((c) => ({ ...c, suppliers: suppliers.length }));
          done();
        },
        error: (err: Error) => {
          this.onLoadError(err);
          done();
        },
      });
    }
  }

  private onLoadError(err: Error): void {
    this.connectionFailed.set(err.message === HttpErrorMessages.NetworkUnavailable);
    this.alertService.error(err.message);
  }

  private setCatalogCounts(setup: CatalogSetupDto): void {
    const subs = [
      ...setup.categories.flatMap((c) => c.subCategories),
      ...setup.unassignedSubCategories,
    ];
    this.counts.update((c) => ({
      ...c,
      categories: setup.categories.filter((x) => x.isActive).length,
      subcategories: subs.filter((x) => x.isActive).length,
      'addon-types': setup.addOnTypes.filter((x) => x.isActive).length,
    }));
  }
}
