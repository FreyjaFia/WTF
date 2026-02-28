import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FileOpener } from '@capacitor-community/file-opener';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { AlertService, ReportsService, UserService } from '@core/services';
import { IconComponent, PullToRefreshComponent, SearchInputComponent } from '@shared/components';
import {
  DailySalesReportQuery,
  DailySalesReportRowDto,
  HourlySalesReportQuery,
  HourlySalesReportRowDto,
  PaymentsReportQuery,
  PaymentsReportRowDto,
  PRODUCT_SUB_CATEGORY_LABELS,
  ProductCategoryEnum,
  ProductSalesReportQuery,
  ProductSalesReportRowDto,
  ProductSubCategoryEnum,
  ReportGroupBy,
  ReportType,
  StaffPerformanceReportQuery,
  StaffPerformanceReportRowDto,
  UserDto,
} from '@shared/models';

const ReportTypes = {
  DailySales: 'daily-sales',
  ProductSales: 'product-sales',
  Payments: 'payments',
  Hourly: 'hourly',
  Staff: 'staff',
} as const satisfies Record<string, ReportType>;

const DatePresets = {
  Today: 'today',
  Yesterday: 'yesterday',
  ThisWeek: 'this-week',
  ThisMonth: 'this-month',
  LastMonth: 'last-month',
  Custom: 'custom',
} as const;

const ReportGroupByValues = {
  Day: 'Day',
  Week: 'Week',
  Month: 'Month',
} as const satisfies Record<string, ReportGroupBy>;

type DatePreset = (typeof DatePresets)[keyof typeof DatePresets];
type SortDirection = 'asc' | 'desc';
type DailySortKey =
  | 'periodStart'
  | 'totalRevenue'
  | 'orderCount'
  | 'averageOrderValue'
  | 'tipsTotal'
  | 'voidCancelledCount';
type ProductSortKey =
  | 'productName'
  | 'categoryName'
  | 'subCategoryName'
  | 'quantitySold'
  | 'revenue'
  | 'revenuePercent';
type PaymentsSortKey = 'paymentMethod' | 'orderCount' | 'totalAmount' | 'totalPercent';
type HourlySortKey = 'hour' | 'orderCount' | 'revenue';
type StaffSortKey =
  | 'staffName'
  | 'orderCount'
  | 'totalRevenue'
  | 'averageOrderValue'
  | 'tipsReceived';

interface DateRangeValue {
  fromDate: string;
  toDate: string;
}

interface EnumFilterOption<T extends number> {
  value: T;
  label: string;
}

interface StaffFilterOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-reports',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    PullToRefreshComponent,
    IconComponent,
    SearchInputComponent,
  ],
  templateUrl: './reports.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ReportsComponent implements OnInit {
  private readonly reportsService = inject(ReportsService);
  private readonly userService = inject(UserService);
  private readonly alertService = inject(AlertService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly dailyReports = signal<DailySalesReportRowDto[]>([]);
  protected readonly productReports = signal<ProductSalesReportRowDto[]>([]);
  protected readonly paymentsReports = signal<PaymentsReportRowDto[]>([]);
  protected readonly hourlyReports = signal<HourlySalesReportRowDto[]>([]);
  protected readonly staffReports = signal<StaffPerformanceReportRowDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly searchTerm = signal('');
  protected readonly isMobileFiltersOpen = signal(false);
  protected readonly staffOptions = signal<StaffFilterOption[]>([]);
  protected readonly reportTypes = ReportTypes;
  protected readonly datePresets = DatePresets;
  protected readonly reportGroupByValues = ReportGroupByValues;
  protected readonly reportTypeOptions: readonly ReportType[] = [
    this.reportTypes.DailySales,
    this.reportTypes.ProductSales,
    this.reportTypes.Payments,
    this.reportTypes.Hourly,
    this.reportTypes.Staff,
  ];
  protected readonly datePresetOptions: readonly { value: DatePreset; label: string }[] = [
    { value: this.datePresets.Today, label: 'Today' },
    { value: this.datePresets.Yesterday, label: 'Yesterday' },
    { value: this.datePresets.ThisWeek, label: 'This Week' },
    { value: this.datePresets.ThisMonth, label: 'This Month' },
    { value: this.datePresets.LastMonth, label: 'Last Month' },
    { value: this.datePresets.Custom, label: 'Custom Range' },
  ];
  protected readonly groupByOptions: readonly { value: ReportGroupBy; label: string }[] = [
    { value: this.reportGroupByValues.Day, label: 'Day' },
    { value: this.reportGroupByValues.Week, label: 'Week' },
    { value: this.reportGroupByValues.Month, label: 'Month' },
  ];
  protected readonly categoryOptions: readonly EnumFilterOption<ProductCategoryEnum>[] = [
    { value: ProductCategoryEnum.Drink, label: 'Drink' },
    { value: ProductCategoryEnum.Food, label: 'Food' },
    { value: ProductCategoryEnum.Dessert, label: 'Dessert' },
    { value: ProductCategoryEnum.Other, label: 'Other' },
  ];
  protected readonly subCategoryOptions: readonly EnumFilterOption<ProductSubCategoryEnum>[] = [
    {
      value: ProductSubCategoryEnum.Coffee,
      label: PRODUCT_SUB_CATEGORY_LABELS[ProductSubCategoryEnum.Coffee],
    },
    {
      value: ProductSubCategoryEnum.NonCoffee,
      label: PRODUCT_SUB_CATEGORY_LABELS[ProductSubCategoryEnum.NonCoffee],
    },
    {
      value: ProductSubCategoryEnum.Snacks,
      label: PRODUCT_SUB_CATEGORY_LABELS[ProductSubCategoryEnum.Snacks],
    },
  ];

  protected readonly dailySortKey = signal<DailySortKey>('periodStart');
  protected readonly dailySortDirection = signal<SortDirection>('desc');
  protected readonly productSortKey = signal<ProductSortKey>('revenue');
  protected readonly productSortDirection = signal<SortDirection>('desc');
  protected readonly paymentsSortKey = signal<PaymentsSortKey>('totalAmount');
  protected readonly paymentsSortDirection = signal<SortDirection>('desc');
  protected readonly hourlySortKey = signal<HourlySortKey>('hour');
  protected readonly hourlySortDirection = signal<SortDirection>('asc');
  protected readonly staffSortKey = signal<StaffSortKey>('totalRevenue');
  protected readonly staffSortDirection = signal<SortDirection>('desc');

  protected readonly reportForm = this.formBuilder.group({
    reportType: this.formBuilder.control<ReportType>(this.reportTypes.DailySales, {
      validators: [Validators.required],
    }),
    preset: this.formBuilder.control<DatePreset>(this.datePresets.ThisMonth, {
      validators: [Validators.required],
    }),
    fromDate: this.formBuilder.control<string>('', { validators: [Validators.required] }),
    toDate: this.formBuilder.control<string>('', { validators: [Validators.required] }),
    groupBy: this.formBuilder.control<ReportGroupBy>(this.reportGroupByValues.Day, {
      validators: [Validators.required],
    }),
    categoryId: this.formBuilder.control<ProductCategoryEnum | null>(null),
    subCategoryId: this.formBuilder.control<ProductSubCategoryEnum | null>(null),
    staffId: this.formBuilder.control<string | null>(null),
  });

  protected readonly selectedReportType = toSignal(
    this.reportForm.controls.reportType.valueChanges,
    {
      initialValue: this.reportForm.controls.reportType.value,
    },
  );

  protected readonly filteredDailyReports = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const sortKey = this.dailySortKey();
    const direction = this.dailySortDirection();
    const source = this.dailyReports();

    const filtered = term
      ? source.filter((row) =>
          this.matchesSearch(term, [
            this.formatDateSafe(row.periodStart),
            row.totalRevenue,
            row.orderCount,
            row.averageOrderValue,
            row.tipsTotal,
            row.voidCancelledCount,
          ]),
        )
      : source;

    return this.sortRows(filtered, sortKey, direction);
  });

  protected readonly filteredProductReports = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const sortKey = this.productSortKey();
    const direction = this.productSortDirection();
    const source = this.productReports();

    const filtered = term
      ? source.filter((row) =>
          this.matchesSearch(term, [
            row.productName,
            row.categoryName,
            row.subCategoryName ?? '',
            row.quantitySold,
            row.revenue,
            row.revenuePercent,
          ]),
        )
      : source;

    return this.sortRows(filtered, sortKey, direction);
  });

  protected readonly filteredPaymentsReports = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const sortKey = this.paymentsSortKey();
    const direction = this.paymentsSortDirection();
    const source = this.paymentsReports();

    const filtered = term
      ? source.filter((row) =>
          this.matchesSearch(term, [
            row.paymentMethod,
            row.orderCount,
            row.totalAmount,
            row.totalPercent,
          ]),
        )
      : source;

    return this.sortRows(filtered, sortKey, direction);
  });

  protected readonly filteredHourlyReports = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const sortKey = this.hourlySortKey();
    const direction = this.hourlySortDirection();
    const source = this.hourlyReports();

    const filtered = term
      ? source.filter((row) =>
          this.matchesSearch(term, [
            this.toHourLabel(row.hour),
            row.hour,
            row.orderCount,
            row.revenue,
          ]),
        )
      : source;

    return this.sortRows(filtered, sortKey, direction);
  });

  protected readonly filteredStaffReports = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const sortKey = this.staffSortKey();
    const direction = this.staffSortDirection();
    const source = this.staffReports();

    const filtered = term
      ? source.filter((row) =>
          this.matchesSearch(term, [
            row.staffName,
            row.orderCount,
            row.totalRevenue,
            row.averageOrderValue,
            row.tipsReceived,
          ]),
        )
      : source;

    return this.sortRows(filtered, sortKey, direction);
  });

  public ngOnInit(): void {
    this.applyPreset(this.datePresets.ThisMonth);
    this.loadStaffOptions();
    this.loadReport();
  }

  protected toggleMobileFilters(): void {
    this.isMobileFiltersOpen.set(!this.isMobileFiltersOpen());
  }

  protected onPresetChanged(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.applyPreset(target.value as DatePreset);
    this.loadReport();
  }

  protected onReportTypeChanged(): void {
    this.searchTerm.set('');
    this.loadReport();
  }

  protected onGroupByChanged(): void {
    this.loadReport();
  }

  protected onDateChanged(): void {
    if (this.reportForm.controls.preset.value !== this.datePresets.Custom) {
      this.reportForm.controls.preset.setValue(this.datePresets.Custom);
    }

    this.loadReport();
  }

  protected onAdvancedFilterChanged(): void {
    this.loadReport();
  }

  protected onSearchChanged(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchTerm.set(target.value);
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadReport();
  }

  protected toggleDailySort(column: DailySortKey): void {
    this.toggleSortState(column, this.dailySortKey, this.dailySortDirection);
  }

  protected toggleProductSort(column: ProductSortKey): void {
    this.toggleSortState(column, this.productSortKey, this.productSortDirection);
  }

  protected togglePaymentsSort(column: PaymentsSortKey): void {
    this.toggleSortState(column, this.paymentsSortKey, this.paymentsSortDirection);
  }

  protected toggleHourlySort(column: HourlySortKey): void {
    this.toggleSortState(column, this.hourlySortKey, this.hourlySortDirection);
  }

  protected toggleStaffSort(column: StaffSortKey): void {
    this.toggleSortState(column, this.staffSortKey, this.staffSortDirection);
  }

  protected isSorted(column: string): boolean {
    const reportType = this.selectedReportType();
    if (reportType === this.reportTypes.DailySales) {
      return this.dailySortKey() === column;
    }

    if (reportType === this.reportTypes.ProductSales) {
      return this.productSortKey() === column;
    }

    if (reportType === this.reportTypes.Payments) {
      return this.paymentsSortKey() === column;
    }

    if (reportType === this.reportTypes.Hourly) {
      return this.hourlySortKey() === column;
    }

    return this.staffSortKey() === column;
  }

  protected getSortDirection(column: string): SortDirection {
    const reportType = this.selectedReportType();
    if (reportType === this.reportTypes.DailySales && this.dailySortKey() === column) {
      return this.dailySortDirection();
    }

    if (reportType === this.reportTypes.ProductSales && this.productSortKey() === column) {
      return this.productSortDirection();
    }

    if (reportType === this.reportTypes.Payments && this.paymentsSortKey() === column) {
      return this.paymentsSortDirection();
    }

    if (reportType === this.reportTypes.Hourly && this.hourlySortKey() === column) {
      return this.hourlySortDirection();
    }

    if (reportType === this.reportTypes.Staff && this.staffSortKey() === column) {
      return this.staffSortDirection();
    }

    return 'asc';
  }

  protected downloadCsv(): void {
    const reportType = this.selectedReportType();
    if (!reportType) {
      return;
    }

    if (reportType === this.reportTypes.DailySales) {
      const query = this.buildDailySalesQuery();
      if (!query) {
        return;
      }

      this.reportsService.downloadDailySalesCsv(query).subscribe({
        next: (blob) =>
          void this.saveBlob(blob, `daily-sales-${query.fromDate}-${query.toDate}.csv`, 'text/csv'),
        error: (error: Error) => this.alertService.error(error.message),
      });
      return;
    }

    if (reportType === this.reportTypes.ProductSales) {
      const query = this.buildProductSalesQuery();
      if (!query) {
        return;
      }

      this.reportsService.downloadProductSalesCsv(query).subscribe({
        next: (blob) =>
          void this.saveBlob(
            blob,
            `product-sales-${query.fromDate}-${query.toDate}.csv`,
            'text/csv',
          ),
        error: (error: Error) => this.alertService.error(error.message),
      });
      return;
    }

    if (reportType === this.reportTypes.Payments) {
      const query = this.buildPaymentsQuery();
      if (!query) {
        return;
      }

      this.reportsService.downloadPaymentsCsv(query).subscribe({
        next: (blob) =>
          void this.saveBlob(blob, `payments-${query.fromDate}-${query.toDate}.csv`, 'text/csv'),
        error: (error: Error) => this.alertService.error(error.message),
      });
      return;
    }

    if (reportType === this.reportTypes.Hourly) {
      const query = this.buildHourlySalesQuery();
      if (!query) {
        return;
      }

      this.reportsService.downloadHourlySalesCsv(query).subscribe({
        next: (blob) =>
          void this.saveBlob(blob, `hourly-${query.fromDate}-${query.toDate}.csv`, 'text/csv'),
        error: (error: Error) => this.alertService.error(error.message),
      });
      return;
    }

    const query = this.buildStaffPerformanceQuery();
    if (!query) {
      return;
    }

    this.reportsService.downloadStaffPerformanceCsv(query).subscribe({
      next: (blob) =>
        void this.saveBlob(blob, `staff-${query.fromDate}-${query.toDate}.csv`, 'text/csv'),
      error: (error: Error) => this.alertService.error(error.message),
    });
  }

  protected downloadPdf(): void {
    const reportType = this.selectedReportType();
    if (!reportType) {
      return;
    }

    if (reportType === this.reportTypes.DailySales) {
      const query = this.buildDailySalesQuery();
      if (!query) {
        return;
      }

      this.reportsService.downloadDailySalesPdf(query).subscribe({
        next: (blob) =>
          void this.saveBlob(
            blob,
            `daily-sales-${query.fromDate}-${query.toDate}.pdf`,
            'application/pdf',
          ),
        error: (error: Error) => this.alertService.error(error.message),
      });
      return;
    }

    if (reportType === this.reportTypes.ProductSales) {
      const query = this.buildProductSalesQuery();
      if (!query) {
        return;
      }

      this.reportsService.downloadProductSalesPdf(query).subscribe({
        next: (blob) =>
          void this.saveBlob(
            blob,
            `product-sales-${query.fromDate}-${query.toDate}.pdf`,
            'application/pdf',
          ),
        error: (error: Error) => this.alertService.error(error.message),
      });
      return;
    }

    if (reportType === this.reportTypes.Payments) {
      const query = this.buildPaymentsQuery();
      if (!query) {
        return;
      }

      this.reportsService.downloadPaymentsPdf(query).subscribe({
        next: (blob) =>
          void this.saveBlob(
            blob,
            `payments-${query.fromDate}-${query.toDate}.pdf`,
            'application/pdf',
          ),
        error: (error: Error) => this.alertService.error(error.message),
      });
      return;
    }

    if (reportType === this.reportTypes.Hourly) {
      const query = this.buildHourlySalesQuery();
      if (!query) {
        return;
      }

      this.reportsService.downloadHourlySalesPdf(query).subscribe({
        next: (blob) =>
          void this.saveBlob(
            blob,
            `hourly-${query.fromDate}-${query.toDate}.pdf`,
            'application/pdf',
          ),
        error: (error: Error) => this.alertService.error(error.message),
      });
      return;
    }

    const query = this.buildStaffPerformanceQuery();
    if (!query) {
      return;
    }

    this.reportsService.downloadStaffPerformancePdf(query).subscribe({
      next: (blob) =>
        void this.saveBlob(blob, `staff-${query.fromDate}-${query.toDate}.pdf`, 'application/pdf'),
      error: (error: Error) => this.alertService.error(error.message),
    });
  }

  protected getReportTypeLabel(type: ReportType): string {
    switch (type) {
      case ReportTypes.DailySales:
        return 'Daily Sales Summary';
      case ReportTypes.ProductSales:
        return 'Product Sales Breakdown';
      case ReportTypes.Payments:
        return 'Payment Method Breakdown';
      case ReportTypes.Hourly:
        return 'Hourly Sales Distribution';
      case ReportTypes.Staff:
        return 'Staff Performance';
    }
  }

  protected isDailySalesReport(): boolean {
    return this.selectedReportType() === this.reportTypes.DailySales;
  }

  protected isProductSalesReport(): boolean {
    return this.selectedReportType() === this.reportTypes.ProductSales;
  }

  protected isPaymentsReport(): boolean {
    return this.selectedReportType() === this.reportTypes.Payments;
  }

  protected isHourlyReport(): boolean {
    return this.selectedReportType() === this.reportTypes.Hourly;
  }

  protected isStaffReport(): boolean {
    return this.selectedReportType() === this.reportTypes.Staff;
  }

  protected showGroupByFilter(): boolean {
    return this.isDailySalesReport();
  }

  protected showProductFilters(): boolean {
    return this.isProductSalesReport();
  }

  protected showStaffFilter(): boolean {
    return this.isStaffReport();
  }

  protected getDailyTotals(): DailySalesReportRowDto {
    const rows = this.filteredDailyReports();
    const totalRevenue = rows.reduce((sum, row) => sum + row.totalRevenue, 0);
    const orderCount = rows.reduce((sum, row) => sum + row.orderCount, 0);
    const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;
    const tipsTotal = rows.reduce((sum, row) => sum + row.tipsTotal, 0);
    const voidCancelledCount = rows.reduce((sum, row) => sum + row.voidCancelledCount, 0);

    return {
      periodStart: 'TOTAL',
      totalRevenue,
      orderCount,
      averageOrderValue,
      tipsTotal,
      voidCancelledCount,
    };
  }

  protected getProductTotals(): { quantitySold: number; revenue: number } {
    const rows = this.filteredProductReports();
    return {
      quantitySold: rows.reduce((sum, row) => sum + row.quantitySold, 0),
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    };
  }

  protected getPaymentsTotals(): { orderCount: number; totalAmount: number } {
    const rows = this.filteredPaymentsReports();
    return {
      orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
      totalAmount: rows.reduce((sum, row) => sum + row.totalAmount, 0),
    };
  }

  protected getHourlyTotals(): { orderCount: number; revenue: number } {
    const rows = this.filteredHourlyReports();
    return {
      orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    };
  }

  protected getStaffTotals(): {
    orderCount: number;
    revenue: number;
    averageOrderValue: number;
    tipsReceived: number;
  } {
    const rows = this.filteredStaffReports();
    const orderCount = rows.reduce((sum, row) => sum + row.orderCount, 0);
    const revenue = rows.reduce((sum, row) => sum + row.totalRevenue, 0);
    return {
      orderCount,
      revenue,
      averageOrderValue: orderCount > 0 ? revenue / orderCount : 0,
      tipsReceived: rows.reduce((sum, row) => sum + row.tipsReceived, 0),
    };
  }

  protected toHourLabel(hour: number): string {
    if (hour === 0) {
      return '12 AM';
    }

    if (hour < 12) {
      return `${hour} AM`;
    }

    if (hour === 12) {
      return '12 PM';
    }

    return `${hour - 12} PM`;
  }

  protected getDailyPeriodHeaderLabel(): string {
    const groupBy = this.reportForm.controls.groupBy.value;
    if (groupBy === this.reportGroupByValues.Week) {
      return 'Week';
    }

    if (groupBy === this.reportGroupByValues.Month) {
      return 'Month';
    }

    return 'Date';
  }

  protected getDailyPeriodLabel(periodStart: string): string {
    const periodDate = new Date(periodStart);
    if (Number.isNaN(periodDate.getTime())) {
      return periodStart;
    }

    const groupBy = this.reportForm.controls.groupBy.value;
    if (groupBy === this.reportGroupByValues.Week) {
      const endDate = new Date(periodDate);
      endDate.setDate(periodDate.getDate() + 6);

      const startLabel = periodDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      const endLabel = endDate.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      return `${startLabel} - ${endLabel}`;
    }

    if (groupBy === this.reportGroupByValues.Month) {
      return periodDate.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      });
    }

    return periodDate.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  private loadReport(): void {
    const reportType = this.selectedReportType();
    if (!reportType) {
      return;
    }

    this.isLoading.set(true);

    if (reportType === this.reportTypes.DailySales) {
      const query = this.buildDailySalesQuery();
      if (!query) {
        this.finishLoading();
        return;
      }

      this.reportsService.getDailySalesReport(query).subscribe({
        next: (rows) => {
          this.dailyReports.set(rows);
          this.finishLoading();
        },
        error: (error: Error) => {
          this.alertService.error(error.message);
          this.dailyReports.set([]);
          this.finishLoading();
        },
      });
      return;
    }

    if (reportType === this.reportTypes.ProductSales) {
      const query = this.buildProductSalesQuery();
      if (!query) {
        this.finishLoading();
        return;
      }

      this.reportsService.getProductSalesReport(query).subscribe({
        next: (rows) => {
          this.productReports.set(rows);
          this.finishLoading();
        },
        error: (error: Error) => {
          this.alertService.error(error.message);
          this.productReports.set([]);
          this.finishLoading();
        },
      });
      return;
    }

    if (reportType === this.reportTypes.Payments) {
      const query = this.buildPaymentsQuery();
      if (!query) {
        this.finishLoading();
        return;
      }

      this.reportsService.getPaymentsReport(query).subscribe({
        next: (rows) => {
          this.paymentsReports.set(rows);
          this.finishLoading();
        },
        error: (error: Error) => {
          this.alertService.error(error.message);
          this.paymentsReports.set([]);
          this.finishLoading();
        },
      });
      return;
    }

    if (reportType === this.reportTypes.Hourly) {
      const query = this.buildHourlySalesQuery();
      if (!query) {
        this.finishLoading();
        return;
      }

      this.reportsService.getHourlySalesReport(query).subscribe({
        next: (rows) => {
          this.hourlyReports.set(rows);
          this.finishLoading();
        },
        error: (error: Error) => {
          this.alertService.error(error.message);
          this.hourlyReports.set([]);
          this.finishLoading();
        },
      });
      return;
    }

    const query = this.buildStaffPerformanceQuery();
    if (!query) {
      this.finishLoading();
      return;
    }

    this.reportsService.getStaffPerformanceReport(query).subscribe({
      next: (rows) => {
        this.staffReports.set(rows);
        this.finishLoading();
      },
      error: (error: Error) => {
        this.alertService.error(error.message);
        this.staffReports.set([]);
        this.finishLoading();
      },
    });
  }

  private finishLoading(): void {
    this.isLoading.set(false);
    this.isRefreshing.set(false);
  }

  private buildDailySalesQuery(): DailySalesReportQuery | null {
    const range = this.getDateRangeOrShowError();
    if (!range) {
      return null;
    }

    const groupBy = this.reportForm.controls.groupBy.value;
    if (!groupBy) {
      this.alertService.error('Group by is required for Daily Sales report.');
      return null;
    }

    return { ...range, groupBy };
  }

  private buildProductSalesQuery(): ProductSalesReportQuery | null {
    const range = this.getDateRangeOrShowError();
    if (!range) {
      return null;
    }

    const query: ProductSalesReportQuery = { ...range };
    const categoryId = this.reportForm.controls.categoryId.value;
    const subCategoryId = this.reportForm.controls.subCategoryId.value;

    if (categoryId !== null) {
      query.categoryId = categoryId;
    }

    if (subCategoryId !== null) {
      query.subCategoryId = subCategoryId;
    }

    return query;
  }

  private buildPaymentsQuery(): PaymentsReportQuery | null {
    const range = this.getDateRangeOrShowError();
    if (!range) {
      return null;
    }

    return { ...range };
  }

  private buildHourlySalesQuery(): HourlySalesReportQuery | null {
    const range = this.getDateRangeOrShowError();
    if (!range) {
      return null;
    }

    return { ...range };
  }

  private buildStaffPerformanceQuery(): StaffPerformanceReportQuery | null {
    const range = this.getDateRangeOrShowError();
    if (!range) {
      return null;
    }

    const query: StaffPerformanceReportQuery = { ...range };
    const staffId = this.reportForm.controls.staffId.value;
    if (staffId && staffId.trim()) {
      query.staffId = staffId.trim();
    }

    return query;
  }

  private getDateRangeOrShowError(): DateRangeValue | null {
    const fromDate = this.reportForm.controls.fromDate.value;
    const toDate = this.reportForm.controls.toDate.value;

    if (!fromDate || !toDate) {
      this.alertService.error('Please select report filters first.');
      return null;
    }

    if (fromDate > toDate) {
      this.alertService.error('From date must be earlier than or equal to To date.');
      return null;
    }

    return { fromDate, toDate };
  }

  private applyPreset(preset: DatePreset): void {
    this.reportForm.controls.preset.setValue(preset);

    const today = new Date();
    let fromDate = new Date(today);
    let toDate = new Date(today);

    if (preset === this.datePresets.Yesterday) {
      fromDate.setDate(today.getDate() - 1);
      toDate.setDate(today.getDate() - 1);
    } else if (preset === this.datePresets.ThisWeek) {
      const dayOfWeek = (today.getDay() + 6) % 7;
      fromDate.setDate(today.getDate() - dayOfWeek);
    } else if (preset === this.datePresets.ThisMonth) {
      fromDate = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (preset === this.datePresets.LastMonth) {
      fromDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      toDate = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (preset === this.datePresets.Custom) {
      return;
    }

    this.reportForm.patchValue({
      fromDate: this.toDateInputValue(fromDate),
      toDate: this.toDateInputValue(toDate),
    });
  }

  private toDateInputValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatDateSafe(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toISOString();
  }

  private matchesSearch(term: string, values: (string | number)[]): boolean {
    return values.some((value) => String(value).toLowerCase().includes(term));
  }

  private sortRows<T>(rows: readonly T[], key: keyof T, direction: SortDirection): T[] {
    return [...rows].sort((a, b) => {
      const aValue = a[key];
      const bValue = b[key];

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      const aDate = Date.parse(String(aValue));
      const bDate = Date.parse(String(bValue));
      if (!Number.isNaN(aDate) && !Number.isNaN(bDate)) {
        return direction === 'asc' ? aDate - bDate : bDate - aDate;
      }

      const aText = String(aValue ?? '').toLowerCase();
      const bText = String(bValue ?? '').toLowerCase();
      if (aText < bText) {
        return direction === 'asc' ? -1 : 1;
      }

      if (aText > bText) {
        return direction === 'asc' ? 1 : -1;
      }

      return 0;
    });
  }

  private toggleSortState<T extends string>(
    column: T,
    keySignal: { (): T; set(value: T): void },
    directionSignal: { (): SortDirection; set(value: SortDirection): void },
  ): void {
    if (keySignal() === column) {
      directionSignal.set(directionSignal() === 'asc' ? 'desc' : 'asc');
      return;
    }

    keySignal.set(column);
    directionSignal.set('asc');
  }

  private async saveBlob(blob: Blob, fileName: string, contentType: string): Promise<void> {
    if (Capacitor.getPlatform() === 'android') {
      await this.saveAndOpenOnAndroid(blob, fileName, contentType);
      return;
    }

    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    window.URL.revokeObjectURL(objectUrl);
  }

  private async saveAndOpenOnAndroid(
    blob: Blob,
    fileName: string,
    contentType: string,
  ): Promise<void> {
    try {
      const safeFileName = this.normalizeFileName(fileName);
      const path = `reports/${Date.now()}-${safeFileName}`;
      const base64Data = await this.blobToBase64(blob);

      const uri = await this.writeFileToAvailableDirectory(path, base64Data);

      const opened = await this.tryOpenFile(uri, contentType);
      if (!opened) {
        const shared = await this.tryShareFile(uri);
        if (!shared) {
          this.alertService.info('File was downloaded but could not be opened automatically.');
        }
      }
    } catch {
      try {
        this.triggerBrowserDownload(blob, fileName);
      } catch {
        this.alertService.error('Failed to download file on mobile.');
      }
    }
  }

  private async writeFileToAvailableDirectory(path: string, base64Data: string): Promise<string> {
    const directories: Directory[] = [Directory.Documents, Directory.Cache];

    for (const directory of directories) {
      try {
        await Filesystem.writeFile({
          path,
          data: base64Data,
          directory,
          recursive: true,
        });

        const { uri } = await Filesystem.getUri({ path, directory });
        return uri;
      } catch {
        // Try next directory.
      }
    }

    throw new Error('No writable directory found.');
  }

  private async tryOpenFile(filePath: string, contentType: string): Promise<boolean> {
    try {
      await FileOpener.open({
        filePath,
        contentType,
        openWithDefault: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async tryShareFile(filePath: string): Promise<boolean> {
    try {
      await Share.share({
        title: 'Open file',
        files: [filePath],
      });
      return true;
    } catch {
      return false;
    }
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
          return;
        }

        reject(new Error('Unable to read blob data.'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('Unable to read blob data.'));
      reader.readAsDataURL(blob);
    });

    const marker = 'base64,';
    const markerIndex = dataUrl.indexOf(marker);
    if (markerIndex < 0) {
      throw new Error('Invalid blob data.');
    }

    return dataUrl.slice(markerIndex + marker.length);
  }

  private normalizeFileName(fileName: string): string {
    return fileName.replace(/[<>:"/\\|?*]/g, '-').trim();
  }

  private triggerBrowserDownload(blob: Blob, fileName: string): void {
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    window.URL.revokeObjectURL(objectUrl);
  }

  private loadStaffOptions(): void {
    this.userService.getUsers({ isActive: true }).subscribe({
      next: (users) => {
        this.staffOptions.set(
          users
            .map((user) => ({
              id: user.id,
              name: this.toStaffDisplayName(user),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
      error: () => {
        this.staffOptions.set([]);
      },
    });
  }

  private toStaffDisplayName(user: UserDto): string {
    const fullName = `${user.firstName} ${user.lastName}`.trim();
    if (fullName.length > 0) {
      return `${fullName} (${user.username})`;
    }

    return user.username;
  }
}
