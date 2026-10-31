import { Injectable, signal } from '@angular/core';
import { BlueprintProject } from '../models/blueprint';

@Injectable({ providedIn: 'root' })
export class HistoryService {
  private past: BlueprintProject[] = [];
  private future: BlueprintProject[] = [];
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  record(project: BlueprintProject): void {
    this.past.push(structuredClone(project));
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.update();
  }
  undo(current: BlueprintProject): BlueprintProject | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(structuredClone(current));
    this.update();
    return previous;
  }
  redo(current: BlueprintProject): BlueprintProject | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(structuredClone(current));
    this.update();
    return next;
  }
  clear(): void {
    this.past = [];
    this.future = [];
    this.update();
  }
  private update(): void {
    this.canUndo.set(this.past.length > 0);
    this.canRedo.set(this.future.length > 0);
  }
}
