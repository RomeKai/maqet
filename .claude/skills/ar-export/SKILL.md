---
name: ar-export
description: Exporting the Scene to an AR maquette that works on iPhone and Android with model-viewer (GLB, USDZ, Quick Look, Scene Viewer), plus performance limits for phones. Use when working on web/src/ar or the 3D asset pipeline.
---

# Pipeline
1. Build the three.js scene from the Scene (same code as the 3D view, a `quality: "ar"` flag).
2. Export it client-side: `GLTFExporter` → GLB (binary, embedded textures). On iOS, model-viewer generates the USDZ
   (`ar-modes="webxr scene-viewer quick-look"`, plus `ios-src` when a pre-baked USDZ exists).
3. `<model-viewer src=blob ar ar-scale="auto" camera-controls shadow-intensity="1">`. The maquette is scaled down by
   default ("dollhouse"). A toggle sets 1:1 (P2).
4. Cut the ceiling (and optionally the walls at 1.2 m) so the maquette reads from above: a **maquette of the home with the
   proposed expansion**, for the family to walk around on its own table. Only the basic furniture set is included (to show
   rooms are usable); the new construction can be tinted to tell it from the existing home. Label it "Preliminary".

# Phone budgets (or Quick Look / Scene Viewer will choke)
- ≤ 100k triangles, ≤ 15 MB GLB, textures ≤ 1024 px (512 for tiling materials), ≤ 20 draw calls where possible
  (merge static walls per material).
- Basic furniture GLBs from the catalog are pre-decimated (`assets/furniture/*.glb` budget: ≤ 5k tris each).
- Bake simple AO into floor textures if time allows. Otherwise rely on model-viewer's shadow.

# Verify (both devices, every change to this pipeline)
- iPhone Safari: the AR button opens Quick Look, the model is upright and scaled, textures are visible.
- Android Chrome: the AR button opens Scene Viewer, same checks.
- Automated: vitest asserts the GLB is under budget (triangles, bytes) for the sample scenes built from the demo inputs.
