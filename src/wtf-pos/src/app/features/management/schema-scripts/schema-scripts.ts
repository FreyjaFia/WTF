import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { AlertService, SchemaScriptHistoryService } from '@core/services';
import { IconComponent, PullToRefreshComponent } from '@shared/components';
import { SchemaScriptHistoryDto } from '@shared/models';

@Component({
  selector: 'app-schema-scripts',
  imports: [CommonModule, IconComponent, PullToRefreshComponent],
  templateUrl: './schema-scripts.html',
  host: { class: 'flex-1 min-h-0' },
})
export class SchemaScriptsComponent implements OnInit {
  private readonly schemaScriptHistoryService = inject(SchemaScriptHistoryService);
  private readonly alertService = inject(AlertService);

  protected readonly scripts = signal<SchemaScriptHistoryDto[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isRefreshing = signal(false);
  protected readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';

  public ngOnInit(): void {
    this.loadScripts();
  }

  protected refresh(): void {
    this.isRefreshing.set(true);
    this.loadScripts();
  }

  private loadScripts(): void {
    this.isLoading.set(true);

    this.schemaScriptHistoryService.getExecutedScripts().subscribe({
      next: (data) => {
        this.scripts.set(data);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
      error: (err) => {
        this.alertService.error(err.message);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      },
    });
  }
}
