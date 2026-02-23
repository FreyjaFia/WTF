import { Injectable } from '@angular/core';
import { toPng } from 'html-to-image';

@Injectable({ providedIn: 'root' })
export class ImageDownloadService {
  public async downloadElementAsImage(
    element: HTMLElement,
    fileName: string,
  ): Promise<void> {
    const dataUrl = await toPng(element, {
      backgroundColor: '#ffffff',
      pixelRatio: 2,
      cacheBust: true,
    });

    const link = document.createElement('a');
    link.download = fileName;
    link.href = dataUrl;
    link.click();
  }
}
