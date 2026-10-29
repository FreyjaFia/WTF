import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { HttpErrorMessages } from '@core/messages';
import {
  AlertService,
  AuthService,
  FileDownloadService,
  ReportsService,
  UserService,
} from '@core/services';
import {
  AreaChartComponent,
  BarChartComponent,
  ConnectionErrorComponent,
  DonutChartComponent,
  DonutSegment,
  IconComponent,
  PullToRefreshComponent,
  SearchInputComponent,
  SideDrawerComponent,
  SortHeaderComponent,
} from '@shared/components';
import { FilterButtonComponent } from '@shared/components/filter-button/filter-button';
import {
  MonthlyReportWorkbookStatusDto,
  PRODUCT_SUB_CATEGORY_LABELS,
  ProductCategoryEnum,
  ProductSubCategoryEnum,
  ReportGroupBy,
  ReportQuery,
  ReportSortDirection,
  ReportSource,
  ReportType,
  UserDto,
  WasteReportGroupBy,
} from '@shared/models';
import { map, startWith } from 'rxjs';
import {
  DATE_PRESET_OPTIONS,
  DatePreset,
  DatePresets,
  resolveDatePreset,
} from './report-date-presets';
import {
  ChartPoint,
  findReportDefinition,
  periodHeader,
  REPORT_DEFINITIONS,
  REPORT_GROUPS,
  ReportContext,
  ReportDefinition,
  ReportFilterKind,
  ReportRow,
} from './report-definitions';
import { buildCsv, cellText, filterAndSortRows, totalCells } from './report-table';

const ReportPageTabs = {
  Reports: 'reports',
  MonthlyWorkbook: 'monthly-workbook',
} as const;

/** Customer link orders are saved under this system user; it is not a staff member. */
const CUSTOMER_LINK_USERNAME = 'customer-link';

const PromotionsReportCategoryFilterId = -1;
const FixedBundleReportTypeFilterId = -101;
const MixMatchReportTypeFilterId = -102;

const DONUT_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

type ReportPageTab = (typeof ReportPageTabs)[keyof typeof ReportPageTabs];

interface EnumFilterOption<T extends number> {
  value: T;
  label: string;
}

interface StaffFilterOption {
  id: string;
  name: string;
}

interface MonthOption {
  value: number;
  label: string;
}

@Component({
  selector: 'app-reports',
  imports: [
    FilterButtonComponent,
    CommonModule,
    ReactiveFormsModule,
    ConnectionErrorComponent,
    PullToRefreshComponent,
    IconComponent,
    SideDrawerComponent,
    SearchInputComponent,
    SortHeaderComponent,
    AreaChartComponent,
    BarChartComponent,
    DonutChartComponent,
  ],
  templateUrl: './reports.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ReportsComponent implements OnInit {
  private readonly reportsService = inject(ReportsService);
  private readonly fileDownload = inject(FileDownloadService);
  private readonly userService = inject(UserService);
  private readonly alertService = inject(AlertService);
  protected readonly canGenerate = inject(AuthService).canGenerateReports();
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  protected readonly selectedType = signal<ReportType | null>(null);
  protected readonly rows = signal<ReportRow[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly connectionFailed = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isDownloadingExcel = signal(false);
  protected readonly isDownloadingPdf = signal(false);
  protected readonly isDownloadingCsv = signal(false);
  protected readonly isGeneratingMonthlyWorkbook = signal(false);
  protected readonly isDownloadingMonthlyWorkbook = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  protected readonly searchTerm = signal('');
  protected readonly isFiltersOpen = signal(false);
  protected readonly staffOptions = signal<StaffFilterOption[]>([]);
  protected readonly monthlyWorkbookStatus = signal<MonthlyReportWorkbookStatusDto | null>(null);
  protected readonly activeTab = signal<ReportPageTab>(ReportPageTabs.Reports);
  protected readonly sortKey = signal<string | null>(null);
  protected readonly sortDirection = signal<ReportSortDirection>('asc');
  protected readonly reportPageTabs = ReportPageTabs;
  protected readonly datePresets = DatePresets;
  protected readonly datePresetOptions = DATE_PRESET_OPTIONS;
  protected readonly donutColors = DONUT_COLORS;
  protected readonly monthOptions: readonly MonthOption[] = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' },
  ];
  protected readonly groupByOptions: readonly { value: ReportGroupBy; label: string }[] = [
    { value: 'Day', label: 'Day' },
    { value: 'Week', label: 'Week' },
    { value: 'Month', label: 'Month' },
  ];
  protected readonly wasteGroupByOptions: readonly { value: WasteReportGroupBy; label: string }[] = [
    { value: 'item', label: 'Item' },
    { value: 'reason', label: 'Reason' },
    { value: 'staff', label: 'Staff' },
    { value: 'day', label: 'Day' },
  ];
  protected readonly sourceOptions: readonly { value: ReportSource | null; label: string }[] = [
    { value: null, label: 'All Orders' },
    { value: 0, label: 'Shop Orders' },
    { value: 1, label: 'Customer Link Orders' },
  ];
  protected readonly categoryOptions: readonly EnumFilterOption<number>[] = [
    { value: ProductCategoryEnum.Drink, label: 'Drink' },
    { value: ProductCategoryEnum.Food, label: 'Food' },
    { value: ProductCategoryEnum.Dessert, label: 'Dessert' },
    { value: ProductCategoryEnum.Other, label: 'Other' },
    { value: PromotionsReportCategoryFilterId, label: 'Promotions' },
  ];
  protected readonly subCategoryOptions: readonly EnumFilterOption<number>[] = [
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
    {
      value: ProductSubCategoryEnum.Retail,
      label: PRODUCT_SUB_CATEGORY_LABELS[ProductSubCategoryEnum.Retail],
    },
    { value: FixedBundleReportTypeFilterId, label: 'Fixed Bundle' },
    { value: MixMatchReportTypeFilterId, label: 'Mix & Match' },
  ];
  protected readonly catalog = REPORT_GROUPS.map((section) => ({
    ...section,
    reports: REPORT_DEFINITIONS.filter((definition) => definition.group === section.group),
  })).filter((section) => section.reports.length > 0);

  protected readonly reportForm = this.formBuilder.group({
    preset: this.formBuilder.control<DatePreset>(DatePresets.ThisMonth, {
      validators: [Validators.required],
    }),
    fromDate: this.formBuilder.control<string>('', { validators: [Validators.required] }),
    toDate: this.formBuilder.control<string>('', { validators: [Validators.required] }),
    workbookYear: this.formBuilder.control<number>(new Date().getFullYear(), {
      validators: [Validators.required],
      nonNullable: true,
    }),
    workbookMonth: this.formBuilder.control<number>(new Date().getMonth() + 1, {
      validators: [Validators.required],
      nonNullable: true,
    }),
    workbookSource: this.formBuilder.control<ReportSource | null>(null),
    groupBy: this.formBuilder.control<ReportGroupBy>('Day', {
      validators: [Validators.required],
    }),
    wasteGroupBy: this.formBuilder.control<WasteReportGroupBy>('item', { nonNullable: true }),
    categoryId: this.formBuilder.control<number | null>(null),
    subCategoryId: this.formBuilder.control<number | null>(null),
    staffId: this.formBuilder.control<string | null>(null),
    source: this.formBuilder.control<ReportSource | null>(null),
    splitAddOns: this.formBuilder.control<boolean>(false, { nonNullable: true }),
  });

  private readonly reportFormValue = toSignal(
    this.reportForm.valueChanges.pipe(
      startWith(null),
      map(() => this.reportForm.getRawValue()),
    ),
    { initialValue: this.reportForm.getRawValue() },
  );

  protected readonly definition = computed<ReportDefinition | null>(() => {
    const type = this.selectedType();
    return type ? findReportDefinition(type) : null;
  });

  protected readonly context = computed<ReportContext>(() => ({
    groupBy: this.reportFormValue().groupBy ?? 'Day',
  }));

  protected readonly visibleRows = computed(() => {
    const definition = this.definition();
    if (!definition) {
      return [];
    }

    return filterAndSortRows(
      this.rows(),
      definition,
      this.context(),
      this.searchTerm(),
      this.sortKey(),
      this.sortDirection(),
    );
  });

  protected readonly totalRow = computed(() => {
    const definition = this.definition();
    return definition ? totalCells(this.visibleRows(), definition) : null;
  });

  protected readonly totals = computed(() => this.definition()?.totals(this.visibleRows()) ?? []);

  protected readonly chartPoints = computed<ChartPoint[]>(
    () => this.definition()?.chart?.points(this.visibleRows(), this.context()) ?? [],
  );

  protected readonly donutSegments = computed<DonutSegment[]>(() =>
    this.chartPoints().map((point, index) => ({
      label: point.label,
      value: point.value,
      color: DONUT_COLORS[index % DONUT_COLORS.length],
    })),
  );

  protected readonly activeFilterCount = computed(() => {
    const value = this.reportFormValue();
    return (
      (value.preset !== DatePresets.ThisMonth ? 1 : 0) +
      (value.categoryId != null ? 1 : 0) +
      (value.subCategoryId != null ? 1 : 0) +
      (value.staffId != null ? 1 : 0) +
      (value.source != null ? 1 : 0) +
      (value.splitAddOns ? 1 : 0) +
      (value.groupBy !== 'Day' ? 1 : 0)
    );
  });

  public ngOnInit(): void {
    this.applyPreset(DatePresets.ThisMonth);
    this.loadStaffOptions();
    this.loadMonthlyWorkbookStatus();

    const requested = this.route.snapshot.queryParamMap.get('report');
    const match = REPORT_DEFINITIONS.find((definition) => definition.type === requested);
    if (match) {
      this.openReport(match.type);
    }
  }

  protected openReport(type: ReportType): void {
    const definition = findReportDefinition(type);
    this.selectedType.set(type);
    this.searchTerm.set('');
    this.rows.set([]);
    this.sortKey.set(definition.defaultSort?.key ?? null);
    this.sortDirection.set(definition.defaultSort?.direction ?? 'asc');
    this.isFiltersOpen.set(false);
    this.loadReport();
  }

  protected backToCatalog(): void {
    this.selectedType.set(null);
    this.rows.set([]);
    this.isFiltersOpen.set(false);
    this.connectionFailed.set(false);
  }

  protected openFilters(): void {
    this.isFiltersOpen.set(true);
  }

  protected closeFilters(): void {
    this.isFiltersOpen.set(false);
  }

  protected selectTab(tab: ReportPageTab): void {
    this.activeTab.set(tab);
    this.isFiltersOpen.set(false);
    if (tab === ReportPageTabs.MonthlyWorkbook) {
      this.loadMonthlyWorkbookStatus();
    }
  }

  protected isReportsTabActive(): boolean {
    return this.activeTab() === ReportPageTabs.Reports;
  }

  protected isMonthlyWorkbookTabActive(): boolean {
    return this.activeTab() === ReportPageTabs.MonthlyWorkbook;
  }

  protected onPresetChanged(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.applyPreset(target.value as DatePreset);
    this.loadReport();
  }

  protected onDateChanged(): void {
    if (this.reportForm.controls.preset.value !== DatePresets.Custom) {
      this.reportForm.controls.preset.setValue(DatePresets.Custom);
    }

    this.loadReport();
  }

  protected onFilterChanged(): void {
    this.loadReport();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadReport();
    this.loadMonthlyWorkbookStatus();
  }

  protected hasFilter(kind: ReportFilterKind): boolean {
    return this.definition()?.filters.includes(kind) === true;
  }

  protected sortBy(key: string): void {
    if (this.sortKey() === key) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }

    this.sortKey.set(key);
    this.sortDirection.set('asc');
  }

  protected headerOf(key: string, fallback: string): string {
    return key === 'periodStart' && this.selectedType() === 'daily-sales'
      ? periodHeader(this.context().groupBy)
      : fallback;
  }

  protected textOf(row: ReportRow, key: string): string {
    const column = this.definition()?.columns.find((candidate) => candidate.key === key);
    return column ? cellText(row, column, this.context()) : '';
  }

  protected downloadExcel(): void {
    this.downloadFile('excel');
  }

  protected downloadPdf(): void {
    this.downloadFile('pdf');
  }

  protected downloadCsv(): void {
    const definition = this.definition();
    if (!definition || this.isActionBusy()) {
      return;
    }

    this.isDownloadingCsv.set(true);
    const csv = buildCsv(this.visibleRows(), definition, this.context());
    void this.fileDownload
      .saveBlob(
        new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }),
        this.buildExportFileName(definition, 'csv'),
        'text/csv',
      )
      .finally(() => this.isDownloadingCsv.set(false));
  }

  protected onMonthlyWorkbookFilterChanged(): void {
    this.loadMonthlyWorkbookStatus();
  }

  protected generateMonthlyWorkbook(): void {
    if (this.isActionBusy()) {
      return;
    }

    const filter = this.getMonthlyWorkbookFilterOrShowError();
    if (!filter) {
      return;
    }

    this.isGeneratingMonthlyWorkbook.set(true);
    this.reportsService.generateMonthlyWorkbook(filter.year, filter.month, filter.source).subscribe({
      next: (status) => {
        this.isGeneratingMonthlyWorkbook.set(false);
        this.monthlyWorkbookStatus.set(status);
        this.alertService.success(`Monthly workbook generated: ${status.fileName}`);
      },
      error: (error: Error) => {
        this.isGeneratingMonthlyWorkbook.set(false);
        this.alertService.error(error.message);
      },
    });
  }

  protected downloadMonthlyWorkbook(): void {
    if (this.isActionBusy()) {
      return;
    }

    const filter = this.getMonthlyWorkbookFilterOrShowError();
    if (!filter) {
      return;
    }

    this.isDownloadingMonthlyWorkbook.set(true);
    this.reportsService.getMonthlyWorkbookStatus(filter.year, filter.month, filter.source).subscribe({
      next: (status) => {
        this.monthlyWorkbookStatus.set(status);
        if (!status.exists) {
          this.isDownloadingMonthlyWorkbook.set(false);
          this.alertService.info('Monthly workbook is not generated yet. Generate it first.');
          return;
        }

        this.reportsService.downloadMonthlyWorkbook(filter.year, filter.month, filter.source).subscribe({
          next: (blob) => {
            const fileName =
              status.fileName || this.buildMonthlyWorkbookFileName(filter.year, filter.month);
            void this.fileDownload
              .saveBlob(
                blob,
                fileName,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              )
              .finally(() => this.isDownloadingMonthlyWorkbook.set(false));
          },
          error: (error: Error) => {
            this.isDownloadingMonthlyWorkbook.set(false);
            this.alertService.error(error.message);
          },
        });
      },
      error: (error: Error) => {
        this.isDownloadingMonthlyWorkbook.set(false);
        this.alertService.error(error.message);
      },
    });
  }

  protected canDownloadMonthlyWorkbook(): boolean {
    return this.monthlyWorkbookStatus()?.exists === true;
  }

  protected isReportExportBusy(): boolean {
    return this.isActionBusy();
  }

  protected isMonthlyWorkbookDownloadDisabled(): boolean {
    return !this.canDownloadMonthlyWorkbook() || this.isReportExportBusy();
  }

  protected getMonthlyWorkbookStatusText(): string {
    const status = this.monthlyWorkbookStatus();
    if (!status || !status.exists) {
      return 'Monthly workbook not generated yet.';
    }

    if (!status.generatedAtUtc) {
      return `Available: ${status.fileName}`;
    }

    const generated = new Date(status.generatedAtUtc);
    if (Number.isNaN(generated.getTime())) {
      return `Available: ${status.fileName}`;
    }

    return `Last generated: ${this.formatGeneratedAt(generated)}`;
  }

  private downloadFile(kind: 'excel' | 'pdf'): void {
    const definition = this.definition();
    if (!definition || this.isActionBusy()) {
      return;
    }

    const query = this.buildQuery(definition);
    if (!query) {
      return;
    }

    const busy = kind === 'excel' ? this.isDownloadingExcel : this.isDownloadingPdf;
    const options = {
      search: this.searchTerm(),
      sortBy: this.sortKey() ?? undefined,
      sortDir: this.sortDirection(),
    };
    const request =
      kind === 'excel'
        ? this.reportsService.downloadReportExcel(definition.type, query, options)
        : this.reportsService.downloadReportPdf(definition.type, query, options);

    busy.set(true);
    request.subscribe({
      next: (blob) => {
        void this.fileDownload
          .saveBlob(
            blob,
            this.buildExportFileName(definition, kind === 'excel' ? 'xlsx' : 'pdf'),
            kind === 'excel'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'application/pdf',
          )
          .finally(() => busy.set(false));
      },
      error: (error: Error) => {
        busy.set(false);
        this.alertService.error(error.message);
      },
    });
  }

  private loadReport(): void {
    const definition = this.definition();
    if (!definition) {
      this.finishLoading();
      return;
    }

    const query = this.buildQuery(definition);
    if (!query) {
      this.finishLoading();
      return;
    }

    this.isLoading.set(true);
    this.connectionFailed.set(false);
    this.reportsService.getReport<ReportRow>(definition.type, query).subscribe({
      next: (rows) => {
        if (this.selectedType() !== definition.type) {
          return;
        }

        this.rows.set(rows);
        this.finishLoading();
      },
      error: (error: Error) => {
        this.connectionFailed.set(error.message === HttpErrorMessages.NetworkUnavailable);
        this.alertService.error(error.message);
        this.rows.set([]);
        this.finishLoading();
      },
    });
  }

  private finishLoading(): void {
    this.isLoading.set(false);
    this.isRefreshing.set(false);
  }

  private buildQuery(definition: ReportDefinition): ReportQuery | null {
    const form = this.reportForm.getRawValue();
    const query: ReportQuery = {};

    if (definition.usesDateRange) {
      if (!form.fromDate || !form.toDate) {
        this.alertService.error('Please select report filters first.');
        return null;
      }

      if (form.fromDate > form.toDate) {
        this.alertService.error('From date must be earlier than or equal to To date.');
        return null;
      }

      query.fromDate = form.fromDate;
      query.toDate = form.toDate;
    }

    if (definition.usesSource && form.source !== null) {
      query.source = form.source;
    }

    if (this.hasFilter('groupBy')) {
      query.groupBy = form.groupBy ?? 'Day';
    }

    if (this.hasFilter('wasteGroupBy')) {
      query.wasteGroupBy = form.wasteGroupBy;
    }

    if (this.hasFilter('productCategory')) {
      if (form.categoryId !== null) {
        query.categoryId = form.categoryId;
      }

      if (form.subCategoryId !== null) {
        query.subCategoryId = form.subCategoryId;
      }

      if (form.splitAddOns) {
        query.splitAddOns = true;
      }
    }

    if (this.hasFilter('staff') && form.staffId?.trim()) {
      query.staffId = form.staffId.trim();
    }

    return query;
  }

  private loadMonthlyWorkbookStatus(): void {
    const filter = this.getMonthlyWorkbookFilterOrShowError(false);
    if (!filter) {
      this.monthlyWorkbookStatus.set(null);
      return;
    }

    this.reportsService.getMonthlyWorkbookStatus(filter.year, filter.month, filter.source).subscribe({
      next: (status) => this.monthlyWorkbookStatus.set(status),
      error: () => this.monthlyWorkbookStatus.set(null),
    });
  }

  private getMonthlyWorkbookFilterOrShowError(
    showError = true,
  ): { year: number; month: number; source: ReportSource | null } | null {
    const year = this.reportForm.controls.workbookYear.value;
    const month = this.reportForm.controls.workbookMonth.value;
    const source = this.reportForm.controls.workbookSource.value;

    if (!year || !month) {
      if (showError) {
        this.alertService.error('Please select workbook month and year first.');
      }

      return null;
    }

    if (year < 2000 || year > 2100) {
      if (showError) {
        this.alertService.error('Workbook year must be between 2000 and 2100.');
      }

      return null;
    }

    if (month < 1 || month > 12) {
      if (showError) {
        this.alertService.error('Workbook month must be between 1 and 12.');
      }

      return null;
    }

    return { year, month, source };
  }

  private isActionBusy(): boolean {
    return (
      this.isDownloadingExcel() ||
      this.isDownloadingPdf() ||
      this.isDownloadingCsv() ||
      this.isGeneratingMonthlyWorkbook() ||
      this.isDownloadingMonthlyWorkbook()
    );
  }

  private buildMonthlyWorkbookFileName(year: number, month: number): string {
    return `WTF-Monthly-Reports-${year}-${String(month).padStart(2, '0')}.xlsx`;
  }

  private buildExportFileName(
    definition: ReportDefinition,
    extension: 'xlsx' | 'pdf' | 'csv',
  ): string {
    const name = definition.title
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9-]/g, '');
    const form = this.reportForm.getRawValue();
    const range = definition.usesDateRange
      ? `${(form.fromDate ?? '').replaceAll('-', '')}-${(form.toDate ?? '').replaceAll('-', '')}`
      : new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `WTF-${name}-${range}.${extension}`;
  }

  private formatGeneratedAt(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(date);

    const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('month')} ${part('day')}, ${part('year')} ${part('hour')}:${part('minute')} ${part('dayPeriod')}`.trim();
  }

  private applyPreset(preset: DatePreset): void {
    this.reportForm.controls.preset.setValue(preset);
    const range = resolveDatePreset(preset, new Date());
    if (range) {
      this.reportForm.patchValue(range);
    }
  }

  private loadStaffOptions(): void {
    this.userService.getUsers({ isActive: true }).subscribe({
      next: (users) => {
        this.staffOptions.set(
          users
            .filter((user) => user.username !== CUSTOMER_LINK_USERNAME)
            .map((user) => ({ id: user.id, name: this.toStaffDisplayName(user) }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
      error: () => this.staffOptions.set([]),
    });
  }

  private toStaffDisplayName(user: UserDto): string {
    const fullName = `${user.firstName} ${user.lastName}`.trim();
    return fullName.length > 0 ? `${fullName} (${user.username})` : user.username;
  }
}
