import {
  Component,
  computed,
  effect,
  HostListener,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BlueprintService, emptyProject } from './core/services/blueprint.service';
import { ViewportComponent } from './features/viewport/viewport.component';
import { IconComponent } from './shared/icon.component';
import { Tool, ViewType } from './core/models/blueprint';
import { parseProject, ProjectStorageService } from './core/services/project-storage.service';
import { demoProject } from './core/geometry/demo-project';
import { downloadBlob, exportSvg, exportTransform } from './core/geometry/export';
import { renderViewport } from './features/viewport/viewport-renderer';
import { readReferenceImage } from './core/geometry/reference-image';

@Component({
  selector: 'app-root',
  imports: [FormsModule, ViewportComponent, IconComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly state = inject(BlueprintService);
  private readonly storage = inject(ProjectStorageService);
  readonly menu = signal<'project' | 'export' | null>(null);
  readonly help = signal(false);
  readonly leftOpen = signal(false);
  readonly rightOpen = signal(false);
  readonly saveStatus = signal('Local workspace');
  readonly exportView = signal<ViewType>('front');
  readonly viewTypes: ViewType[] = ['front', 'side', 'top'];
  readonly referenceView = signal<ViewType>('front');
  readonly reference = computed(() => this.state.project().referenceImages?.[this.referenceView()]);
  readonly imageLoading = signal(false);
  private savedJson = '';
  readonly views = viewChildren(ViewportComponent);
  readonly tools: { id: Tool; label: string; key: string }[] = [
    { id: 'select', label: 'Select', key: 'V' },
    { id: 'add', label: 'Add point', key: 'P' },
    { id: 'move', label: 'Move', key: 'G' },
    { id: 'edge', label: 'Connect points', key: 'E' },
    { id: 'polyline', label: 'Polyline', key: 'L' },
    { id: 'rectangle', label: 'Rectangle', key: 'R' },
    { id: 'measure', label: 'Measure', key: 'M' },
    { id: 'delete-point', label: 'Delete point', key: 'D' },
    { id: 'delete-edge', label: 'Delete edge', key: 'K' },
  ];
  readonly axes = ['x', 'y', 'z'] as const;
  readonly splitX = signal(50);
  readonly splitY = signal(50);
  readonly planeAxis = () =>
    this.state.activeView() === 'front' ? 'Y' : this.state.activeView() === 'side' ? 'X' : 'Z';
  constructor() {
    try {
      const saved = this.storage.load();
      this.savedJson = saved ? JSON.stringify(saved) : '';
      const restored = this.storage.load(true);
      this.state.project.set(restored ?? saved ?? demoProject());
      this.state.activeObjectId.set(this.state.project().objects[0]?.id ?? '');
      this.state.notice.set(
        restored || saved
          ? 'Local project restored. Ready to continue.'
          : 'Example study loaded. Start a new project or explore the drawing tools.',
      );
    } catch (error) {
      this.state.notice.set(`Could not restore local data: ${this.error(error)}`);
    }
    effect((onCleanup) => {
      const project = this.state.project();
      this.state.dirty.set(JSON.stringify(project) !== this.savedJson);
      this.saveStatus.set('Saving recovery copy…');
      const timeout = setTimeout(() => {
        try {
          this.storage.save(project, true);
          this.saveStatus.set('Recovery saved locally');
        } catch {
          this.saveStatus.set('Storage unavailable · export JSON to keep your work');
        }
      }, 650);
      onCleanup(() => clearTimeout(timeout));
    });
  }
  @HostListener('window:beforeunload')
  flushRecovery(): void {
    try {
      this.storage.save(this.state.project(), true);
    } catch {
      /* The persistent status already reports unavailable storage. */
    }
  }
  private error(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error.';
  }
  newProject(): void {
    this.state.replaceProject(emptyProject());
    this.menu.set(null);
    this.views().forEach((v) => v.reset());
    this.state.notice.set(
      'New project. Add a point in two views. Undo restores your previous project.',
    );
  }
  save(): void {
    try {
      this.storage.save(this.state.project());
      this.savedJson = JSON.stringify(this.state.project());
      this.state.dirty.set(false);
      this.state.notice.set('Project saved in this browser. Export JSON for a portable backup.');
    } catch (error) {
      this.state.notice.set(`Save failed: ${this.error(error)}`);
    }
    this.menu.set(null);
  }
  load(): void {
    try {
      const project = this.storage.load();
      if (!project) {
        this.state.notice.set('No saved project yet. Use Save project to create one.');
        return;
      }
      this.state.replaceProject(project);
      this.fitAll();
      this.state.notice.set('Saved project opened.');
    } catch (error) {
      this.state.notice.set(`Open failed: ${this.error(error)}`);
    }
    this.menu.set(null);
  }
  loadExample(): void {
    this.state.replaceProject(demoProject());
    this.fitAll();
    this.menu.set(null);
    this.state.notice.set('Kart chassis study loaded. Dimensions are in metres.');
  }
  async importFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error('Project files must be smaller than 10 MB.');
      const project = parseProject(await file.text());
      this.state.replaceProject(project);
      this.fitAll();
      this.state.notice.set(`Imported ${project.name}.`);
    } catch (error) {
      this.state.notice.set(`Import failed: ${this.error(error)}`);
    }
    input.value = '';
    this.menu.set(null);
  }
  openReference(): void {
    this.referenceView.set(this.state.activeView());
    this.rightOpen.set(true);
    setTimeout(() =>
      document
        .getElementById('reference-image')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  }
  async importReference(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    const view = this.referenceView();
    this.imageLoading.set(true);
    try {
      const image = await readReferenceImage(file);
      const previous = this.state.project().referenceImages?.[view];
      this.state.setReferenceImage(view, {
        ...image,
        centerU: previous?.centerU ?? 0,
        centerV: previous?.centerV ?? 0,
        width: previous?.width ?? 10,
        opacity: previous?.opacity ?? 0.5,
        visible: true,
      });
      this.state.activeView.set(view);
      this.views()
        .find((v) => v.view() === view)
        ?.fit();
      this.state.notice.set(
        `Reference added to ${view} view. Adjust its width and position, then place points manually.`,
      );
    } catch (error) {
      this.state.notice.set(`Image import failed: ${this.error(error)}`);
    } finally {
      input.value = '';
      this.imageLoading.set(false);
    }
  }
  traceReference(): void {
    this.state.activeView.set(this.referenceView());
    this.state.setPointPlacement('plane');
    this.state.setTool('add');
    this.rightOpen.set(false);
    this.state.notice.set(
      `Click in ${this.referenceView()} view to trace points. The hidden ${this.planeAxis()} axis uses the construction depth.`,
    );
  }
  fitReference(): void {
    this.views()
      .find((v) => v.view() === this.referenceView())
      ?.fit();
  }
  export(format: 'json' | 'svg' | 'png'): void {
    const project = this.state.project(),
      view = this.exportView();
    const name = project.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/-+$/g, '') || 'blueprint';
    if (format === 'json')
      downloadBlob(
        new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }),
        `${name}.blueprint.json`,
      );
    if (format === 'svg')
      downloadBlob(
        new Blob([exportSvg(project, view, this.state.visiblePoints())], { type: 'image/svg+xml' }),
        `${name}-${view}.svg`,
      );
    if (format === 'png') {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1200;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        this.state.notice.set('PNG export is unavailable in this browser.');
        return;
      }
      renderViewport(
        ctx,
        {
          project,
          points: this.state.visiblePoints(),
          view,
          transform: exportTransform(project),
          width: 1200,
          height: 1200,
          grid: false,
          gridSize: this.state.gridSize(),
          labels: false,
          selectedId: null,
          pending: null,
          preview: null,
        },
        true,
      );
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${name}-${view}.png`);
        else this.state.notice.set('PNG export failed.');
      }, 'image/png');
    }
    this.menu.set(null);
    this.state.notice.set(
      `${format.toUpperCase()} exported${format !== 'json' ? ` · ${view} view · shared scale and origin` : ''}.`,
    );
  }
  resizePanels(event: PointerEvent, direction: 'x' | 'y'): void {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const rect = target.parentElement!.getBoundingClientRect();
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const ratio = Math.max(
        20,
        Math.min(
          80,
          direction === 'x'
            ? ((e.clientX - rect.left) / rect.width) * 100
            : ((e.clientY - rect.top) / rect.height) * 100,
        ),
      );
      (direction === 'x' ? this.splitX : this.splitY).set(ratio);
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }
  syncZoom(enabled: boolean): void {
    this.state.syncZoom.set(enabled);
    if (enabled) {
      const view = this.views().find((v) => v.view() === this.state.activeView());
      if (view) view.zoomAt(view.transform().scale);
    }
  }
  fitAll(): void {
    this.views().forEach((v) => v.fit());
    if (this.state.syncZoom()) {
      const scale = Math.min(...this.views().map((v) => v.transform().scale));
      const active = this.views().find((v) => v.view() === this.state.activeView());
      active?.zoomAt(scale);
    }
  }
  @HostListener('window:keydown', ['$event'])
  keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.menu.set(null);
      this.help.set(false);
      this.leftOpen.set(false);
      this.rightOpen.set(false);
      this.state.cancel();
      this.state.notice.set('Operation cancelled.');
      return;
    }
    const editing = (event.target as HTMLElement).matches('input,textarea,select');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (editing) (event.target as HTMLElement).blur();
      this.save();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !editing) {
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? this.state.redo() : this.state.undo();
      }
      if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.state.redo();
      }
      return;
    }
    if (editing || event.ctrlKey || event.metaKey || event.altKey) return;
    const tool = this.tools.find((t) => t.key.toLowerCase() === event.key.toLowerCase());
    if (tool) {
      event.preventDefault();
      this.state.setTool(tool.id);
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.fitAll();
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const id = this.state.selectedId();
      if (id) this.state.deletePoint(id);
    }
    if (event.key === '?') {
      this.help.set(!this.help());
    }
  }
}
