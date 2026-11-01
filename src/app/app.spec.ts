import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { emptyProject } from './core/services/blueprint.service';
import { parseProject, ProjectStorageService } from './core/services/project-storage.service';

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  beforeEach(async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
  function readText(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
  }
  function captureDownloads() {
    const blobs = new Map<string, Blob>();
    const download = vi.fn<(blob: Blob, filename: string) => void>();
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        const url = `blob:download-${blobs.size}`;
        blobs.set(url, blob);
        return url;
      },
      revokeObjectURL: () => {},
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      download(blobs.get(this.href)!, this.download);
    });
    return download;
  }
  function mockPngCanvas(blob: Blob) {
    const methods = [
      'setTransform',
      'clearRect',
      'fillRect',
      'beginPath',
      'moveTo',
      'lineTo',
      'stroke',
      'fillText',
      'arc',
      'fill',
      'save',
      'restore',
      'translate',
      'rotate',
      'drawImage',
      'setLineDash',
      'strokeRect',
    ];
    const ctx = Object.fromEntries(methods.map((name) => [name, vi.fn()]));
    ctx['measureText'] = vi.fn(() => ({ width: 10 }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    return vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(blob));
  }
  async function archiveNames(blob: Blob): Promise<string[]> {
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const view = new DataView(buffer),
      names: string[] = [];
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      const length = view.getUint16(offset + 26, true),
        extra = view.getUint16(offset + 28, true),
        size = view.getUint32(offset + 18, true);
      names.push(new TextDecoder().decode(new Uint8Array(buffer, offset + 30, length)));
      offset += 30 + length + extra + size;
    }
    return names;
  }
  it('downloads a portable project with references and imports it again without losing data', async () => {
    const fixture = TestBed.createComponent(App),
      app = fixture.componentInstance;
    await fixture.whenStable();
    const project = emptyProject();
    project.name = 'Portable test';
    project.points = [{ id: 'point-a', x: 2, y: 3, z: 4 }];
    project.objects[0].pointIds = ['point-a'];
    project.referenceImages = {
      bottom: {
        name: 'reference.png',
        dataUrl: 'data:image/png;base64,YQ==',
        pixelWidth: 800,
        pixelHeight: 400,
        centerU: 2,
        centerV: -3,
        width: 12,
        rotation: 30,
        opacity: 0.5,
        visible: true,
      },
    };
    app.state.project.set(project);
    const download = captureDownloads();
    app.save();
    expect(download).toHaveBeenCalledExactlyOnceWith(
      expect.any(Blob),
      'Portable-test.blueprint.json',
    );
    const json = await readText(download.mock.calls[0][0]);
    expect(parseProject(json)).toEqual(project);
    expect(TestBed.inject(ProjectStorageService).load()).toEqual(project);
    app.newProject();
    const input = { value: 'project.json', files: [{ size: json.length, text: async () => json }] };
    await app.importFile({ target: input } as unknown as Event);
    await fixture.whenStable();
    expect(app.state.project()).toEqual(project);
    expect(app.state.dirty()).toBe(false);
    expect(input.value).toBe('');
  });
  it('downloads even when browser storage is full and preserves the model on invalid imports', async () => {
    const fixture = TestBed.createComponent(App),
      app = fixture.componentInstance;
    await fixture.whenStable();
    const download = captureDownloads();
    vi.spyOn(TestBed.inject(ProjectStorageService), 'save').mockImplementation(() => {
      throw new Error('Storage full');
    });
    app.save();
    expect(download).toHaveBeenCalledOnce();
    expect(app.state.notice()).toContain('download started');
    const original = app.state.project();
    const input = { value: 'bad.json', files: [{ size: 2, text: async () => '{}' }] };
    await app.importFile({ target: input } as unknown as Event);
    expect(app.state.project()).toBe(original);
    expect(app.state.notice()).toContain('Import failed');
    expect(input.value).toBe('');
  });
  it('exports exactly the checked views, including Back and Bottom, in a single ZIP', async () => {
    const fixture = TestBed.createComponent(App),
      app = fixture.componentInstance;
    await fixture.whenStable();
    app.state.renameProject('PNG test');
    app.pngViews.set(['bottom', 'front', 'back']);
    const data = new Uint8Array([1, 2, 3]);
    const blob = new Blob([data], { type: 'image/png' });
    Object.defineProperty(blob, 'arrayBuffer', { value: async () => data.buffer });
    const render = mockPngCanvas(blob);
    const download = captureDownloads();
    const project = app.state.project();
    await app.exportPngs();
    expect(render).toHaveBeenCalledTimes(3);
    expect(app.state.project()).toBe(project);
    expect(download).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), 'PNG-test-views.zip');
    expect(download.mock.calls[0][0].type).toBe('application/zip');
    expect(await archiveNames(download.mock.calls[0][0])).toEqual([
      'PNG-test-front.png',
      'PNG-test-back.png',
      'PNG-test-bottom.png',
    ]);
    expect(app.pngExporting()).toBe(false);
  });
  it('downloads a single PNG directly and avoids empty or failed downloads', async () => {
    const fixture = TestBed.createComponent(App),
      app = fixture.componentInstance;
    await fixture.whenStable();
    app.state.renameProject('PNG test');
    const blob = new Blob(['png'], { type: 'image/png' });
    const render = mockPngCanvas(blob);
    const download = captureDownloads();
    app.pngViews.set(['bottom']);
    await app.exportPngs();
    expect(download).toHaveBeenCalledExactlyOnceWith(blob, 'PNG-test-bottom.png');
    download.mockClear();
    render.mockClear();
    app.pngViews.set([]);
    await app.exportPngs();
    expect(render).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    app.pngViews.set(['back', 'bottom']);
    render.mockImplementation((callback) => callback(null));
    await app.exportPngs();
    expect(download).not.toHaveBeenCalled();
    expect(app.state.notice()).toContain('PNG export failed');
    expect(app.pngExporting()).toBe(false);
  });

  it('renders the orthographic workspace', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Orthographic workspace');
    expect(compiled.querySelectorAll('app-viewport')).toHaveLength(3);
  });
  it.each([
    {
      base: 'front',
      opposite: 'back',
      title: 'Front',
      oppositeTitle: 'Back',
      index: 0,
      depth: 'Y',
    },
    {
      base: 'top',
      opposite: 'bottom',
      title: 'Top',
      oppositeTitle: 'Bottom',
      index: 2,
      depth: 'Z',
    },
  ] as const)(
    'routes the $opposite reference controls and viewport switch to the same pane',
    async ({ base, opposite, title, oppositeTitle, index, depth }) => {
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const app = fixture.componentInstance;
      app.selectReferenceView(opposite);
      fixture.detectChanges();
      expect(app.views()[index].view()).toBe(opposite);
      expect(app.state.activeView()).toBe(opposite);
      expect(app.planeAxis()).toBe(depth);
      const compiled = fixture.nativeElement as HTMLElement;
      (
        compiled.querySelector(`[aria-label="Switch to ${title} view"]`) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(app.referenceView()).toBe(base);
      expect(app.views()[index].view()).toBe(base);
      (
        compiled.querySelector(
          `[aria-label="Switch to ${oppositeTitle} view"]`,
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(app.referenceView()).toBe(opposite);
      expect(compiled.querySelectorAll('app-viewport')).toHaveLength(3);
    },
  );
});
