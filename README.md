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

## Automatic deployment with Netlify

Import the GitHub repository into Netlify and choose `main` as the production branch. The root `netlify.toml` provides the build command, publish directory, Node.js 24/npm 12.0.1 versions and the single-page application fallback. No backend or environment secrets are required.

Once the repository is linked, each push to `main` automatically builds and publishes the site. Saving a local file alone does not deploy it; commit and push the change to GitHub. Use Netlify's Deploys page to check the build result and live URL.

Projects remain local to each visitor's browser and website address. Save a project file from localhost and import it on the deployed site to continue an existing drawing.

## Coordinates and point creation

One canonical `BlueprintPoint { id, x, y, z }` represents each 3D point. Viewports derive projections; there are no separate per-view point stores.

| View   | Horizontal axis, positive right | Vertical axis, positive up | Hidden coordinate |
| ------ | ------------------------------- | -------------------------- | ----------------- |
| Front  | X, width                        | Z, height                  | Y                 |
| Back   | −X, width (positive X left)     | Z, height                  | Y                 |
| Side   | Y, length                       | Z, height                  | X                 |
| Top    | X, width                        | Y, length                  | Z                 |
| Bottom | −X, width (positive X left)     | Y, length                  | Z                 |

This is a consistent right-handed XYZ convention with Z up. The labels are modeling projections, rather than a claim of a first-angle or third-angle engineering sheet convention. The top view shows positive Y up the screen. All views use **40 CSS pixels per world unit at 100% zoom**. Each view can zoom or pan independently. Units (`m`, `cm`, `mm`) label world coordinates; changing the label does not rescale existing numeric values.

1. Activate **Add point** (`P`). Click Front at X=2, Z=3. This stores an incomplete projection, not a fabricated 3D point.
2. Move to Side. The gold guide fixes Z=3; only Y follows the cursor. A live preview appears in all three views.
3. Click at Y=5. The resulting point is exactly `(2, 5, 3)`, and Top projects it to `(2, 5)`.

Every pair of different projection planes works in either order. Front/Back share the X/Z plane; Top/Bottom share the X/Y plane. Two opposite views alone cannot determine a 3D point: combine Front/Back with Side or Top/Bottom, or combine Top/Bottom with Side. Clicking the same plane again revises that projection. `Escape` cancels. The pure `combineProjections` function independently rejects contradictory shared coordinates; the UI explicitly constrains the second click before calling it.

Select or drag a point to change its two visible axes while preserving the hidden coordinate. Enter exact X/Y/Z values in Properties; edits commit on leaving the field. Finite coordinates within ±1 billion are supported. Selection respects visibility; editing also respects object and layer locks.

### Fixed-axis layers and groups of points

**Drag objects into collections:** drag an object's name in Explorer onto a collection header or its contents. Valid destinations highlight; dropping into a collapsed collection opens it. Drag onto **Ungrouped** to remove the object from its collection. Escape or dropping outside cancels. Each move is one undo step and preserves geometry and the object's construction layer.

**Collections** organize whole objects independently of construction layers. Use **Add collection** in Explorer, name it, then right-click an object and choose **Move to collection**, or use **Properties → Active object → Collection**. Expand/collapse a collection to show its objects; its **+** adds an object directly inside it. New objects otherwise follow the active object's collection. Older projects open with their objects **Ungrouped**. Collection changes are saved in project files and recovery copies and support undo/redo.

Right-click an Explorer object for Move to collection, Change layer, Rename, visibility/locking or Delete. **New collection with this object** creates and assigns it in one undo step. Right-click a collection to add an object, rename it or **Remove collection (keep objects)**; removed collections leave their objects Ungrouped. Right-click empty Explorer space to create an object or collection. Shift+F10 opens these menus from a focused row; arrow keys navigate and Escape closes them. Grouping never moves geometry, changes a construction layer or removes connections.

In **Explorer → Layers**, choose **Keep axis → X fixed, Y fixed or Z fixed**, then enter the shared coordinate once. Enabling it starts from the selected point on that layer, or its first point (the construction depth is used for an empty layer). Existing points align to the chosen value, and new points, coordinate edits and drags keep it. Changing the layer value moves its points to the new plane; choose **Free 3D** to release the constraint. These changes support undo/redo and are saved in project files and recovery copies. Unlock affected objects before changing their coordinates.

Create a layer with **+**; it includes an empty active object ready for drawing. Click a layer's icon to draw on it, or assign an existing object's **Layer** in Properties. Reassigned points follow the destination layer's fixed coordinate. New objects use the active object's layer.

A fixed layer supplies the missing depth for one-click Add point and Polyline placement: **X fixed → Side**, **Y fixed → Front/Back**, **Z fixed → Top/Bottom**. Other views follow the selected placement method while keeping the layer coordinate. Rectangles use the layer's depth and must be drawn in one of these matching views.

- **Shift-click** or **Ctrl/Cmd-click** toggles a point in the selection. Drag over empty space to box-select; hold Shift/Ctrl/Cmd to add the box to your selection. **Ctrl/Cmd+A** selects all visible points.
- Drag any selected point to move the editable selection together, preserving spacing and hidden coordinates. A fixed axis on any editable selected layer constrains that axis for the whole group. Locked points stay in place. Coordinate fields show the last selected point and translate the group by the same amount.
- **Duplicate selected** in Properties or **Ctrl/Cmd+D** copies editable selected points in place, including edges whose two endpoints are selected. Copies keep their objects and layers and are selected immediately; drag a selected copy to move the copies together.
- **Delete/Backspace** removes editable selected points and their connected edges as one operation. Each duplication and whole group drag is also one undo step. Escape during a point drag restores the group.
- **Select all points → Delete selected** in Point transform clears all visible, unlocked geometry; the same actions use **Ctrl/Cmd+A → Delete**. Show and unlock every object and layer first to clear the entire drawing. Objects, layers and references remain available, and Undo restores the deleted geometry.
- **Move to object** in Point transform reassigns unlocked selected points to an existing visible, unlocked object. Edges between moved points follow them; connections to points left behind are removed because edges belong to one object. Moved points follow the destination layer's fixed coordinate, if any. The operation preserves point IDs, selects the moved points and supports undo/redo as one step.

**Right-click a point** for Delete, Duplicate, Move to object and Change object's layer. Right-clicking an already selected point keeps the group selected; right-clicking another point selects that point. When projections overlap, **Choose overlapping point** identifies the exact point by its number, owner and coordinates before acting. Right-click empty space for selection actions. The menu respects object/layer locks and supports undo/redo through the usual commands. **Change object's layer** moves the entire clicked point's object, including its other points and edges; a fixed destination layer aligns those points. You can also select the object's name in Explorer and use **Properties → Active object → Layer**.

With a canvas focused, **Shift+F10** or the context-menu key opens the same menu. Use Up/Down, Home/End and Enter to navigate, Left to return from a submenu, or Escape to close. Clicking outside, zooming, switching views/tools or changing the model dismisses the menu.

## Reference images and tracing

Choose **Reference** in the toolbar, select Front, Back, Side, Top or Bottom, then **Add image**. PNG, JPG and WebP files up to 10 MB are supported. Each view has its own image. Large uploads are resized and compressed for browser-local storage.

Front and Back share the upper-left viewport. Use **⇄ Back** in the Front header and **⇄ Front** to return, or choose the corresponding view in Reference settings. Each face keeps its own image, width, rotation, position, opacity and visibility, as well as its camera while working. Both images are saved in project JSON and browser storage. Geometry remains one 3D model: Back mirrors X horizontally, as expected when viewing it from behind. Switching faces cancels unfinished drawing operations.

Top and Bottom share the lower viewport in the same way: use **⇄ Bottom** or **⇄ Top** in its header. Each side has an independent reference and adjustments, with both saved in the project. Bottom views the model from underneath, keeping positive Y up and reversing X horizontally. Both sides support tracing, moving, resizing, rotation, point editing and exports.

Set the image width in project units (height keeps the original proportions), its center along the view's two axes, and opacity. **Rotation** accepts an angle from −360° to 360° around the image center; positive angles turn clockwise. Use **−90°**, **+90°** or **Reset** for quick alignment. Rotation supports undo/redo and is saved with the image. The image stays attached to world coordinates when you zoom or pan. **Fit view** includes the entire rotated image and visible geometry. You can hide, replace or remove a reference without deleting any points.

Choose **Move / resize image** (`I`) in the toolbar or Reference panel, or use the image button in a view header. Drag inside the image to reposition it, or drag one of its four corner handles to resize it. Resizing keeps the opposite corner fixed, preserves proportions and works with rotated images. Grid snapping does not restrict image adjustments. With the canvas focused, arrow keys nudge by one screen pixel; hold Shift for ten pixels. A drag is one undo step, and Escape during a drag restores its starting size and position. Exact width and image-center fields remain available. Choose **Select** (`V`) to finish. Middle-drag or Alt-drag still pans the view. Image adjustments are saved with the project and leave points and edges in place.

For single-click tracing, set **Trace depth** and choose **Place points on image**. Each click creates a 3D point using the clicked coordinates and the chosen hidden-axis depth (Front/Back: Y, Side: X, Top/Bottom: Z). Turn off Snap to follow image features freely. Add point and Polyline also offer a **Point placement** method in Properties; choose **Two views** to return to the original two-projection workflow. Existing point movement, connections and undo/redo work with traced points.

Images and their settings are included in Save, recovery and exported project JSON; older version-1 files without images still open. PNG and SVG exports contain the drawing geometry only, without the reference backdrop.

## Tools and navigation

| Action              | Shortcut / behavior                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Select / move       | `V` / `G`; drag a point                                                                                     |
| Add 3D point        | `P`; two distinct view clicks                                                                               |
| Connect points      | `E`; two existing points in the same object                                                                 |
| Polyline            | `L`; click existing points or create new ones with two projections; `Escape` ends the chain                 |
| Rectangle           | `R`; set the explicit hidden-axis construction depth in Properties, then click opposite corners in one view |
| Measurement         | `M`; two clicks in one view; reports **projected 2D distance**, in project units                            |
| Delete point / edge | `D` / `K`; click the geometry                                                                               |
| Duplicate selection | `Ctrl+D` / `Cmd+D`; copies points and edges between selected endpoints                                      |
| Select all points   | `Ctrl+A` / `Cmd+A`; selects visible points                                                                  |
| Delete selection    | `Delete` / `Backspace`; editable selected points and their connected edges                                  |
| Pan                 | Middle-drag or Alt-drag                                                                                     |
| Zoom                | Mouse wheel, anchored at the cursor                                                                         |
| Fit all             | `Home`                                                                                                      |
| Reset / fit a view  | View header controls                                                                                        |
| Undo / redo         | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`                                                                       |
| Save                | `Ctrl+S`                                                                                                    |
| Help                | `?`                                                                                                         |

View dividers are draggable; double-click restores an even split. Grid, snapping, spacing, labels and optional synchronized zoom are available in Properties. Small layouts expose Explorer and Properties drawers from the workspace heading. Keyboard shortcuts apply outside text fields.

Edges store only point IDs. Moving a point updates every connected edge in all views. Each point and edge belongs to exactly one object. The Explorer creates objects and layers; object Properties edits name, color and layer. Both objects and layers support visibility and locking. Deleting a layer moves its objects to a remaining layer. Deleting an object deletes its own geometry; undo restores it.

When **Connect points** or **Polyline** finds several nodes under a click, a picker opens beside the cursor. Choose the exact node by its point number, object and XYZ coordinates. Hover or focus a choice to highlight it across all views; arrow keys move between choices and Enter selects. Locked nodes, the starting node and nodes in another object are marked unavailable. Escape or clicking outside closes the picker while preserving the unfinished line. A single nearby node connects immediately.

## Projects and exports

- **Recovery:** an automatic browser-local copy is updated after a short debounce.
- **Save project** (`Ctrl+S`): downloads a portable `<project>.blueprint.json` file containing the drawing, all reference images and their adjustments. Files go to your browser's configured download location (usually Downloads), or the location chosen in its save dialog. A browser copy is also kept when storage is available. The app does not write into the source repository.
- **Project → Import project file:** reopens a downloaded `.blueprint.json` file. Import validates version, finite coordinates, unique IDs, ownership, endpoint references and embedded images before replacing the model. The current schema is version `1`; older supported project files remain compatible. Invalid files leave the current drawing intact. **Open browser copy** opens the last explicitly cached snapshot. New, open, import and example changes can be undone.
- **PNG:** tick any views in Export, including Back and Bottom. **Select all** checks every view; **Visible views** checks the three currently displayed faces. One selected view downloads as a PNG; multiple selected views download as one ZIP containing a separate named PNG for each view. Each PNG is 1200×1200. The archive needs no additional runtime dependency.
- **SVG:** choose one orthographic view in Export for editable vector geometry. All PNG and SVG views use a common scale and world origin computed from the full XYZ and mirrored X extent, including hidden objects, regardless of editor zoom/pan. Hidden geometry is omitted. Exported images contain the drawing geometry; reference backgrounds remain in the editable project file.
- **History:** up to 100 in-memory operations. A whole drag, rectangle, or newly created polyline segment is one operation. History and transient measurements are not serialized.

Recovery and cached copies are local to this browser and origin. Downloaded project files can be kept with your other project files, backed up or transferred and imported on another computer. No cloud account or external service is required.

## Structure and verification

- `src/app/core/models`: canonical point, edge, project, object and layer types.
- `src/app/core/geometry`: pure projections, transforms, constraints, grid snapping, export alignment and example geometry.
- `src/app/core/services`: reactive model, graph operations, history, validated persistence.
- `src/app/features/viewport`: pointer interaction and a separate high-DPI Canvas renderer.
- `src/app/shared`: reusable SVG icons.
- `src/app/app.*`: editor layout, project actions and shortcuts.

Geometry tests cover all three view pairs in both orders, negative coordinates, conflicts, zoom/pan round trips, cursor-anchored zoom, hidden-axis preservation and snapping. Integration tests cover two-view constraints, cancellation, connected edges, polyline history, rectangles, locks/layer visibility, JSON validation, save/recovery separation and aligned exports. Angular smoke tests verify that all three viewports render.

The implementation was built and tested after each phase: functional foundation, drawing tools, then project management.
