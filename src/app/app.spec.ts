import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
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
