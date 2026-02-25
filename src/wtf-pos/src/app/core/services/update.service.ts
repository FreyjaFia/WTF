import { Injectable, OnDestroy, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { appVersion } from '@environments/version';
import { environment } from '@environments/environment.development';

interface GitHubReleaseAsset {
  browser_download_url?: string;
  name?: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  body?: string;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
}

export interface AppUpdateInfo {
  version: string;
  downloadUrl: string;
  releaseNotes: string;
}

@Injectable({ providedIn: 'root' })
export class UpdateService implements OnDestroy {
  private static readonly CHECK_INTERVAL_MS = 30 * 60 * 1000;
  private static readonly REQUEST_TIMEOUT_MS = 8000;
  private static readonly DISMISS_KEY = 'wtf-update-dismissed-version';

  private readonly _updateAvailable = signal(false);
  public readonly updateAvailable = this._updateAvailable.asReadonly();

  private readonly _latest = signal<AppUpdateInfo | null>(null);
  public readonly latest = this._latest.asReadonly();

  private readonly isAndroidPlatform = Capacitor.getPlatform() === 'android';
  private readonly releasesUrl = this.buildReleasesUrl();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onlineHandler = (): void => {
    void this.checkForUpdates();
  };
  private checkInProgress = false;

  constructor() {
    if (!this.isAndroidPlatform || !this.releasesUrl) {
      return;
    }

    void this.checkForUpdates();
    this.checkTimer = setInterval(() => {
      void this.checkForUpdates();
    }, UpdateService.CHECK_INTERVAL_MS);
    window.addEventListener('online', this.onlineHandler);
  }

  public ngOnDestroy(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    window.removeEventListener('online', this.onlineHandler);
  }

  public async checkForUpdates(): Promise<void> {
    if (!this.isAndroidPlatform || !this.releasesUrl || this.checkInProgress || !navigator.onLine) {
      return;
    }

    this.checkInProgress = true;

    try {
      const release = await this.fetchLatestRelease();
      if (!release) {
        return;
      }

      const latestTag = (release.tag_name ?? '').trim();
      const latestVersion = this.normalizeVersion(latestTag);

      if (!latestVersion || !this.isNewerVersion(latestVersion, appVersion)) {
        this._updateAvailable.set(false);
        return;
      }

      const dismissedVersion = localStorage.getItem(UpdateService.DISMISS_KEY);
      if (dismissedVersion === latestVersion) {
        this._updateAvailable.set(false);
        return;
      }

      const downloadUrl = this.pickDownloadUrl(release);
      if (!downloadUrl) {
        this._updateAvailable.set(false);
        return;
      }

      this._latest.set({
        version: latestVersion,
        downloadUrl,
        releaseNotes: release.body?.trim() ?? '',
      });
      this._updateAvailable.set(true);
    } catch {
      // Silent failure to avoid blocking app startup on update checks.
    } finally {
      this.checkInProgress = false;
    }
  }

  public async openDownload(): Promise<void> {
    const info = this._latest();
    if (!info?.downloadUrl) {
      return;
    }

    this.hideForNow();
    window.open(info.downloadUrl, '_blank', 'noopener,noreferrer');
  }

  public dismiss(): void {
    const info = this._latest();
    if (!info) {
      this._updateAvailable.set(false);
      return;
    }

    localStorage.setItem(UpdateService.DISMISS_KEY, info.version);
    this._updateAvailable.set(false);
  }

  public hideForNow(): void {
    this._updateAvailable.set(false);
  }

  private buildReleasesUrl(): string | null {
    const owner = (environment.githubRepoOwner ?? '').trim();
    const repo = (environment.githubRepoName ?? '').trim();

    if (!owner || !repo) {
      return null;
    }

    return `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  }

  private async fetchLatestRelease(): Promise<GitHubReleaseResponse | null> {
    const url = this.releasesUrl;
    if (!url) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UpdateService.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
        },
      });

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as GitHubReleaseResponse;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private pickDownloadUrl(release: GitHubReleaseResponse): string | null {
    const assets = release.assets ?? [];
    const apkAsset = assets.find((asset) => {
      const name = (asset.name ?? '').toLowerCase();
      return name.endsWith('.apk');
    });

    if (apkAsset?.browser_download_url) {
      return apkAsset.browser_download_url;
    }

    return release.html_url ?? null;
  }

  private normalizeVersion(version: string): string {
    return version.replace(/^v/i, '');
  }

  private isNewerVersion(candidate: string, current: string): boolean {
    const candidateParts = this.parseSemver(candidate);
    const currentParts = this.parseSemver(current);

    if (!candidateParts || !currentParts) {
      return false;
    }

    for (let i = 0; i < 3; i++) {
      if (candidateParts[i] > currentParts[i]) {
        return true;
      }

      if (candidateParts[i] < currentParts[i]) {
        return false;
      }
    }

    return false;
  }

  private parseSemver(version: string): [number, number, number] | null {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
      return null;
    }

    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
}
