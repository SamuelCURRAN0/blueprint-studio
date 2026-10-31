# Blueprint Studio

A browser-local orthographic CAD editor built in the existing Angular 21 project. Standalone components, Angular Signals, strict TypeScript, SCSS and Canvas 2D; no added runtime dependencies.

## Run

```sh
npm install
npm start
```

Open `http://localhost:4200`. A kart chassis study appears on first use. Choose **Project → New project** for a blank drawing. Existing recovery data is restored automatically.

```sh
npm run build
npm test -- --watch=false
```

The production application is emitted to `dist/blueprint-studio/browser`. Tests use the project's Angular/Vitest configuration.

## Coordinates and point creation

One canonical `BlueprintPoint { id, x, y, z }` represents each 3D point. Viewports derive projections; there are no separate per-view point stores.

| View  | Horizontal axis, positive right | Vertical axis, positive up | Hidden coordinate |
| ----- | ------------------------------- | -------------------------- | ----------------- |
| Front | X, width                        | Z, height                  | Y                 |
| Side  | Y, length                       | Z, height                  | X                 |
| Top   | X, width                        | Y, length                  | Z                 |

This is a consistent right-handed XYZ convention with Z up. The labels are modeling projections, rather than a claim of a first-angle or third-angle engineering sheet convention. The top view shows positive Y up the screen. All views use **40 CSS pixels per world unit at 100% zoom**. Each view can zoom or pan independently. Units (`m`, `cm`, `mm`) label world coordinates; changing the label does not rescale existing numeric values.

1. Activate **Add point** (`P`). Click Front at X=2, Z=3. This stores an incomplete projection, not a fabricated 3D point.
2. Move to Side. The gold guide fixes Z=3; only Y follows the cursor. A live preview appears in all three views.
3. Click at Y=5. The resulting point is exactly `(2, 5, 3)`, and Top projects it to `(2, 5)`.

Every pair of distinct views works in either order. Clicking the first view again revises that first projection. `Escape` cancels. The pure `combineProjections` function independently rejects contradictory shared coordinates; the UI explicitly constrains the second click before calling it.

Select or drag a point to change its two visible axes while preserving the hidden coordinate. Enter exact X/Y/Z values in Properties; edits commit on leaving the field. Finite coordinates within ±1 billion are supported. Selection respects visibility; editing also respects object and layer locks.

## Reference images and tracing

Choose **Reference** in the toolbar, select Front, Side or Top, then **Add image**. PNG, JPG and WebP files up to 10 MB are supported. Each view has its own image. Large uploads are resized and compressed for browser-local storage.

Set the image width in project units (height keeps the original proportions), its center along the view's two axes, and opacity. The image stays attached to world coordinates when you zoom or pan. **Fit view** includes both the image and visible geometry. You can hide, replace or remove a reference without deleting any points.

For single-click tracing, set **Trace depth** and choose **Place points on image**. Each click creates a 3D point using the clicked coordinates and the chosen hidden-axis depth (Front: Y, Side: X, Top: Z). Turn off Snap to follow image features freely. Add point and Polyline also offer a **Point placement** method in Properties; choose **Two views** to return to the original two-projection workflow. Existing point movement, connections and undo/redo work with traced points.

Images and their settings are included in Save, recovery and exported project JSON; older version-1 files without images still open. PNG and SVG exports contain the drawing geometry only, without the reference backdrop.

## Tools and navigation

| Action                | Shortcut / behavior                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Select / move         | `V` / `G`; drag a point                                                                                     |
| Add 3D point          | `P`; two distinct view clicks                                                                               |
| Connect points        | `E`; two existing points in the same object                                                                 |
| Polyline              | `L`; click existing points or create new ones with two projections; `Escape` ends the chain                 |
| Rectangle             | `R`; set the explicit hidden-axis construction depth in Properties, then click opposite corners in one view |
| Measurement           | `M`; two clicks in one view; reports **projected 2D distance**, in project units                            |
| Delete point / edge   | `D` / `K`; click the geometry                                                                               |
| Delete selected point | `Delete` / `Backspace`; connected edges are removed too                                                     |
| Pan                   | Middle-drag or Alt-drag                                                                                     |
| Zoom                  | Mouse wheel, anchored at the cursor                                                                         |
| Fit all               | `Home`                                                                                                      |
| Reset / fit a view    | View header controls                                                                                        |
| Undo / redo           | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`                                                                       |
| Save                  | `Ctrl+S`                                                                                                    |
| Help                  | `?`                                                                                                         |

View dividers are draggable; double-click restores an even split. Grid, snapping, spacing, labels and optional synchronized zoom are available in Properties. Small layouts expose Explorer and Properties drawers from the workspace heading. Keyboard shortcuts apply outside text fields.

Edges store only point IDs. Moving a point updates every connected edge in all views. Each point and edge belongs to exactly one object. The Explorer creates objects and layers; object Properties edits name, color and layer. Both objects and layers support visibility and locking. Deleting a layer moves its objects to a remaining layer. Deleting an object deletes its own geometry; undo restores it.

## Projects and exports

- **Recovery:** an automatic browser-local copy is updated after a short debounce.
- **Save project / Open saved project:** a separate explicit snapshot in the same browser. New, open, import, and example changes can be undone.
- **JSON:** portable versioned project files. Import validates version, finite coordinates, unique IDs, ownership and endpoint references before replacing the current model. The current schema is version `1`; unknown versions are rejected for future explicit migrations.
- **PNG / SVG:** select any orthographic view in Export. Every view uses a common 1200×1200 sheet transform computed from the entire project's XYZ extent, including hidden objects. This keeps the origin, scale and proportions identical across exported views, regardless of editor zoom/pan. Hidden objects/layers are omitted from the rendered geometry. PNG is raster; SVG contains editable vector geometry.
- **History:** up to 100 in-memory operations. A whole drag, rectangle, or newly created polyline segment is one operation. History and transient measurements are not serialized.

Storage is local to this browser and origin. Export JSON to transfer work, keep backups, or protect against browser data removal. No cloud account or external service is required.

## Structure and verification

- `src/app/core/models`: canonical point, edge, project, object and layer types.
- `src/app/core/geometry`: pure projections, transforms, constraints, grid snapping, export alignment and example geometry.
- `src/app/core/services`: reactive model, graph operations, history, validated persistence.
- `src/app/features/viewport`: pointer interaction and a separate high-DPI Canvas renderer.
- `src/app/shared`: reusable SVG icons.
- `src/app/app.*`: editor layout, project actions and shortcuts.

Geometry tests cover all three view pairs in both orders, negative coordinates, conflicts, zoom/pan round trips, cursor-anchored zoom, hidden-axis preservation and snapping. Integration tests cover two-view constraints, cancellation, connected edges, polyline history, rectangles, locks/layer visibility, JSON validation, save/recovery separation and aligned exports. Angular smoke tests verify that all three viewports render.

The implementation was built and tested after each phase: functional foundation, drawing tools, then project management.
