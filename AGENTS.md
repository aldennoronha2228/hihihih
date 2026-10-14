# OpenCode prototype workflow

OpenCode coordinates the WireUp MCP and Blender MCP. They are separate tools: WireUp owns the electronic design and project; Blender owns real geometry. The WireUp frontend displays Blender exports but does not create or edit Blender scenes.

## General rules

- Treat the user's idea as a product to design, not as a request to scaffold a generic demo.
- Do not make placeholder boxes, generic meshes, or guessed component models look like real parts. Every displayed component model must correspond to an identified real part or be clearly marked as a custom concept model.
- Do not let a missing catalog item, one missing model, or an unsupported subsystem kill progress on the whole prototype. Continue independent work, record the exact gap, and keep the project open for that subsystem to be filled in later.
- Never claim a simulation is physically meaningful when required firmware, geometry, contact data, or physical properties are missing. Label what is implemented, assumed, sourced, and still unresolved.
- Discover MCP tools and read their descriptions in the active OpenCode session. If an MCP is disconnected, continue with independent work that is possible, report the unavailable step, and do not fabricate its result.
- Use the current project if the user identified one. Otherwise, create a project only when the user's request clearly asks to build/design the idea. Never silently mutate a different project.

## Idea to a working physical prototype

For each idea, keep mechanical design, electronics, and simulation as linked workstreams. The RC-car pathway is explicitly supported; it is not a drone-only workflow.

1. **Translate the idea into a design brief.** List intended behavior, scale/use, constraints, moving parts, control inputs, power needs, and what the simulation must demonstrate. Ask only for missing choices that materially change the design; otherwise proceed with clearly labeled defaults.
2. **Do a WireUp catalog feasibility read.** Use WireUp MCP to inspect its health and search for candidate real electronic parts and exact catalog types/SKUs. This is a shortlist, not a requirement that every subsystem already exist in the catalog. Record unsupported items without stopping mechanical work.
3. **Start the Blender mechanical concept early.** Use Blender MCP to make the actual custom geometry for the product (for an RC car: chassis, wheels/tires, axles, steering linkage, drivetrain mounts, body, and mounting features). Do not wait for a perfect electronics catalog. Mechanical interfaces can start from labeled packaging envelopes, but envelopes are constraints only and must not be rendered or represented as fake components.
4. **Create the electronic design in WireUp.** Select compatible, actual catalog parts where available; create the circuit, pin connections, and firmware. Tie each selected component instance to its exact catalog type, manufacturer part number/SKU when known, and expected mechanical mounting interface. If a needed receiver, ESC, motor, or other part is absent, finish the supported electronics and leave that item as an explicit external/unmodeled integration point. Do not substitute a visually similar part or invent a catalog ID.
5. **Fit real models for the selected parts in Blender.** For each exact selected component, prefer the manufacturer's downloadable CAD. Otherwise reconstruct its shape from an official mechanical drawing/datasheet and record that provenance and dimensions. Fit those models to the Blender assembly. If neither CAD nor dimensional evidence is available, mark that exact model unresolved and continue modeling/simulation for the rest of the vehicle; never insert a fake box as if it were the part.
6. **Prepare simulation inputs from evidence.** Keep render meshes separate from simplified collision geometry. Derive dimensions, mass, center of mass, inertia, joints, and tire/contact properties from actual geometry, known materials, datasheets, or identified sources. Record uncertainty and source per value. Unknown properties remain unknown; do not infer them from appearance.
7. **Connect control to motion.** Feed real WireUp firmware outputs and simulated time into the supported actuator models (for an RC car, steering servo and ESC/motor). The physical vehicle must move through motor torque, drivetrain, tire forces, and contacts, not a scripted "drive" shortcut. If the current simulator lacks one subsystem, keep the rest usable and report exactly which behavior is not yet simulated.
8. **Publish and present.** Export browser-ready `.glb` files from Blender to `public/models/3d/` and update `manifest.json` per `docs/OPENCODE-WIREUP-BLENDER.md`. Key entries by exact WireUp component type and record SKU/source metadata. WireUp renders only those published files, lets users mix real model variants per component instance, and visibly identifies missing exports. Re-read both the WireUp project and manifest before reporting what works.

## RC car reference decomposition

Treat an RC car as a concrete supported product path, not as a special case to reject. Its mechanical model includes chassis, wheel/tire geometry, axle or drivetrain, steering geometry, and body. Its electronic/control path typically includes a controller or receiver, ESC, drive motor, steering servo, battery, and optional sensors. Confirm actual WireUp catalog support and compatibility for exact selections. Keep unsupported radio protocols or parts as explicit integration gaps while continuing the rest of the build. Do not claim vehicle dynamics until tire contact, drivetrain, actuator behavior, and control timing are connected.

## Model manifest

See `docs/OPENCODE-WIREUP-BLENDER.md` for the GLB manifest schema and source metadata contract. Never put Blender authoring tools, Blender MCP configuration, asset-upload controls, or proxy meshes in the WireUp frontend.

Do not commit or push unless the user asks.
