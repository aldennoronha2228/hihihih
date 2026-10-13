"""Build every WireUp prototype model from the specs, export GLBs, write manifest + physics.

Intended invocation from the Blender MCP bridge::

    exec(open(r'D:\\hihihih\\scripts\\blender\\build_all.py', encoding='utf-8').read())

or, from a Blender Python console::

    import sys; sys.path.insert(0, r'D:\\hihihih\\scripts\\blender')
    import build_all; build_all.main()
"""

from __future__ import annotations

import json
import math
import os
import time

import bpy

import pipeline
from assembly import Vehicle, place_parts
from builders import BUILDERS, mm
from pipeline import (GLB_DIR, MANIFEST_PATH, PHYSICS_DIR, PROFILE_PATH, clear_scene,
                      export_glb, load_cache, load_specs, log, save_cache, spec_hash,
                      validate_objects)

ASSEMBLY_GLB = "rc-car-assembly"


def build_part(spec, force=False, cache=None):
    filename = f"{spec['id']}.glb"
    filepath = os.path.join(GLB_DIR, filename)
    digest = spec_hash(spec)
    cached = (cache or {}).get(spec["id"])
    fresh = (not force and cached and cached.get("spec_hash") == digest
             and os.path.exists(filepath))

    for coll in list(bpy.data.collections):
        if coll.name.startswith(f"part_{spec['id']}"):
            bpy.data.collections.remove(coll)
    builder = BUILDERS.get(spec["kind"])
    if builder is None:
        raise ValueError(f"no builder for kind {spec['kind']} ({spec['id']})")
    objects = builder(spec)

    if fresh:
        log(f"cache hit {spec['id']} -> {filename} (geometry rebuilt for assembly only)")
        return cached, objects

    entry = {
        "spec_hash": digest,
        "file": filename,
        "bytes": export_glb(objects, filepath),
        "objects": len(objects),
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "blender": bpy.app.version_string,
    }
    log(f"built {spec['id']}: {len(objects)} objects -> {filename} ({entry['bytes']} bytes)")
    return entry, objects


def variant_for(spec):
    variant = {
        "id": spec["id"],
        "name": spec["name"],
        "src": f"/models/3d/{spec['id']}.glb",
        "geometry_source": spec["geometry_source"],
    }
    if spec.get("manufacturer"):
        variant["manufacturer"] = spec["manufacturer"]
    if spec.get("part_number"):
        variant["part_number"] = spec["part_number"]
    if spec.get("source_url"):
        variant["source_url"] = spec["source_url"]
    if spec.get("uncertainty"):
        variant["dimensions_uncertainty"] = spec["uncertainty"]
    if spec.get("dimensions_mm"):
        variant["dimensions_mm"] = spec["dimensions_mm"]
    return variant


def physics_for(spec):
    dims = spec.get("dimensions_mm", {})
    profile = {
        "id": spec["id"],
        "name": spec["name"],
        "wireup_type": spec.get("wireup_type"),
        "catalog_status": spec.get("catalog_status", "in-catalog"),
        "geometry_source": spec["geometry_source"],
    }
    if spec.get("mass_g") is not None:
        profile["mass_kg"] = round(spec["mass_g"] / 1000.0, 6)
    profile["mass_source"] = spec.get("mass_source", "unknown")
    profile["mass_uncertainty"] = spec.get("mass_uncertainty")
    profile["material"] = spec.get("material")
    profile["collider"] = collider_for(spec, dims)
    features = spec.get("features", {})
    actuator = {}
    for key in ("stall_torque_kgcm", "stall_torque_voltage", "speed_sec_per_60deg",
                "dead_band_us", "min_pulse_us", "max_pulse_us", "neutral_us",
                "turns", "kv_rpm_per_volt", "no_load_rpm_at_12v6", "armature_inertia_kg_m2",
                "winding_resistance_ohm", "nominal_voltage", "bec_voltage", "bec_current_a",
                "fwd_continuous_a", "fwd_peak_a", "rev_continuous_a", "rev_peak_a",
                "step_angle_deg", "rated_current_per_phase_a", "holding_torque_kgcm",
                "resistance_ohm", "total_rotation_deg", "cells", "capacity_mah"):
        if key in features:
            actuator[key] = features[key]
    if actuator:
        profile["actuator"] = actuator
    return profile


def collider_for(spec, dims):
    kind = spec["kind"]
    if kind == "pcb_board":
        return {"type": "cuboid", "size_m": [dims["length"] / 1000, dims["width"] / 1000,
                                             dims["thickness"] / 1000]}
    if kind == "dip_ic":
        return {"type": "cuboid", "size_m": [dims["body_length"] / 1000, dims["body_width"] / 1000,
                                             (dims["body_height"] + dims["pin_length"]) / 1000]}
    if kind == "hobby_servo":
        return {"type": "cuboid", "size_m": [dims["body_length"] / 1000, dims["flange_width"] / 1000,
                                             dims["total_height_with_horn"] / 1000]}
    if kind == "panel_potentiometer":
        return {"type": "cylinder", "radius_m": dims["body_diameter"] / 2000.0,
                "height_m": dims["body_height"] / 1000.0}
    if kind == "stepper_motor":
        return {"type": "cuboid", "size_m": [dims["frame"] / 1000, dims["frame"] / 1000,
                                             (dims["body_length"] + 2 * dims["cap_length"]) / 1000]}
    if kind == "rc_brushed_motor":
        return {"type": "cylinder", "radius_m": dims["can_diameter"] / 2000.0,
                "height_m": dims["can_length"] / 1000.0, "axis": "Y"}
    if kind == "rc_esc":
        return {"type": "cuboid", "size_m": [dims["length"] / 1000, dims["width"] / 1000,
                                             dims["height"] / 1000]}
    if kind == "rc_battery":
        return {"type": "cuboid", "size_m": [dims["length"] / 1000, dims["width"] / 1000,
                                             dims["height"] / 1000]}
    if kind == "rc_tire":
        return {"type": "cylinder", "radius_m": dims["outer_diameter"] / 2000.0,
                "height_m": dims["width"] / 1000.0, "axis": "Y"}
    if kind == "rc_chassis_assembly":
        return {"type": "compound", "members": ["cuboid_lower_plate", "cuboid_upper_deck",
                                                "cylinder_tire_x4", "compound_vehicle_body"]}
    return {"type": "unknown"}


def vehicle_physics(spec):
    dims = spec["dimensions_mm"]
    features = spec["features"]
    wheelbase = dims["wheelbase"] / 1000.0
    track_front = dims["track_front"] / 1000.0
    track_rear = dims["track_rear"] / 1000.0
    front_radius = 29.5 / 1000.0
    rear_radius = 34.0 / 1000.0
    mass = (features["battery_g"] + features["motor_g"] + features["esc_g"]
            + features["steering_servo_g"] + features["electronics_g"] + features["body_g"]
            + features["chassis_g"] + features["axles_g"] + features["wheels_g"]) / 1000.0
    half_wheelbase = wheelbase / 2.0
    inertia_x = mass * (rear_radius ** 2) * 0.5 + mass * ((front_radius + rear_radius) / 2.0) ** 2 * 0.12
    inertia_z = mass * ((half_wheelbase ** 2) * 0.55 + (track_rear / 2.0) ** 2 * 0.5)
    inertia_y = inertia_x * 1.15
    return {
        "id": spec["id"],
        "name": spec["name"],
        "catalog_status": spec.get("catalog_status"),
        "geometry_source": spec["geometry_source"],
        "design_basis": spec.get("design_basis"),
        "uncertainty": spec.get("uncertainty"),
        "physics_uncertainty": spec.get("physics_uncertainty"),
        "mass_kg": round(mass, 4),
        "mass_breakdown_kg": {key: round(features[f"{key}_g"] / 1000.0, 4)
                              for key in ("battery", "motor", "esc", "steering_servo",
                                          "electronics", "body", "chassis", "axles", "wheels")},
        "mass_source": spec["mass_source"],
        "center_of_mass_m": [features["com_x_mm"] / 1000.0,
                             0.0,
                             features["com_from_ground_mm"] / 1000.0],
        "inertia_kg_m2": {"ixx": round(inertia_x, 6), "iyy": round(inertia_y, 6),
                          "izz": round(inertia_z, 6)},
        "inertia_source": ("Derived from the mass breakdown above combined as point masses at "
                           "the front and rear axle heights: Ixx uses the mean wheel radius, "
                           "Izz uses the wheelbase and rear track. No measured inertia exists."),
        "geometry": {
            "wheelbase_m": wheelbase,
            "track_front_m": track_front,
            "track_rear_m": track_rear,
            "front_wheel_radius_m": front_radius,
            "rear_wheel_radius_m": rear_radius,
            "axle_height_m": front_radius,
            "center_diff_to_rear_axle_m": 0.06,
            "ride_height_m": dims["ride_height"] / 1000.0,
            "max_steer_rad": math.radians(features["max_steer_deg"]),
            "camber_front_rad": math.radians(dims["camber_deg"]),
            "ackermann_rad": math.radians(dims["ackermann_deg"]),
        },
        "tire": {
            "model": "simplified_linear_with_saturation",
            "mu": features["tire_mu"],
            "vertical_stiffness_n_per_m": features["tire_vertical_stiffness_n_per_m"],
            "damping_ns_per_m": features["tire_damping_ns_per_m"],
            "rolling_resistance_coefficient": features["rolling_resistance_coefficient"],
            "source": "Design target for a rubber tire on smooth asphalt; no measured tire data.",
        },
        "aero": {
            "drag_coefficient": features["drag_coefficient"],
            "frontal_area_m2": features["frontal_area_m2"],
            "downforce_coefficient": features["downforce_coefficient"],
            "source": "Estimated from the body envelope in specs/rc-chassis-assembly.json.",
        },
        "drivetrain": {
            "motor": "hobbywing-quicrun-540-30t",
            "esc": "hobbywing-quicrun-wp-1060",
            "gear_ratio": features["gear_ratio"],
            "final_drive_efficiency": features["final_drive_efficiency"],
            "diff_efficiency": features["diff_efficiency"],
            "max_motor_rpm": features["max_motor_rpm"],
            "pinion_teeth": dims["pinion_teeth"],
            "spur_teeth": dims["spur_teeth"],
            "source": "Gear ratio 50/12 = 4.1667 from the chosen pinion/spur tooth counts; "
                      "efficiency 0.85 is a design target for a nylon spur gear.",
        },
        "steering": {
            "servo": "towerpro-mg996r",
            "servo_pulse_to_angle": {"min_us": 500, "center_us": 1500, "max_us": 2400,
                                     "min_deg": 65 - 90, "max_deg": 115 - 90},
            "steering_ratio_note": "The firmware maps the steering pot to 65-115 deg; the "
                                   "physical steering ratio (servo angle to road-wheel angle) "
                                   "follows from the tie-rod geometry in the assembly spec.",
        },
        "integration_gaps": [
            "WireUp's catalog has no brushed DC motor or ESC part, so this profile is not yet "
            "driven by any simulated component.",
            "WireUp's catalog has no radio receiver; the current firmware reads two "
            "potentiometers directly instead of a PWM receiver frame.",
            "The current firmware steps the L293D as a stepper, so no 0-100% throttle PWM "
            "reaches the motor and the ESC cannot be simulated from firmware output yet.",
        ],
    }


def write_manifest(specs, entries):
    manifest = {"schema_version": 1, "models": {}, "custom_mechanical_parts": {}}
    for spec in sorted(specs.values(), key=lambda item: item["id"]):
        variant = variant_for(spec)
        target = "models" if spec.get("wireup_type") else "custom_mechanical_parts"
        key = spec.get("wireup_type") or spec["id"]
        manifest[target].setdefault(key, []).append(variant)
    with open(MANIFEST_PATH, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
    log(f"manifest written with {len(manifest['models'])} catalog types")


def write_profiles(specs):
    os.makedirs(PHYSICS_DIR, exist_ok=True)
    profiles = {"schema_version": 1, "note": "Values carry units, source and uncertainty. "
                                              "Nothing here is inferred from mesh appearance.",
                "components": {}, "vehicles": {}}
    for spec in specs.values():
        if spec["kind"] == "rc_chassis_assembly":
            profiles["vehicles"][spec["id"]] = vehicle_physics(spec)
        else:
            profiles["components"][spec["id"]] = physics_for(spec)
    with open(PROFILE_PATH, "w", encoding="utf-8") as handle:
        json.dump(profiles, handle, indent=2)
        handle.write("\n")
    log(f"physics profiles written: {len(profiles['components'])} components, "
        f"{len(profiles['vehicles'])} vehicles")


def build_assembly(spec, objects_by_id):
    vehicle = Vehicle(spec)
    vehicle.build()

    place_parts("wheel-front-59mm", objects_by_id,
                (mm(vehicle.front_x), mm(vehicle.front_track), mm(vehicle.front_radius)),
                rotation_deg=(90.0, 0.0, 0.0))
    place_parts("wheel-front-59mm", objects_by_id,
                (mm(vehicle.front_x), mm(-vehicle.front_track), mm(vehicle.front_radius)),
                rotation_deg=(-90.0, 0.0, 0.0))
    place_parts("wheel-rear-68mm", objects_by_id,
                (mm(vehicle.rear_x), mm(vehicle.rear_track), mm(vehicle.rear_radius)),
                rotation_deg=(90.0, 0.0, 0.0))
    place_parts("wheel-rear-68mm", objects_by_id,
                (mm(vehicle.rear_x), mm(-vehicle.rear_track), mm(vehicle.rear_radius)),
                rotation_deg=(-90.0, 0.0, 0.0))

    mount = spec["dimensions_mm"]["servo_mount_position"]
    place_parts("mg996r", objects_by_id,
                (mm(mount[0]), 0.0, mm(vehicle.upper_z + vehicle.upper_thickness)),
                rotation_deg=(0.0, 0.0, 90.0))

    motor_mount = spec["dimensions_mm"]["motor_mount_position"]
    place_parts("quicrun-540-30t", objects_by_id,
                (mm(motor_mount[0]), mm(spec["dimensions_mm"]["motor_offset_from_centerline"]),
                 mm(vehicle.lower_z + vehicle.lower_thickness + 18.0)),
                rotation_deg=(90.0, 0.0, 0.0))

    tray = spec["dimensions_mm"]["battery_tray_position"]
    place_parts("lipo-2s-5200-50c", objects_by_id,
                (mm(tray[0]), mm(tray[1]), mm(vehicle.lower_z + vehicle.lower_thickness + 14.0)))

    deck = spec["dimensions_mm"]["electronics_deck_position"]
    place_parts("quicrun-wp-1060", objects_by_id,
                (mm(deck[0]), mm(-40.0), mm(vehicle.lower_z + vehicle.lower_thickness + 3.0)),
                rotation_deg=(0.0, 0.0, 90.0))
    place_parts("nano-classic-v3", objects_by_id,
                (mm(deck[0]), mm(38.0), mm(vehicle.lower_z + vehicle.lower_thickness + 3.0)),
                rotation_deg=(0.0, 0.0, 0.0))
    place_parts("l293d-dip16", objects_by_id,
                (mm(deck[0] - 40.0), mm(-20.0), mm(vehicle.lower_z + vehicle.lower_thickness + 3.0)))

    parts = vehicle.objects
    for objects in objects_by_id.values():
        parts.extend(objects)
    filepath = os.path.join(GLB_DIR, f"{ASSEMBLY_GLB}.glb")
    size = export_glb(parts, filepath)
    log(f"assembled RC car: {len(parts)} objects -> {ASSEMBLY_GLB}.glb ({size} bytes)")
    return size


def main(force=False, save_blend=True):
    clear_scene()
    specs = load_specs()
    cache = load_cache()
    objects_by_id = {}
    for spec in specs.values():
        if spec["kind"] == "rc_chassis_assembly":
            continue
        entry, objects = build_part(spec, force=force, cache=cache)
        cache[spec["id"]] = entry
        objects_by_id[spec["id"]] = objects
    save_cache(cache)

    chassis = next(spec for spec in specs.values() if spec["kind"] == "rc_chassis_assembly")
    problems = validate_objects([obj for objects in objects_by_id.values() for obj in objects]
                                + [obj for obj in bpy.data.objects
                                   if obj.name.startswith("rc_")])
    if problems:
        raise ValueError("geometry validation failed:\n  " + "\n  ".join(problems))
    assembly_bytes = build_assembly(chassis, objects_by_id)

    write_manifest(specs, cache)
    write_profiles(specs)

    if save_blend:
        blend_path = os.path.join(REPO_BLEND_PATH)
        os.makedirs(os.path.dirname(blend_path), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=blend_path)
        log(f"blend saved to {blend_path}")

    summary = {
        "parts": len(specs),
        "catalog_types": sorted(spec.get("wireup_type") for spec in specs.values()
                                if spec.get("wireup_type")),
        "assembly_glb_bytes": assembly_bytes,
        "manifest": MANIFEST_PATH,
        "profiles": PROFILE_PATH,
    }
    print("[pipeline] summary:", json.dumps(summary))
    return summary


REPO_BLEND_PATH = os.path.join(pipeline.REPO_ROOT, "public", "models", "rc-car.blend")

if __name__ == "__main__":
    main()
