# Model pipeline

`scripts/blender/` builds every WireUp prototype model from a JSON spec, exports browser-ready
GLBs, and writes the manifest plus the physics profile file. Nothing in the pipeline invents a
dimension: each spec records the source it was derived from and how certain that source is.

## Layout

```
scripts/blender/
  specs/*.json        one file per part: dimensions, provenance, uncertainty, mass, actuator data
  pipeline.py         Blender-side helpers (geometry primitives, cache, GLB export, validation)
  builders.py         one geometry builder per spec "kind"
  assembly.py         the custom RC vehicle: chassis, running gear, steering, drivetrain, body
  build_all.py        entry point: build -> export -> manifest -> physics profiles -> .blend
  .cache/build-cache.json
```

Outputs:

| Path | Contents |
| --- | --- |
| `public/models/3d/<part-id>.glb` | one GLB per part, browser-ready |
| `public/models/3d/rc-car-assembly.glb` | the assembled vehicle with every part placed |
| `public/models/3d/manifest.json` | `models` keyed by WireUp component `type`; `custom_mechanical_parts` for parts WireUp's catalog does not have |
| `public/models/physics/profiles.json` | mass, centre of mass, inertia, colliders, actuator parameters, vehicle-level tire/aero/drivetrain data |
| `public/models/rc-car.blend` | the Blender source that produced all of the above |

## Running it

From the Blender MCP bridge:

```python
import sys; sys.path.insert(0, r'D:\hihihih\scripts\blender')
import build_all; build_all.main()
```

`build_all.main(force=True)` rebuilds every GLB. `build_all.main(save_blend=False)` skips the
.blend write.

## Caching

Each part is keyed by `sha256(spec + BUILDER_VERSION + PIPELINE_VERSION)`. If that hash and the
previous GLB are both present in `.cache/build-cache.json`, the export is skipped. The geometry is
still rebuilt, because the assembly needs live objects; only the file write is skipped. Bump
`BUILDER_VERSION` in `pipeline.py` whenever geometry code changes, otherwise the cache will
happily hand back stale GLBs.

## Validation

`pipeline.validate_objects()` runs before any export and raises if a mesh is empty, if an object's
extent or farthest vertex exceeds 1.5 m, or if an object's world position puts its geometry
anywhere near that far out. This exists because unit mistakes (millimetres passed where metres were
expected) produce geometry that looks plausible in code and absurd on screen; two of those slipped
through during the first build of this pipeline and are now caught automatically.

## Adding a part

1. Add `scripts/blender/specs/<part>.json` with `kind`, `id`, `dimensions_mm`, `geometry_source`,
   `source_url`, `mass_g`, `mass_source` and an `uncertainty` sentence.
2. Add a builder for that `kind` in `builders.py`, or register an existing one in `BUILDERS`.
3. Re-run the pipeline. It regenerates the manifest and the physics profile from the spec.

Parts with a `wireup_type` land in the manifest's `models` map and are offered to the viewer for
that WireUp component type. Parts without one (RC tires, the ESC, the battery, the chassis) land in
`custom_mechanical_parts` and are deliberately invisible to the component viewer: WireUp's catalog
has no component for them, and a mechanical part must not masquerade as an electronic one.

## Sources used for the current parts

| Part | Source |
| --- | --- |
| `nano-classic-v3` | https://docs.arduino.cc/learn/hardware/nano-pcb-guide (43.18 x 17.78 mm board, 2.54 mm header pitch) |
| `l293d-dip16` | https://www.st.com/resource/en/datasheet/l293d.pdf and the TI L293D PDIP-16 body size |
| `sg90`, `mg996r` | https://towerpro.com.tw/product/sg90-analog/ and https://towerpro.com.tw/product/mg996r/ |
| `wh148-b10k` | https://handsontec.com/dataspecs/passive/WH148%20Pot-meter.pdf |
| `nema17-42-40` | https://www.novantaims.com/downloads/datasheets/Nema17_motors.pdf |
| `quicrun-540-30t` | https://www.hobbywing.com/en/products/quicrunbrushed540555 (36 mm OD, 53.2 mm long, 168 g, 14000 rpm at 12.6 V) |
| `quicrun-wp-1060` | https://www.greathobbies.com/manuals/h/hbw/hbw30120201_manual.pdf (36.5 x 32 x 18 mm, 39 g) |
| `lipo-2s-5200-50c` | https://nitrohobbies.com/2s5200-50ec3-h/ (138 x 47 x 25 mm, 268 g) |
| `wheel-front-59mm` | 1/10 tire ranges published by Matrix (59 mm) and Racingline |
| `wheel-rear-68mm` | https://www.lightningrc.com/110-Foam-Tires-4PCS_p_2648.html (68 mm, 26 mm, 12 mm hex) |
| `rc-car-1to10-chassis` | none: custom design, dimensioned to fit the sourced parts above |

Values with no manufacturer figure (winding resistance, armature inertia, chassis mass, tire
stiffness, friction) are marked as estimates in the spec and repeated as uncertainties in
`profiles.json`. They are design targets, not measurements.
