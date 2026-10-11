import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { ServiceErrorMessages, SuccessMessages } from '@core/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from './alert.service';
import { ImageDownloadService } from './image-download.service';

const plugins = vi.hoisted(() => ({
  toPng: vi.fn(),
  writeFile: vi.fn(),
  getUri: vi.fn(),
  deleteFile: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  open: vi.fn(),
  share: vi.fn(),
  getAlbums: vi.fn(),
  createAlbum: vi.fn(),
  savePhoto: vi.fn(),
  mediaCheck: vi.fn(),
  mediaRequest: vi.fn(),
}));

vi.mock('html-to-image', () => ({ toPng: plugins.toPng }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Filesystem: {
    writeFile: plugins.writeFile,
    getUri: plugins.getUri,
    deleteFile: plugins.deleteFile,
    checkPermissions: plugins.checkPermissions,
    requestPermissions: plugins.requestPermissions,
  },
}));
vi.mock('@capacitor-community/file-opener', () => ({ FileOpener: { open: plugins.open } }));
vi.mock('@capacitor/share', () => ({ Share: { share: plugins.share } }));
vi.mock('@capacitor-community/media', () => ({
  Media: {
    getAlbums: plugins.getAlbums,
    createAlbum: plugins.createAlbum,
    savePhoto: plugins.savePhoto,
    checkPermissions: plugins.mediaCheck,
    requestPermissions: plugins.mediaRequest,
  },
}));

const DATA_URL = 'data:image/png;base64,QUJD';

describe('ImageDownloadService', () => {
  let service: ImageDownloadService;
  let alerts: {
    successWithAction: ReturnType<typeof vi.fn>;
  };
  let clickSpy: ReturnType<typeof vi.spyOn>;
  const element = document.createElement('div');

  beforeEach(() => {
    for (const fn of Object.values(plugins)) {
      fn.mockReset();
    }
    plugins.toPng.mockResolvedValue(DATA_URL);
    plugins.writeFile.mockResolvedValue({ uri: 'x' });
    plugins.getUri.mockResolvedValue({ uri: 'file:///cache/img.png' });
    plugins.deleteFile.mockResolvedValue(undefined);
    plugins.checkPermissions.mockResolvedValue({ publicStorage: 'granted' });
    plugins.mediaCheck.mockResolvedValue({ photos: 'granted' });
    plugins.getAlbums.mockResolvedValue({ albums: [{ identifier: 'alb-1', name: 'WTF POS' }] });
    plugins.savePhoto.mockResolvedValue({ filePath: 'file:///gallery/img.png' });
    plugins.open.mockResolvedValue(undefined);
    plugins.share.mockResolvedValue({});

    alerts = { successWithAction: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: AlertService, useValue: alerts }] });
    service = TestBed.inject(ImageDownloadService);
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the element with the expected options', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);

    await service.downloadElementAsImage(element, 'receipt');

    expect(plugins.toPng).toHaveBeenCalledWith(element, {
      backgroundColor: '#ffffff',
      pixelRatio: 3,
      cacheBust: true,
    });
  });

  describe('web', () => {
    beforeEach(() => {
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    });

    it('downloads via an anchor with a .png suffix and removes it', async () => {
      const anchors: HTMLAnchorElement[] = [];
      clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
        anchors.push(this);
      });

      await service.downloadElementAsImage(element, 'receipt');

      expect(anchors).toHaveLength(1);
      expect(anchors[0].download).toBe('receipt.png');
      expect(anchors[0].href).toBe(DATA_URL);
      expect(anchors[0].isConnected).toBe(false);
    });

    it('keeps an existing .png extension (case-insensitive)', async () => {
      const anchors: HTMLAnchorElement[] = [];
      clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
        anchors.push(this);
      });

      await service.downloadElementAsImage(element, 'Receipt.PNG');

      expect(anchors[0].download).toBe('Receipt.PNG');
    });

    it('uses image.png for blank names', async () => {
      const anchors: HTMLAnchorElement[] = [];
      clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
        anchors.push(this);
      });

      await service.downloadElementAsImage(element, '   ');

      expect(anchors[0].download).toBe('image.png');
    });

    it('propagates render failures', async () => {
      plugins.toPng.mockRejectedValue(new Error('render failed'));

      await expect(service.downloadElementAsImage(element, 'x')).rejects.toThrow('render failed');
    });
  });

  describe('native non-android (ios)', () => {
    beforeEach(() => {
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    });

    it('shares the cached file and deletes it afterwards', async () => {
      await service.downloadElementAsImage(element, 'r');

      expect(plugins.writeFile.mock.calls[0][0]).toMatchObject({
        data: 'QUJD',
        directory: 'CACHE',
        recursive: true,
      });
      expect(plugins.share).toHaveBeenCalledWith({
        title: 'r',
        files: ['file:///cache/img.png'],
      });
      expect(plugins.deleteFile).toHaveBeenCalledTimes(1);
      expect(clickSpy).not.toHaveBeenCalled();
    });

    it('opens the image in a new tab when sharing fails', async () => {
      plugins.share.mockRejectedValue(new Error('cancelled'));
      const anchors: HTMLAnchorElement[] = [];
      clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
        anchors.push(this);
      });

      await service.downloadElementAsImage(element, 'r');

      expect(anchors).toHaveLength(1);
      expect(anchors[0].target).toBe('_blank');
      expect(anchors[0].rel).toBe('noopener');
      expect(anchors[0].href).toBe(DATA_URL);
    });
  });

  describe('android', () => {
    beforeEach(() => {
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    });

    it('saves to the existing gallery album and offers to open it', async () => {
      await service.downloadElementAsImage(element, 'receipt');

      expect(plugins.writeFile.mock.calls[0][0]).toMatchObject({
        data: 'QUJD',
        directory: 'CACHE',
      });
      expect(plugins.savePhoto).toHaveBeenCalledWith({
        path: 'file:///cache/img.png',
        albumIdentifier: 'alb-1',
      });
      expect(plugins.createAlbum).not.toHaveBeenCalled();
      expect(plugins.deleteFile).toHaveBeenCalledTimes(1);
      expect(alerts.successWithAction).toHaveBeenCalledTimes(1);
      const [message, label, action] = alerts.successWithAction.mock.calls[0];
      expect(message).toBe(SuccessMessages.OrderReceipt.ImageSavedToGallery);
      expect(label).toBe('Open');

      action();
      await vi.waitFor(() => expect(plugins.open).toHaveBeenCalled());
      expect(plugins.open).toHaveBeenCalledWith({
        filePath: 'file:///gallery/img.png',
        contentType: 'image/png',
        openWithDefault: false,
      });
      expect(plugins.share).not.toHaveBeenCalled();
    });

    it('creates the album when missing', async () => {
      plugins.getAlbums
        .mockResolvedValueOnce({ albums: [] })
        .mockResolvedValueOnce({ albums: [{ identifier: 'new-1', name: 'WTF POS' }] });

      await service.downloadElementAsImage(element, 'r');

      expect(plugins.createAlbum).toHaveBeenCalledWith({ name: 'WTF POS' });
      expect(plugins.savePhoto).toHaveBeenCalledWith({
        path: 'file:///cache/img.png',
        albumIdentifier: 'new-1',
      });
    });

    it('fails with SaveImageFailed when the album cannot be resolved, still cleaning up', async () => {
      plugins.getAlbums.mockResolvedValue({ albums: [] });

      await expect(service.downloadElementAsImage(element, 'r')).rejects.toThrow(
        ServiceErrorMessages.Common.SaveImageFailed,
      );
      expect(plugins.deleteFile).toHaveBeenCalledTimes(1);
      expect(alerts.successWithAction).not.toHaveBeenCalled();
    });

    it('fails with SaveImageFailed when saving the photo fails', async () => {
      plugins.savePhoto.mockRejectedValue(new Error('disk full'));

      await expect(service.downloadElementAsImage(element, 'r')).rejects.toThrow(
        ServiceErrorMessages.Common.SaveImageFailed,
      );
    });

    it('ignores cache cleanup failures', async () => {
      plugins.deleteFile.mockRejectedValue(new Error('gone'));

      await service.downloadElementAsImage(element, 'r');

      expect(alerts.successWithAction).toHaveBeenCalled();
    });

    it('requests filesystem permissions when publicStorage is prompt', async () => {
      plugins.checkPermissions.mockResolvedValue({ publicStorage: 'prompt' });

      await service.downloadElementAsImage(element, 'r');

      expect(plugins.requestPermissions).toHaveBeenCalledTimes(1);
    });

    it('requests media permissions when denied and continues even if still denied', async () => {
      plugins.mediaCheck.mockResolvedValue({ photos: 'denied' });
      plugins.mediaRequest.mockResolvedValue({ photos: 'denied' });

      await service.downloadElementAsImage(element, 'r');

      expect(plugins.mediaRequest).toHaveBeenCalledTimes(1);
      expect(plugins.savePhoto).toHaveBeenCalled();
    });

    it('does not request media permissions when granted', async () => {
      await service.downloadElementAsImage(element, 'r');

      expect(plugins.mediaRequest).not.toHaveBeenCalled();
      expect(plugins.requestPermissions).not.toHaveBeenCalled();
    });

    it('falls back to the share sheet when the file opener fails', async () => {
      plugins.open.mockRejectedValue(new Error('no viewer'));

      await service.downloadElementAsImage(element, 'r');
      const action = alerts.successWithAction.mock.calls[0][2] as () => void;
      action();

      await vi.waitFor(() => expect(plugins.share).toHaveBeenCalled());
      expect(plugins.share).toHaveBeenCalledWith({
        title: 'Open image',
        files: ['file:///gallery/img.png'],
      });
    });

    it('opens the cache uri when the plugin returns no file path', async () => {
      plugins.savePhoto.mockResolvedValue({});

      await service.downloadElementAsImage(element, 'r');
      const action = alerts.successWithAction.mock.calls[0][2] as () => void;
      action();

      await vi.waitFor(() => expect(plugins.open).toHaveBeenCalled());
      expect(plugins.open.mock.calls[0][0].filePath).toBe('file:///cache/img.png');
    });
  });
});
