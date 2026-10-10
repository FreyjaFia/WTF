import { inject, Injectable } from '@angular/core';
import { FileOpener } from '@capacitor-community/file-opener';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { ServiceErrorMessages } from '@core/messages';
import { AlertService } from './alert.service';

/** Saves a generated file (Excel, PDF): a browser download on the web, open or share on Android. */
@Injectable({ providedIn: 'root' })
export class FileDownloadService {
  private readonly alertService = inject(AlertService);

  public async saveBlob(
    blob: Blob,
    fileName: string,
    contentType: string,
    folder = 'reports',
  ): Promise<void> {
    if (Capacitor.getPlatform() === 'android') {
      await this.saveAndOpenOnAndroid(blob, fileName, contentType, folder);
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
    folder: string,
  ): Promise<void> {
    try {
      const safeFileName = this.normalizeFileName(fileName);
      const path = `${folder}/${Date.now()}-${safeFileName}`;
      const base64Data = await this.blobToBase64(blob);

      const uri = await this.writeFileToAvailableDirectory(path, base64Data);

      const opened = await this.tryOpenFile(uri, contentType);
      if (!opened) {
        const shared = await this.tryShareFile(uri);
        if (!shared) {
          this.alertService.info(ServiceErrorMessages.Report.FileOpenFailed);
        }
      }
    } catch {
      try {
        this.triggerBrowserDownload(blob, fileName);
      } catch {
        this.alertService.error(ServiceErrorMessages.Report.DownloadFileFailed);
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

    throw new Error(ServiceErrorMessages.Report.NoWritableDirectory);
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

        reject(new Error(ServiceErrorMessages.Report.ReadBlobFailed));
      };
      reader.onerror = () =>
        reject(reader.error ?? new Error(ServiceErrorMessages.Report.ReadBlobFailed));
      reader.readAsDataURL(blob);
    });

    const marker = 'base64,';
    const markerIndex = dataUrl.indexOf(marker);
    if (markerIndex < 0) {
      throw new Error(ServiceErrorMessages.Report.InvalidBlobData);
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
}
