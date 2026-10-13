"""Spec-driven Blender model pipeline for WireUp prototype assets.

Run inside Blender. Builds every part spec under ``specs/`` into geometry,
exports one GLB per part to the repository ``public/models/3d/`` directory and
writes the manifest plus the physics profile file. Rebuilds are skipped when a
part's spec hash, the builder version and the pipeline version are all unchanged
and the previous GLB still exists.
"""

from __future__ import annotations

import hashlib
import json
import os
import time

import bmesh
import bpy
from mathutils import Matrix, Vector

PIPELINE_VERSION = "1.0.0"
BUILDER_VERSION = "1.0.3"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
SPEC_DIR = os.path.join(SCRIPT_DIR, "specs")
GLB_DIR = os.path.join(REPO_ROOT, "public", "models", "3d")
PHYSICS_DIR = os.path.join(REPO_ROOT, "public", "models", "physics")
MANIFEST_PATH = os.path.join(GLB_DIR, "manifest.json")
PROFILE_PATH = os.path.join(PHYSICS_DIR, "profiles.json")
CACHE_PATH = os.path.join(SCRIPT_DIR, ".cache", "build-cache.json")

MATERIALS = {
    "pcb": ((0.016, 0.118, 0.055, 1.0), 0.55, 0.0),
    "gold": ((0.784, 0.627, 0.176, 1.0), 0.30, 1.0),
    "silver": ((0.72, 0.72, 0.74, 1.0), 0.32, 1.0),
    "steel_dark": ((0.24, 0.24, 0.26, 1.0), 0.42, 0.9),
    "epoxy_black": ((0.035, 0.035, 0.04, 1.0), 0.48, 0.0),
    "epoxy_dark": ((0.10, 0.10, 0.12, 1.0), 0.55, 0.0),
    "abs_grey": ((0.28, 0.28, 0.30, 1.0), 0.52, 0.0),
    "abs_blue": ((0.06, 0.16, 0.45, 1.0), 0.45, 0.0),
    "alu": ((0.62, 0.63, 0.65, 1.0), 0.28, 1.0),
    "rubber": ((0.022, 0.022, 0.024, 1.0), 0.85, 0.0),
    "copper": ((0.72, 0.36, 0.12, 1.0), 0.35, 1.0),
    "red": ((0.55, 0.04, 0.04, 1.0), 0.40, 0.0),
    "body_shell": ((0.72, 0.09, 0.06, 1.0), 0.35, 0.0),
    "glass": ((0.05, 0.06, 0.07, 1.0), 0.15, 0.0),
    "pack_blue": ((0.05, 0.09, 0.22, 1.0), 0.50, 0.0),
}


def log(message: str) -> None:
    print(f"[pipeline] {message}")


def material(name: str):
    key = MATERIALS.get(name, MATERIALS["abs_grey"])
    mat = bpy.data.materials.get(f"wireup_{name}")
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(f"wireup_{name}")
    mat.use_nodes = True
    bsdf = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = key[0]
    bsdf.inputs["Roughness"].default_value = key[1]
    bsdf.inputs["Metallic"].default_value = key[2]
    return mat


def _cone(bm, radius_bottom, radius_top, depth, matrix, segments=32, cap=True):
    try:
        return bmesh.ops.create_cone(
            bm, cap_ends=cap, cap_tris=False, segments=segments,
            radius1=radius_bottom, radius2=radius_top, depth=depth, matrix=matrix)
    except TypeError:
        return bmesh.ops.create_cone(
            bm, cap_ends=cap, cap_tris=False, segments=segments,
            diameter1=radius_bottom, diameter2=radius_top, depth=depth, matrix=matrix)


def _box(bm, center, size, matrix=None):
    m = Matrix.Translation(Vector(center))
    if matrix is not None:
        m = m @ matrix
    m = m @ Matrix.Diagonal(Vector((size[0], size[1], size[2], 1.0)))
    return bmesh.ops.create_cube(bm, size=1.0, matrix=m)


_AXIS_ROT = {
    "X": Matrix.Rotation(1.57079632679, 4, "Y"),
    "Y": Matrix.Rotation(1.57079632679, 4, "X"),
    "Z": Matrix.Identity(4),
}


def _axis_matrix(center, axis, extra=None):
    m = Matrix.Translation(Vector(center)) @ _AXIS_ROT[axis]
    return m if extra is None else m @ extra


def bm_box(bm, center, size):
    return _box(bm, center, size)


def bm_cylinder(bm, radius, depth, center=(0, 0, 0), axis="Z", segments=32):
    return _cone(bm, radius, radius, depth, _axis_matrix(center, axis), segments)


def bm_cone(bm, radius_bottom, radius_top, depth, center=(0, 0, 0), axis="Z", segments=32):
    return _cone(bm, radius_bottom, radius_top, depth, _axis_matrix(center, axis), segments)


def bm_revolve(bm, profile, center=(0, 0, 0), axis="Z", segments=48, angle=6.28318530718):
    """Revolve a closed 2D cross-section of (radius, height) pairs around an axis."""
    import math as _math
    count = len(profile)
    offset = Vector(center)
    grid = []
    for step in range(segments):
        theta = angle * step / segments
        cos_t, sin_t = _math.cos(theta), _math.sin(theta)
        ring = []
        for radius, height in profile:
            if axis == "Y":
                point = Vector((radius * cos_t, height, radius * sin_t))
            elif axis == "X":
                point = Vector((height, radius * cos_t, radius * sin_t))
            else:
                point = Vector((radius * cos_t, radius * sin_t, height))
            ring.append(bm.verts.new(offset + point))
        grid.append(ring)
    for step in range(segments):
        nxt = (step + 1) % segments
        for index in range(count):
            other = (index + 1) % count
            try:
                bm.faces.new((grid[step][index], grid[step][other],
                              grid[nxt][other], grid[nxt][index]))
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def new_object(name, bm, collection, mat_name=None):
    mesh = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_flat()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    if mat_name:
        obj.data.materials.append(material(mat_name))
    return obj


def boolean_difference(obj, cutter_bm):
    cutter = new_object(f"{obj.name}_cutter", cutter_bm, obj.users_collection[0])
    modifier = obj.modifiers.new("cut", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.object = cutter
    bpy.context.view_layer.objects.active = obj
    for other in bpy.context.selected_objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return obj


def collection_for(name):
    existing = bpy.data.collections.get(name)
    if existing is not None:
        return existing
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    log("scene cleared")


def load_specs():
    specs = {}
    for filename in sorted(os.listdir(SPEC_DIR)):
        if not filename.endswith(".json"):
            continue
        with open(os.path.join(SPEC_DIR, filename), "r", encoding="utf-8") as handle:
            spec = json.load(handle)
        specs[spec["id"]] = spec
    return specs


def spec_hash(spec):
    payload = json.dumps(
        {"spec": spec, "builder": BUILDER_VERSION, "pipeline": PIPELINE_VERSION},
        sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_cache():
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, "r", encoding="utf-8") as handle:
            return json.load(handle)
    return {}


def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as handle:
        json.dump(cache, handle, indent=2, sort_keys=True)


def validate_objects(objects, max_extent=1.5):
    """Return a list of problems: empty meshes or geometry far outside any real part."""
    problems = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        if len(obj.data.vertices) == 0:
            problems.append(f"{obj.name}: empty mesh")
            continue
        extent = max(obj.dimensions)
        largest = max(max(abs(v.co.x), abs(v.co.y), abs(v.co.z)) for v in obj.data.vertices)
        if extent > max_extent or largest > max_extent:
            problems.append(f"{obj.name}: extent {extent:.3f} m, vertex at {largest:.3f} m")
        world = max(abs(value) for value in obj.matrix_world.translation) + extent
        if world > max_extent:
            problems.append(f"{obj.name}: world position {tuple(round(v, 3) for v in obj.location)} "
                            f"puts geometry at {world:.3f} m")
    return problems


def export_glb(objects, filepath):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0] if objects else None
    bpy.ops.export_scene.gltf(filepath=filepath, export_format="GLB",
                             use_selection=True, export_apply=True,
                             export_yup=True)
    return os.path.getsize(filepath)
