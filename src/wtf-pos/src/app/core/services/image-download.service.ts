import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Media } from '@capacitor-community/media';
import { toPng } from 'html-to-image';

interface MediaAlbum {
  identifier: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class ImageDownloadService {
  private readonly galleryAlbumName = 'WTF POS';

  public async downloadElementAsImage(element: HTMLElement, fileName: string): Promise<void> {
    const dataUrl = await toPng(element, {
      backgroundColor: '#ffffff',
      pixelRatio: 3,
      cacheBust: true,
    });

    if (Capacitor.getPlatform() === 'android') {
      await this.saveImageForAndroid(dataUrl, fileName);
      return;
    }

    if (Capacitor.isNativePlatform()) {
      const shared = await this.tryShareImageNative(dataUrl, fileName);
      if (!shared) {
        this.openImageFallback(dataUrl);
      }
      return;
    }

    this.triggerBrowserDownload(dataUrl, fileName);
  }

  private async saveImageForAndroid(dataUrl: string, fileName: string): Promise<void> {
    const safeFileName = this.normalizeFileName(fileName);
    const cachePath = `exports/${Date.now()}-${safeFileName}`;

    try {
      await this.ensureAndroidMediaPermissions();

      await Filesystem.writeFile({
        path: cachePath,
        data: this.extractBase64(dataUrl),
        directory: Directory.Cache,
        recursive: true,
      });

      const { uri } = await Filesystem.getUri({ path: cachePath, directory: Directory.Cache });
      const albumIdentifier = await this.getOrCreateAlbumIdentifier(this.galleryAlbumName);

      await Media.savePhoto({
        path: uri,
        albumIdentifier,
      });
    } catch {
      throw new Error('Failed to save image on Android');
    } finally {
      await this.deleteCacheFileQuietly(cachePath);
    }
  }

  private async ensureAndroidMediaPermissions(): Promise<void> {
    const fsPerms = await Filesystem.checkPermissions();
    if ((fsPerms as unknown as Record<string, string>)['publicStorage'] === 'prompt') {
      await Filesystem.requestPermissions();
    }

    try {
      const mediaPlugin = Media as unknown as {
        checkPermissions?: () => Promise<Record<string, string>>;
        requestPermissions?: () => Promise<Record<string, string>>;
      };
      if (!mediaPlugin.checkPermissions || !mediaPlugin.requestPermissions) {
        return;
      }

      const current = await mediaPlugin.checkPermissions();
      if (this.hasDeniedMediaPermission(current)) {
        const requested = await mediaPlugin.requestPermissions();
        if (this.hasDeniedMediaPermission(requested)) {
          throw new Error('Media permission denied');
        }
      }
    } catch {
      // Permission API varies by plugin version; save attempt handles final fallback.
    }
  }

  private hasDeniedMediaPermission(status: Record<string, string>): boolean {
    return Object.values(status).some((value) => value === 'denied' || value === 'prompt');
  }

  private async getOrCreateAlbumIdentifier(name: string): Promise<string> {
    const albums = await Media.getAlbums();
    const existing = (albums.albums as MediaAlbum[]).find((album: MediaAlbum) => album.name === name);
    if (existing?.identifier) {
      return existing.identifier;
    }

    await Media.createAlbum({ name });

    const updated = await Media.getAlbums();
    const created = (updated.albums as MediaAlbum[]).find((album: MediaAlbum) => album.name === name);
    return created?.identifier ?? this.resolveAlbumFallbackIdentifier(updated.albums as MediaAlbum[], name);
  }

  private resolveAlbumFallbackIdentifier(albums: MediaAlbum[], name: string): string {
    const maybe = albums.find((album: MediaAlbum) => album.name === name);
    if (maybe?.identifier) {
      return maybe.identifier;
    }

    throw new Error(`Unable to resolve album identifier for ${name}`);
  }

  private async tryShareImageNative(dataUrl: string, fileName: string): Promise<boolean> {
    try {
      const path = `exports/share-${Date.now()}-${this.normalizeFileName(fileName)}`;
      await Filesystem.writeFile({
        path,
        data: this.extractBase64(dataUrl),
        directory: Directory.Cache,
        recursive: true,
      });

      const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
      await Share.share({
        title: fileName,
        files: [uri],
      });

      await this.deleteCacheFileQuietly(path);
      return true;
    } catch {
      return false;
    }
  }

  private openImageFallback(dataUrl: string): void {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  private triggerBrowserDownload(dataUrl: string, fileName: string): void {
    const link = document.createElement('a');
    link.download = this.normalizeFileName(fileName);
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  private extractBase64(dataUrl: string): string {
    const marker = 'base64,';
    const markerIndex = dataUrl.indexOf(marker);
    if (markerIndex < 0) {
      throw new Error('Expected base64 data URL');
    }

    return dataUrl.slice(markerIndex + marker.length);
  }

  private normalizeFileName(fileName: string): string {
    const trimmed = fileName.trim();
    const name = trimmed.length > 0 ? trimmed : 'image.png';
    return name.toLowerCase().endsWith('.png') ? name : `${name}.png`;
  }

  private async deleteCacheFileQuietly(path: string): Promise<void> {
    try {
      await Filesystem.deleteFile({ path, directory: Directory.Cache });
    } catch {
      // Ignore cache cleanup failures.
    }
  }
}
