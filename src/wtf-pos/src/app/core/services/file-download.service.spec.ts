import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { ServiceErrorMessages } from '@core/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from './alert.service';
import { FileDownloadService } from './file-download.service';

const plugins = vi.hoisted(() => ({
  writeFile: vi.fn(),
  getUri: vi.fn(),
  open: vi.fn(),
  share: vi.fn(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Filesystem: { writeFile: plugins.writeFile, getUri: plugins.getUri },
}));
vi.mock('@capacitor-community/file-opener', () => ({ FileOpener: { open: plugins.open } }));
vi.mock('@capacitor/share', () => ({ Share: { share: plugins.share } }));

describe('FileDownloadService', () => {
  let service: FileDownloadService;
  let alerts: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let createUrl: ReturnType<typeof vi.spyOn>;
  let revokeUrl: ReturnType<typeof vi.spyOn>;
  const blob = new Blob(['hello'], { type: 'text/plain' });

  beforeEach(() => {
    alerts = { info: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: AlertService, useValue: alerts }] });
    service = TestBed.inject(FileDownloadService);

    createUrl = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:fake');
    revokeUrl = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => undefined);
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('web', () => {
    beforeEach(() => {
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
    });

    it('triggers a browser download and revokes the URL', async () => {
      const anchors: HTMLAnchorElement[] = [];
      clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
        anchors.push(this);
      });

      await service.saveBlob(blob, 'report.xlsx', 'application/xlsx');

      expect(createUrl).toHaveBeenCalledWith(blob);
      expect(anchors).toHaveLength(1);
      expect(anchors[0].download).toBe('report.xlsx');
      expect(anchors[0].href).toBe('blob:fake');
      expect(revokeUrl).toHaveBeenCalledWith('blob:fake');
    });
  });

  describe('android', () => {
    const { writeFile, getUri, open, share } = plugins;

    beforeEach(() => {
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
      writeFile.mockReset().mockResolvedValue({ uri: 'file://x' });
      getUri.mockReset().mockResolvedValue({ uri: 'file:///docs/r.pdf' });
      open.mockReset().mockResolvedValue(undefined);
      share.mockReset().mockResolvedValue({ activityType: 'x' });
    });

    it('writes to Documents, then opens the file', async () => {
      await service.saveBlob(blob, 'a.pdf', 'application/pdf', 'reports');

      const args = writeFile.mock.calls[0][0] as { path: string; data: string; directory: string };
      expect(args.path).toMatch(/^reports\/\d+-a\.pdf$/);
      expect(args.data).toBe(btoa('hello'));
      expect(args.directory).toBe('DOCUMENTS');
      expect(open).toHaveBeenCalledWith({
        filePath: 'file:///docs/r.pdf',
        contentType: 'application/pdf',
        openWithDefault: true,
      });
      expect(share).not.toHaveBeenCalled();
      expect(createUrl).not.toHaveBeenCalled();
    });

    it('sanitises illegal characters in the file name', async () => {
      await service.saveBlob(blob, ' a/b:c*.pdf ', 'application/pdf');

      const args = writeFile.mock.calls[0][0] as { path: string };
      expect(args.path).toMatch(/^reports\/\d+-a-b-c-\.pdf$/);
    });

    it('falls back to the Cache directory when Documents is not writable', async () => {
      writeFile.mockRejectedValueOnce(new Error('denied'));

      await service.saveBlob(blob, 'a.pdf', 'application/pdf');

      expect(writeFile).toHaveBeenCalledTimes(2);
      expect((writeFile.mock.calls[1][0] as { directory: string }).directory).toBe('CACHE');
      expect(getUri).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalled();
    });

    it('shares the file when it cannot be opened', async () => {
      open.mockRejectedValue(new Error('no app'));

      await service.saveBlob(blob, 'a.pdf', 'application/pdf');

      expect(share).toHaveBeenCalledWith({ title: 'Open file', files: ['file:///docs/r.pdf'] });
      expect(alerts.info).not.toHaveBeenCalled();
    });

    it('informs the user when neither open nor share works', async () => {
      open.mockRejectedValue(new Error('no app'));
      share.mockRejectedValue(new Error('cancelled'));

      await service.saveBlob(blob, 'a.pdf', 'application/pdf');

      expect(alerts.info).toHaveBeenCalledWith(ServiceErrorMessages.Report.FileOpenFailed);
    });

    it('falls back to a browser download when no directory is writable', async () => {
      writeFile.mockRejectedValue(new Error('denied'));

      await service.saveBlob(blob, 'a.pdf', 'application/pdf');

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(createUrl).toHaveBeenCalledWith(blob);
      expect(revokeUrl).toHaveBeenCalledWith('blob:fake');
      expect(alerts.error).not.toHaveBeenCalled();
    });

    it('reports an error when the browser fallback also fails', async () => {
      writeFile.mockRejectedValue(new Error('denied'));
      createUrl.mockImplementation(() => {
        throw new Error('no blob urls');
      });

      await service.saveBlob(blob, 'a.pdf', 'application/pdf');

      expect(alerts.error).toHaveBeenCalledWith(ServiceErrorMessages.Report.DownloadFileFailed);
    });

    it('falls back when getUri fails in every directory', async () => {
      getUri.mockRejectedValue(new Error('no uri'));

      await service.saveBlob(blob, 'a.pdf', 'application/pdf');

      expect(writeFile).toHaveBeenCalledTimes(2);
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
  });
});
