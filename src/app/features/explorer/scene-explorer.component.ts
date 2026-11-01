import {
  afterRenderEffect,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { BlueprintService } from '../../core/services/blueprint.service';
import { IconComponent } from '../../shared/icon.component';

type ExplorerTarget = { kind: 'object' | 'collection' | 'scene'; id: string };
const OBJECT_DRAG_TYPE = 'application/x-blueprint-object';

@Component({
  selector: 'app-scene-explorer',
  imports: [IconComponent, NgTemplateOutlet],
  templateUrl: './scene-explorer.component.html',
  styleUrl: './scene-explorer.component.scss',
})
export class SceneExplorerComponent {
  readonly state = inject(BlueprintService);
  readonly tree = viewChild.required<ElementRef<HTMLElement>>('tree');
  readonly menuElement = viewChild<ElementRef<HTMLElement>>('menuElement');
  readonly renaming = signal<ExplorerTarget | null>(null);
  readonly collapsed = signal(new Set<string>());
  readonly context = signal<{ target: ExplorerTarget; x: number; y: number } | null>(null);
  readonly page = signal<'actions' | 'collections' | 'layers'>('actions');
  readonly draggingObjectId = signal<string | null>(null);
  /** Undefined means no target; null is the Ungrouped destination. */
  readonly dropTarget = signal<string | null | undefined>(undefined);
  readonly groups = computed(() =>
    (this.state.project().collections ?? []).map((collection) => ({
      collection,
      objects: this.state.project().objects.filter((o) => o.collectionId === collection.id),
    })),
  );
  readonly ungrouped = computed(() => this.state.project().objects.filter((o) => !o.collectionId));
  readonly contextObject = computed(() =>
    this.context()?.target.kind === 'object'
      ? this.state.project().objects.find((o) => o.id === this.context()?.target.id)
      : undefined,
  );
  readonly contextCollection = computed(() =>
    this.context()?.target.kind === 'collection'
      ? this.state.project().collections?.find((c) => c.id === this.context()?.target.id)
      : undefined,
  );
  readonly objectLocked = computed(
    () =>
      !!this.contextObject()?.locked ||
      this.state.project().layers.some((l) => l.id === this.contextObject()?.layerId && l.locked),
  );
  readonly menuLayout = computed(() => {
    const width = Math.max(0, Math.min(260, window.innerWidth - 16));
    const maxHeight = Math.max(0, Math.min(400, window.innerHeight - 16));
    return {
      width,
      maxHeight,
      left: Math.max(8, Math.min(this.context()?.x ?? 8, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(this.context()?.y ?? 8, window.innerHeight - maxHeight - 8)),
    };
  });
  constructor() {
    effect(() => {
      this.state.project();
      untracked(() => {
        this.context.set(null);
        this.endObjectDrag();
      });
    });
    afterRenderEffect(() => {
      if (this.renaming()) {
        const input = this.tree().nativeElement.querySelector<HTMLInputElement>('[data-rename]');
        input?.focus();
        input?.select();
      } else if (this.context()) {
        this.page();
        this.menuElement()
          ?.nativeElement.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
          ?.focus();
      }
    });
  }
  toggleCollection(id: string): void {
    this.collapsed.update((ids) => {
      const next = new Set(ids);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  startObjectDrag(event: DragEvent, id: string): void {
    const object = this.state.project().objects.find((o) => o.id === id);
    if (!object || this.renaming() || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    event.dataTransfer.setData(OBJECT_DRAG_TYPE, id);
    event.dataTransfer.effectAllowed = 'move';
    this.context.set(null);
    this.state.activateObject(id);
    this.draggingObjectId.set(id);
    this.dropTarget.set(undefined);
  }
  private canDrop(collectionId: string | null): boolean {
    const object = this.state.project().objects.find((o) => o.id === this.draggingObjectId());
    return (
      !!object &&
      (object.collectionId ?? null) !== collectionId &&
      (collectionId === null ||
        !!this.state.project().collections?.some((c) => c.id === collectionId))
    );
  }
  dragOverCollection(event: DragEvent, collectionId: string | null): void {
    if (!event.dataTransfer?.types.includes(OBJECT_DRAG_TYPE) || !this.canDrop(collectionId)) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      this.dropTarget.set(undefined);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    this.dropTarget.set(collectionId);
  }
  leaveDropTarget(event: DragEvent, collectionId: string | null): void {
    if (
      event.currentTarget instanceof Node &&
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    )
      return;
    if (this.dropTarget() === collectionId) this.dropTarget.set(undefined);
  }
  dropOnCollection(event: DragEvent, collectionId: string | null): void {
    event.preventDefault();
    event.stopPropagation();
    const id = this.draggingObjectId();
    const accepted =
      id && event.dataTransfer?.getData(OBJECT_DRAG_TYPE) === id && this.canDrop(collectionId);
    this.endObjectDrag();
    if (!accepted || !id) return;
    this.state.moveObjectToCollection(id, collectionId);
    if (collectionId)
      this.collapsed.update((ids) => new Set([...ids].filter((entry) => entry !== collectionId)));
    this.tree().nativeElement.focus({ preventScroll: true });
  }
  @HostListener('document:dragend')
  @HostListener('document:drop')
  endObjectDrag(): void {
    this.draggingObjectId.set(null);
    this.dropTarget.set(undefined);
  }
  @HostListener('document:keydown', ['$event'])
  cancelObjectDrag(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.draggingObjectId()) {
      event.stopPropagation();
      this.endObjectDrag();
    }
  }
  addObject(collectionId: string | null): void {
    this.close();
    this.state.createObject(undefined, true, collectionId);
    if (collectionId)
      this.collapsed.update((ids) => new Set([...ids].filter((id) => id !== collectionId)));
  }
  addCollection(objectId?: string): void {
    this.close();
    const id = this.state.createCollection(objectId);
    if (id) this.renaming.set({ kind: 'collection', id });
  }
  openContext(event: MouseEvent, target: ExplorerTarget): void {
    event.stopPropagation();
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    this.openMenu(target, event.clientX, event.clientY);
  }
  contextKeydown(event: KeyboardEvent, target: ExplorerTarget): void {
    if (
      event.target instanceof HTMLInputElement ||
      !(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.openMenu(target, rect.left + 12, rect.bottom);
  }
  private openMenu(target: ExplorerTarget, x: number, y: number): void {
    this.state.cancel();
    if (target.kind === 'object') this.state.activateObject(target.id);
    this.renaming.set(null);
    this.page.set('actions');
    this.context.set({ target, x, y });
  }
  close(): void {
    this.context.set(null);
    this.tree().nativeElement.focus();
  }
  beginRename(target: ExplorerTarget): void {
    this.close();
    this.renaming.set(target);
  }
  finishRename(target: ExplorerTarget, value: string): void {
    if (this.renaming()?.id !== target.id || this.renaming()?.kind !== target.kind) return;
    this.renaming.set(null);
    if (target.kind === 'object') this.state.updateObject(target.id, { name: value });
    else this.state.renameCollection(target.id, value);
  }
  renameKeydown(event: KeyboardEvent, target: ExplorerTarget): void {
    if (!['Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter') this.finishRename(target, (event.target as HTMLInputElement).value);
    else this.renaming.set(null);
    this.tree().nativeElement.focus();
  }
  moveToCollection(collectionId: string | null): void {
    const object = this.contextObject();
    this.close();
    if (object) this.state.moveObjectToCollection(object.id, collectionId);
  }
  changeLayer(layerId: string): void {
    const object = this.contextObject();
    this.close();
    if (object) this.state.updateObject(object.id, { layerId });
  }
  deleteTarget(): void {
    const target = this.context()?.target;
    this.close();
    if (target?.kind === 'object') this.state.deleteObject(target.id);
    else if (target?.kind === 'collection') this.state.deleteCollection(target.id);
  }
  toggleObject(field: 'visible' | 'locked'): void {
    const object = this.contextObject();
    this.close();
    if (object) this.state.updateObject(object.id, { [field]: !object[field] });
  }
  toggleCollectionVisibility(id: string): void {
    const collection = this.state.project().collections?.find((c) => c.id === id);
    this.close();
    if (collection) this.state.setCollectionVisibility(id, collection.visible === false);
  }
  menuKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey) {
      this.close();
      return;
    }
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      this.close();
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
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : index < 0
              ? 0
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }
  @HostListener('document:pointerdown', ['$event'])
  @HostListener('document:wheel', ['$event'])
  dismissOutside(event: Event): void {
    if (
      this.context() &&
      !(event.target instanceof Element && event.target.closest('.explorer-context-menu'))
    )
      this.context.set(null);
  }
  @HostListener('window:resize')
  dismissOnResize(): void {
    this.context.set(null);
  }
}
