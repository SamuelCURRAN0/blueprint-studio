import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { BlueprintService } from '../../core/services/blueprint.service';
import { IconComponent } from '../../shared/icon.component';
import { format } from './viewport-renderer';

@Component({
  selector: 'app-point-context-menu',
  imports: [IconComponent],
  templateUrl: './point-context-menu.component.html',
  styleUrl: './point-context-menu.component.scss',
})
export class PointContextMenuComponent {
  readonly state = inject(BlueprintService);
  readonly size = input.required<{ width: number; height: number }>();
  readonly closed = output<void>();
  readonly page = signal<'actions' | 'points' | 'objects' | 'layers'>('actions');
  readonly menuElement = viewChild<ElementRef<HTMLElement>>('menuElement');
  readonly point = computed(() =>
    this.state.project().points.find((p) => p.id === this.state.pointContextMenu()?.pointId),
  );
  readonly owner = computed(() =>
    this.state.project().objects.find((o) => o.pointIds.includes(this.point()?.id ?? '')),
  );
  readonly choices = computed(() => {
    const ids = new Set(this.state.pointContextMenu()?.pointIds ?? []);
    const owners = new Map(
      this.state.project().objects.flatMap((o) => o.pointIds.map((id) => [id, o.name] as const)),
    );
    return this.state
      .project()
      .points.flatMap((point, index) =>
        ids.has(point.id) ? [{ point, number: index + 1, owner: owners.get(point.id) }] : [],
      );
  });
  readonly number = computed(
    () => this.state.project().points.findIndex((p) => p.id === this.point()?.id) + 1,
  );
  readonly layout = computed(() => {
    const { width, height } = this.size();
    const position = this.state.pointContextMenu()?.position ?? { u: 0, v: 0 };
    const panelWidth = Math.max(0, Math.min(270, width - 16));
    const maxHeight = Math.max(0, Math.min(360, height - 16));
    return {
      width: panelWidth,
      maxHeight,
      left: Math.max(8, Math.min(position.u + 4, width - panelWidth - 8)),
      top: Math.max(8, Math.min(position.v + 4, height - maxHeight - 8)),
    };
  });
  readonly format = format;

  constructor() {
    afterRenderEffect(() => {
      this.page();
      this.state.pointContextMenu();
      const element = this.menuElement()?.nativeElement;
      (
        element?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        element?.querySelector<HTMLButtonElement>('.close-menu')
      )?.focus();
    });
  }
  close(): void {
    this.state.dismissPointContextMenu();
    this.closed.emit();
  }
  choosePoint(id: string): void {
    this.state.select(id);
    this.state.pointContextMenu.update((menu) => (menu ? { ...menu, pointId: id } : null));
    this.page.set('actions');
  }
  deleteSelection(): void {
    this.close();
    this.state.deleteSelected();
  }
  duplicateSelection(): void {
    this.close();
    this.state.duplicateSelected();
  }
  moveToObject(id: string): void {
    this.close();
    this.state.moveSelectedToObject(id);
  }
  changeObjectLayer(layerId: string): void {
    const owner = this.owner();
    if (!owner) return;
    this.close();
    this.state.updateObject(owner.id, { layerId });
  }
  selectAll(): void {
    this.close();
    this.state.selectAll();
  }
  clearSelection(): void {
    this.close();
    this.state.select(null);
  }
  keydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey) {
      this.close();
      return;
    }
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      this.close();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (this.state.editableSelection().length) this.deleteSelection();
    } else if (event.key === 'ArrowLeft' && this.page() !== 'actions') {
      event.preventDefault();
      this.page.set('actions');
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = Array.from(
        this.menuElement()!.nativeElement.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not(:disabled)',
        ),
      );
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : index < 0
              ? event.key === 'ArrowUp'
                ? buttons.length - 1
                : 0
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }
}
