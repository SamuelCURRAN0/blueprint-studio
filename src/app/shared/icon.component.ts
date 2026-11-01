import { Component, input } from '@angular/core';
const paths: Record<string, string> = {
  image: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M16 7h.01',
  'move-reference':
    'M3 3h12v7M3 15V3M3 12l4-4 4 4M17 10v12M11 16h12M14 13l-3 3 3 3M20 13l3 3-3 3M14 13l3-3 3 3M14 19l3 3 3-3',
  select: 'M5 3l14 9-7 1-3 7z',
  add: 'M12 4v16M4 12h16',
  move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  'delete-point': 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7',
  edge: 'M6 18L18 6M3 16h5v5H3zM16 3h5v5h-5z',
  'delete-edge': 'M4 20L20 4M4 4l16 16',
  rectangle: 'M4 5h16v14H4z',
  polyline: 'M3 17l6-10 6 10 6-10M2 16h2v2H2zM8 6h2v2H8zM14 16h2v2h-2zM20 6h2v2h-2z',
  measure: 'M3 17L17 3l4 4L7 21zM8 12l3 3M12 8l3 3M16 4l3 3',
  save: 'M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8',
  folder: 'M3 6h7l2 2h9v12H3z',
  download: 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
  undo: 'M8 5L3 10l5 5M3 10h11a6 6 0 010 12',
  redo: 'M16 5l5 5-5 5M21 10H10a6 6 0 000 12',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM15 12a3 3 0 11-6 0 3 3 0 016 0',
  hidden: 'M3 3l18 18M10 5h2c6 0 10 7 10 7a22 22 0 01-4 5M6 6a22 22 0 00-4 6s4 7 10 7h2',
  lock: 'M6 10h12v11H6zM8 10V6a4 4 0 018 0v4',
  unlock: 'M6 10h12v11H6zM8 10V6a4 4 0 018 0',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  layers: 'M12 3l10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5',
  chevron: 'M9 5l7 7-7 7',
  fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8h8v8H8z',
  reset: 'M3 10a9 9 0 119 11M3 3v7h7',
  grid: 'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18',
  magnet: 'M5 3v10a7 7 0 0014 0V3h-5v10a2 2 0 01-4 0V3zM5 7h5M14 7h5',
  link: 'M9 15l6-6M8 13l-2 2a3 3 0 004 4l3-3M16 11l2-2a3 3 0 00-4-4l-3 3',
  help: 'M9 8a3 3 0 116 0c0 3-3 2-3 5M12 17v.1M22 12a10 10 0 11-20 0 10 10 0 0120 0',
  check: 'M5 12l4 4L19 6',
  close: 'M5 5l14 14M5 19L19 5',
  logo: 'M4 5h10l6 6v8H4zM4 11h16M10 5v14M14 5v6',
  point: 'M12 3v4M12 17v4M3 12h4M17 12h4M15 12a3 3 0 11-6 0 3 3 0 016 0',
  keyboard: 'M2 5h20v14H2zM5 8h1M9 8h1M13 8h1M17 8h1M5 12h1M9 12h1M13 12h1M17 12h1M7 16h10',
};
@Component({
  selector: 'app-icon',
  template:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="path()" /></svg>',
  styles: [
    ':host{display:inline-flex;width:17px;height:17px;flex-shrink:0}svg{width:100%;height:100%}',
  ],
})
export class IconComponent {
  readonly name = input('cube');
  path(): string {
    return paths[this.name()] ?? paths['cube'];
  }
}
