# OpenCode ↔ WireUp ↔ Blender handoff

OpenCode coordinates two independent MCP servers. The WireUp MCP edits and reads the electronic project; the Blender MCP authors and exports geometry. WireUp's React app consumes those exported files; it is not a Blender host. Run `/build-prototype <idea>` from the OpenCode project to apply the repository workflow in `AGENTS.md`.

## Where models come from

For each exact selected component, use this order:

1. Import manufacturer-provided CAD into Blender and convert/clean it for the assembly.
2. If no manufacturer CAD is available, reconstruct the model in Blender from an official mechanical drawing or datasheet. Record the source URL and dimensions used.
3. For custom parts such as an RC chassis, author the geometry in Blender from the user's requirements and mechanical interfaces.

Do not use a generic box, a proxy mesh, or an unverified community model as if it were an exact component. If exact geometry cannot be sourced or dimensioned, leave that component model unresolved, and keep working on the rest of the prototype. Mechanical packaging envelopes may guide a custom design, but they are not component models and must not be rendered as one.

## Model asset contract

Place browser-ready GLB exports under `public/models/3d/`. `manifest.json` is keyed by the exact WireUp component `type` and supports one model or multiple named Blender variants:

```json
{
  "schema_version": 1,
  "models": {
    "arduino-uno": [
      {
        "id": "uno-r3",
        "name": "Arduino Uno R3",
        "src": "/models/3d/arduino-uno-r3.glb",
        "manufacturer": "Arduino",
        "part_number": "A000066",
        "geometry_source": "manufacturer-cad",
        "source_url": "https://docs.arduino.cc/hardware/uno-rev3/"
      }
    ],
    "servo": "/models/3d/servo.glb"
  }
}
```

Required variant fields are `id`, `name`, and `src`. Every `src` must point to a real `.glb` served from `/models/3d/`. Include `manufacturer`, `part_number` or SKU, `geometry_source` (`manufacturer-cad`, `reconstructed-from-drawing`, or `custom-design`), and `source_url` when applicable. Include the source dimensions in the associated project/physics record. The legacy single-string entry remains supported by the viewer. The viewer matches each active project component's exact `type`, displays only the selected real model, and lets the user select among published variants per component instance. Missing entries stay absent from the scene; no proxy mesh is created.

## Physics boundary

This manifest only describes renderable models. Physics inputs belong in a separate, source-traceable profile linked by variant `id`; do not infer them from appearance. Record the collider shape, mass, center of mass, inertia tensor, joints, material, and contact properties needed by the target simulation. Store each value with its units, source, derivation, and uncertainty. For RC vehicles, tires, drivetrain, steering, and actuator response need explicit profiles. The current viewer does not load or apply physics profiles.

When the tool servers return local export paths, OpenCode is responsible for putting the GLBs in the directory above and updating the manifest. Run the Blender mechanical concept and supported WireUp electronics as independent progress paths: a missing WireUp catalog entry must not block the chassis/model work, and one unresolved part model must not block the rest of the circuit or assembly. After WireUp parts are selected, return to Blender to fit their exact sourced models. Do not add a Blender connection or asset-upload workflow to the WireUp frontend.

`docs/MODEL_PIPELINE.md` documents the spec-driven Blender pipeline that produces these files, including its cache and validation rules. `public/models/physics/profiles.json` is the source-traceable physics profile it writes; parts WireUp's catalog does not have appear under `custom_mechanical_parts` in the manifest rather than pretending to be components. `docs/RC_CAR_PROTOTYPE.md` records what the current RC build has verified and what remains open.
