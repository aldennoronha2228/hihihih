"""Geometry builders, one per spec ``kind``.

Every builder returns the list of objects it created, already parented to a
per-part collection. Dimensions come from the spec; nothing is eyeballed.
"""

from __future__ import annotations

import math

import bmesh
from mathutils import Matrix, Vector

from pipeline import (bm_box, bm_cone, bm_cylinder, bm_revolve, boolean_difference,
                      collection_for, new_object)

MM = 0.001


def mm(value):
    return value * MM


def vec(values, scale=MM):
    return Vector(tuple(value * scale for value in values))


def build_pcb_board(spec):
    dims = spec["dimensions_mm"]
    features = spec["features"]
    collection = collection_for(f"part_{spec['id']}")
    objects = []

    board = bmesh.new()
    length, width, thickness = mm(dims["length"]), mm(dims["width"]), mm(dims["thickness"])
    bm_box(board, (length / 2, 0.0, 0.0), (length, width, thickness))
    for hole in features.get("mounting_holes", []):
        position = vec(hole["position_mm"])
        bm_cylinder(board, mm(hole["diameter_mm"]) / 2, thickness * 4,
                    (position.x + length / 2, position.y, 0.0))
    objects.append(new_object(f"{spec['id']}_pcb", board, collection, "pcb"))

    if features.get("usb_type") == "mini-b":
        shell = bmesh.new()
        overhang = mm(features["usb_overhang_mm"])
        bm_box(shell, (-overhang / 2 + mm(1.0), 0.0, mm(1.0)),
               (overhang + mm(2.0), mm(features["usb_width_mm"]), mm(features["usb_height_mm"])))
        objects.append(new_object(f"{spec['id']}_usb_mini_b", shell, collection, "steel_dark"))

    for name, key in (("mcu", "mcu"), ("usb_ic", "usb_ic"), ("regulator", "regulator")):
        info = features.get(key)
        if not info:
            continue
        chip = bmesh.new()
        body = vec(info["body_mm"])
        position = vec(info["position_mm"]) + Vector((length, 0.0, 0.0))
        bm_box(chip, position + Vector((0.0, 0.0, mm(info["body_mm"][2]) / 2 + thickness / 2)),
               body)
        objects.append(new_object(f"{spec['id']}_{name}", chip, collection, "epoxy_black"))

    for index, led in enumerate(features.get("leds", [])):
        chip = bmesh.new()
        position = vec(led["position_mm"]) + Vector((length, 0.0, 0.0))
        bm_cylinder(chip, mm(led["diameter_mm"]) / 2, mm(1.2),
                    position + Vector((0.0, 0.0, thickness / 2 + mm(0.6))))
        objects.append(new_object(f"{spec['id']}_led_{index}", chip, collection, "red"))

    button = features.get("reset_button")
    if button:
        chip = bmesh.new()
        position = vec(button["position_mm"]) + Vector((length, 0.0, 0.0))
        bm_box(chip, position + Vector((0.0, 0.0, mm(button["height_mm"]) / 2 + thickness / 2)),
               (mm(button["diameter_mm"]), mm(button["diameter_mm"]), mm(button["height_mm"])))
        objects.append(new_object(f"{spec['id']}_reset_button", chip, collection, "abs_grey"))

    headers = bmesh.new()
    pitch = mm(features["header_pitch_mm"])
    count = features["header_pins_per_row"]
    thickness = mm(features["header_pin_thickness_mm"])
    pin_length = mm(features["header_pin_length_mm"])
    insulator = mm(features["header_insulator_length_mm"])
    x0 = length - mm(1.0) - (count - 1) * pitch
    for row, y in enumerate((-width / 2 + mm(1.6), width / 2 - mm(1.6))):
        for index in range(count):
            x = x0 - index * pitch
            bm_box(headers, (x, y, thickness / 2 + (pin_length - insulator) / 2 + insulator / 2),
                   (thickness, thickness, pin_length - insulator))
            bm_box(headers, (x, y, thickness / 2 + insulator / 2), (thickness, thickness, insulator))
    objects.append(new_object(f"{spec['id']}_headers", headers, collection, "silver"))
    return objects


def build_dip_ic(spec):
    dims = spec["dimensions_mm"]
    collection = collection_for(f"part_{spec['id']}")
    objects = []

    body = bmesh.new()
    length = mm(dims["body_length"])
    width = mm(dims["body_width"])
    height = mm(dims["body_height"])
    bm_box(body, (0.0, 0.0, height / 2 + mm(dims["pin_length"])), (length, width, height))
    objects.append(new_object(f"{spec['id']}_body", body, collection, "epoxy_dark"))

    notch = bmesh.new()
    bm_cylinder(notch, mm(0.9), height, (-length / 2 - mm(0.1), 0.0, height / 2 + mm(dims["pin_length"])),
                axis="Y", segments=16)
    objects.append(new_object(f"{spec['id']}_notch", notch, collection, "epoxy_dark"))

    pins = bmesh.new()
    pitch = mm(dims["pin_pitch"])
    spacing = mm(dims["row_spacing"])
    pin_length = mm(dims["pin_length"])
    for side in (-1, 1):
        for index in range(8):
            x = (index - 3.5) * pitch
            bm_box(pins, (x, side * (spacing / 2 + pin_length / 2), pin_length / 2),
                   (mm(dims["lead_width"]), pin_length, mm(0.35)))
            bm_box(pins, (x, side * spacing / 2, pin_length / 2),
                   (mm(dims["lead_width"]), mm(0.6), mm(0.35)))
    objects.append(new_object(f"{spec['id']}_leads", pins, collection, "silver"))
    return objects


def build_hobby_servo(spec):
    dims = spec["dimensions_mm"]
    features = spec["features"]
    collection = collection_for(f"part_{spec['id']}")
    objects = []

    case = bmesh.new()
    body = (mm(dims["body_length"]), mm(dims["body_width"]), mm(dims["body_height"]))
    bm_box(case, (0.0, 0.0, body[2] / 2), body)
    objects.append(new_object(f"{spec['id']}_case", case, collection, "abs_blue"))

    flange = bmesh.new()
    bm_box(flange, (mm(2.0), 0.0, body[2] + mm(dims["flange_height"]) / 2),
           (mm(dims["flange_length"]), mm(dims["flange_width"]), mm(dims["flange_height"])))
    cut = bmesh.new()
    bm_cylinder(cut, mm(features["mount_hole_diameter"]) / 2, mm(dims["flange_height"]) * 4,
                (0.0, 0.0, body[2] + mm(dims["flange_height"]) / 2))
    bm_cylinder(cut, mm(features["mount_hole_diameter"]) / 2, mm(dims["flange_height"]) * 4,
                (mm(dims["flange_length"] - features["mount_hole_spacing_long"]), 0.0,
                 body[2] + mm(dims["flange_height"]) / 2))
    for sign in (-1, 1):
        bm_cylinder(cut, mm(features["mount_hole_diameter"]) / 2, mm(dims["flange_height"]) * 4,
                    (mm(dims["flange_length"] / 2),
                     sign * features["mount_hole_spacing_short"] * MM / 2,
                     body[2] + mm(dims["flange_height"]) / 2))
    objects.append(new_object(f"{spec['id']}_flange", flange, collection, "abs_blue"))
    boolean_difference(objects[-1], cut)

    top = bmesh.new()
    bm_box(top, (mm(1.0), 0.0, body[2] + mm(dims["flange_height"])),
           (body[0] - mm(2.0), body[1] - mm(1.6), mm(1.0)))
    objects.append(new_object(f"{spec['id']}_top_cover", top, collection, "abs_blue"))

    shaft = bmesh.new()
    shaft_z = body[2] + mm(dims["flange_height"]) + mm(dims["shaft_length"]) / 2 - mm(0.5)
    bm_cylinder(shaft, mm(dims["shaft_diameter"]) / 2, mm(dims["shaft_length"]),
                (0.0, 0.0, shaft_z), segments=24)
    flat = bmesh.new()
    bm_box(flat, (mm(dims["shaft_flat_mm"]), 0.0, shaft_z),
           (mm(dims["shaft_diameter"]) - mm(dims["shaft_flat_mm"]), mm(dims["shaft_diameter"]),
            mm(dims["shaft_length"])))
    objects.append(new_object(f"{spec['id']}_shaft", shaft, collection, "silver"))
    boolean_difference(objects[-1], flat)

    horn = bmesh.new()
    horn_z = body[2] + mm(dims["flange_height"]) + mm(dims["shaft_length"]) - mm(0.5)
    for arm in (-1, 1):
        bm_box(horn, (0.0, arm * mm(dims["horn_length"]) / 2, horn_z),
               (mm(2.0), mm(dims["horn_length"]), mm(2.5)))
        bm_cylinder(horn, mm(1.2), mm(3.0),
                    (0.0, arm * mm(dims["horn_length"] * 0.75), horn_z + mm(1.0)), segments=16)
    bm_cylinder(horn, mm(3.2), mm(3.0), (0.0, 0.0, horn_z), segments=24)
    objects.append(new_object(f"{spec['id']}_horn", horn, collection, "abs_grey"))

    cable = bmesh.new()
    bm_cone(cable, mm(2.2), mm(1.6), mm(features["cable_length"]),
            (-body[0] / 2, 0.0, body[2] * 0.35), axis="X", segments=16)
    objects.append(new_object(f"{spec['id']}_cable", cable, collection, "epoxy_black"))
    return objects


def build_panel_potentiometer(spec):
    dims = spec["dimensions_mm"]
    features = spec["features"]
    collection = collection_for(f"part_{spec['id']}")
    objects = []

    case = bmesh.new()
    radius = mm(dims["body_diameter"]) / 2
    height = mm(dims["body_height"])
    bm_cylinder(case, radius, height, (0.0, 0.0, height / 2), segments=32)
    objects.append(new_object(f"{spec['id']}_case", case, collection, "alu"))

    flange = bmesh.new()
    bm_cylinder(flange, mm(dims["flange_diameter"]) / 2, mm(dims["flange_thickness"]),
                (0.0, 0.0, height + mm(dims["flange_thickness"]) / 2), segments=32)
    cut = bmesh.new()
    for angle in (0.0, math.pi):
        offset = features["mount_hole_spacing"] * MM / 2
        bm_cylinder(cut, mm(features["mount_hole_diameter"]) / 2, mm(dims["flange_thickness"]) * 6,
                    (math.cos(angle) * offset, math.sin(angle) * offset,
                     height + mm(dims["flange_thickness"]) / 2))
    objects.append(new_object(f"{spec['id']}_flange", flange, collection, "alu"))
    boolean_difference(objects[-1], cut)

    shaft_z = height + mm(dims["flange_thickness"]) + mm(dims["shaft_length"]) / 2
    shaft = bmesh.new()
    bm_cylinder(shaft, mm(dims["shaft_diameter"]) / 2, mm(dims["shaft_length"]),
                (0.0, 0.0, shaft_z), segments=24)
    knurl = bmesh.new()
    bm_cylinder(knurl, mm(dims["shaft_diameter"]) / 2 + mm(0.4), mm(dims["knurl_length"]),
                (0.0, 0.0, shaft_z + mm(dims["shaft_length"]) / 2 - mm(dims["knurl_length"]) / 2),
                segments=20)
    flat = bmesh.new()
    bm_box(flat, (0.0, 0.0, shaft_z),
           (mm(dims["shaft_diameter"]) - mm(dims["shaft_flat_mm"]), mm(dims["shaft_diameter"]),
            mm(dims["shaft_length"])))
    objects.append(new_object(f"{spec['id']}_shaft", shaft, collection, "silver"))
    boolean_difference(objects[-1], flat)
    objects.append(new_object(f"{spec['id']}_knurl", knurl, collection, "alu"))

    lugs = bmesh.new()
    for sign in (-1, 1):
        lug_z = height * 0.35
        bm_box(lugs, (sign * (radius + mm(dims["lug_length"]) / 2), 0.0, lug_z),
               (mm(dims["lug_length"]), mm(dims["lug_thickness"]) * 4, mm(dims["lug_thickness"])))
        bm_box(lugs, (sign * radius, 0.0, lug_z),
               (mm(2.0), mm(dims["body_diameter"]) * 0.7, mm(dims["lug_thickness"])))
    middle = bmesh.new()
    bm_box(middle, (0.0, 0.0, height * 0.35),
           (mm(dims["body_diameter"]) * 0.5, mm(dims["lug_thickness"]) * 3, mm(dims["lug_thickness"])))
    objects.append(new_object(f"{spec['id']}_lugs", lugs, collection, "silver"))
    objects.append(new_object(f"{spec['id']}_center_lug", middle, collection, "silver"))
    return objects


def build_stepper_motor(spec):
    dims = spec["dimensions_mm"]
    collection = collection_for(f"part_{spec['id']}")
    objects = []
    frame = mm(dims["frame"])
    body_length = mm(dims["body_length"])
    cap_length = mm(dims["cap_length"])

    stack = bmesh.new()
    bm_box(stack, (0.0, 0.0, cap_length + body_length / 2), (frame, frame, body_length))
    cut = bmesh.new()
    pitch = dims["mount_hole_pitch"] * MM
    for sx in (-1, 1):
        for sy in (-1, 1):
            bm_cylinder(cut, mm(dims["mount_hole_diameter"]) / 2, frame * 2,
                        (sx * pitch / 2, sy * pitch / 2, cap_length + body_length / 2))
    objects.append(new_object(f"{spec['id']}_stack", stack, collection, "steel_dark"))
    boolean_difference(objects[-1], cut)

    for name, z0 in (("front_cap", cap_length + body_length),
                     ("rear_cap", 0.0)):
        cap = bmesh.new()
        bm_box(cap, (0.0, 0.0, z0 + cap_length / 2), (frame, frame, cap_length))
        pilot = bmesh.new()
        bm_cylinder(pilot, mm(dims["pilot_diameter"]) / 2, mm(dims["pilot_length"]) * 2,
                    (0.0, 0.0, z0 + cap_length))
        objects.append(new_object(f"{spec['id']}_{name}", cap, collection, "alu"))
        boolean_difference(objects[-1], pilot)

    shaft = bmesh.new()
    shaft_z = cap_length + body_length + cap_length + mm(dims["shaft_length"]) / 2
    bm_cylinder(shaft, mm(dims["shaft_diameter"]) / 2, mm(dims["shaft_length"]),
                (0.0, 0.0, shaft_z), segments=24)
    flat = bmesh.new()
    bm_box(flat, (mm(1.4), 0.0, shaft_z),
           (mm(dims["shaft_diameter"]), mm(dims["shaft_diameter"]), mm(dims["shaft_length"])))
    objects.append(new_object(f"{spec['id']}_shaft", shaft, collection, "silver"))
    boolean_difference(objects[-1], flat)

    cable = bmesh.new()
    bm_cone(cable, mm(dims["wire_exit_diameter"]) / 2, mm(4.0), mm(40.0),
            (0.0, frame / 2 + mm(20.0), cap_length * 0.5), axis="Y", segments=16)
    objects.append(new_object(f"{spec['id']}_cable", cable, collection, "epoxy_black"))
    return objects


def build_rc_brushed_motor(spec):
    dims = spec["dimensions_mm"]
    collection = collection_for(f"part_{spec['id']}")
    objects = []
    can_radius = mm(dims["can_diameter"]) / 2
    can_length = mm(dims["can_length"])
    endbell = mm(dims["endbell_length"])

    can = bmesh.new()
    bm_cylinder(can, can_radius, can_length - endbell, (0.0, 0.0, endbell + (can_length - endbell) / 2),
                segments=40)
    objects.append(new_object(f"{spec['id']}_can", can, collection, "steel_dark"))

    cap = bmesh.new()
    bm_revolve(cap, [
        (can_radius, 0.0),
        (mm(dims["endbell_diameter"]) / 2, 0.0),
        (mm(dims["endbell_diameter"]) / 2, endbell * 0.7),
        (can_radius * 0.92, endbell),
        (can_radius, endbell),
    ], segments=40)
    objects.append(new_object(f"{spec['id']}_endbell", cap, collection, "epoxy_black"))

    tabs = bmesh.new()
    pitch = mm(dims["mount_hole_pitch"])
    for sign in (-1, 1):
        bm_box(tabs, (sign * pitch / 2, -mm(dims["mount_tab_width"]) / 2 - can_radius * 0.55, endbell * 0.55),
               (mm(dims["mount_tab_width"]), mm(dims["mount_tab_width"]), endbell * 0.9))
    cut = bmesh.new()
    for sign in (-1, 1):
        bm_cylinder(cut, mm(dims["mount_hole_diameter"]) / 2, endbell * 3,
                    (sign * pitch / 2, -mm(dims["mount_tab_width"]) / 2 - can_radius * 0.55,
                     endbell * 0.55))
    objects.append(new_object(f"{spec['id']}_mount_tabs", tabs, collection, "alu"))
    boolean_difference(objects[-1], cut)

    shaft = bmesh.new()
    bm_cylinder(shaft, mm(dims["shaft_diameter"]) / 2, mm(dims["shaft_length"]),
                (0.0, 0.0, mm(dims["shaft_length"]) / 2 + endbell), segments=24)
    objects.append(new_object(f"{spec['id']}_shaft", shaft, collection, "silver"))

    wires = bmesh.new()
    for index, offset in enumerate((-6.0, -2.0, 2.0, 6.0)):
        bm_cone(wires, mm(0.9), mm(0.9), mm(35.0),
                (mm(offset), can_radius + mm(17.0), endbell * 0.5), axis="Y", segments=8)
    objects.append(new_object(f"{spec['id']}_wires", wires, collection, "epoxy_black"))
    return objects


def build_rc_esc(spec):
    dims = spec["dimensions_mm"]
    collection = collection_for(f"part_{spec['id']}")
    objects = []
    size = (mm(dims["length"]), mm(dims["width"]), mm(dims["height"]))
    case = bmesh.new()
    bm_box(case, (0.0, 0.0, size[2] / 2), size)
    objects.append(new_object(f"{spec['id']}_case", case, collection, "epoxy_black"))

    capacitor = bmesh.new()
    bm_box(capacitor, (-size[0] / 2 + mm(dims["capacitor_block_length"]) / 2,
                       size[1] / 2 - mm(dims["capacitor_block_width"]) / 2,
                       size[2] + mm(dims["capacitor_block_height"]) / 2),
           (mm(dims["capacitor_block_length"]), mm(dims["capacitor_block_width"]),
            mm(dims["capacitor_block_height"])))
    objects.append(new_object(f"{spec['id']}_capacitor_block", capacitor, collection, "alu"))

    for name, offset in (("signal", (-size[0] / 2 - mm(6.0), -size[1] / 4, size[2] * 0.5)),
                         ("motor_bullet_a", (size[0] / 2 + mm(5.0), -size[1] / 4, size[2] * 0.5)),
                         ("motor_bullet_b", (size[0] / 2 + mm(5.0), size[1] / 4, size[2] * 0.5))):
        connector = bmesh.new()
        bm_cylinder(connector, mm(3.0) if name == "signal" else mm(3.5), mm(9.0),
                    (offset[0] + (mm(3.0) if name == "signal" else mm(5.0)) * 0.0,
                     offset[1], offset[2]), axis="X", segments=16)
        objects.append(new_object(f"{spec['id']}_{name}", connector, collection, "gold"))
    return objects


def build_rc_battery(spec):
    dims = spec["dimensions_mm"]
    collection = collection_for(f"part_{spec['id']}")
    objects = []
    size = (mm(dims["length"]), mm(dims["width"]), mm(dims["height"]))
    shell = bmesh.new()
    bm_box(shell, (0.0, 0.0, size[2] / 2), size)
    objects.append(new_object(f"{spec['id']}_shell", shell, collection, "pack_blue"))

    label = bmesh.new()
    bm_box(label, (0.0, 0.0, size[2] + mm(0.2)), (size[0] * 0.9, size[1] * 0.9, mm(0.4)))
    objects.append(new_object(f"{spec['id']}_label", label, collection, "silver"))

    for index, x in enumerate((-size[0] * 0.2, size[0] * 0.2)):
        cell_seam = bmesh.new()
        bm_box(cell_seam, (x, 0.0, size[2] / 2), (mm(0.6), size[1] * 1.002, size[2] * 1.002))
        objects.append(new_object(f"{spec['id']}_cell_seam_{index}", cell_seam, collection, "epoxy_dark"))

    leads = bmesh.new()
    bm_box(leads, (size[0] / 2 + mm(12.0), 0.0, size[2] * 0.5), (mm(24.0), mm(8.0), mm(3.0)))
    connector = bmesh.new()
    bm_box(connector, (size[0] / 2 + mm(26.0), 0.0, size[2] * 0.5), (mm(8.0), mm(16.0), mm(9.0)))
    objects.append(new_object(f"{spec['id']}_leads", leads, collection, "epoxy_black"))
    objects.append(new_object(f"{spec['id']}_connector", connector, collection, "epoxy_dark"))
    return objects


def build_rc_tire(spec):
    dims = spec["dimensions_mm"]
    collection = collection_for(f"part_{spec['id']}")
    objects = []
    outer = mm(dims["outer_diameter"]) / 2
    rim = mm(dims["rim_diameter"]) / 2
    width = mm(dims["width"])
    shoulder = mm(dims["shoulder_radius"])

    tire = bmesh.new()
    bm_revolve(tire, [
        (rim, -width / 2),
        (outer - shoulder * 0.6, -width / 2),
        (outer, -width / 2 + shoulder * 0.7),
        (outer, width / 2 - shoulder * 0.7),
        (outer - shoulder * 0.6, width / 2),
        (rim, width / 2),
    ], segments=48)
    objects.append(new_object(f"{spec['id']}_tire", tire, collection, "rubber"))

    wheel = bmesh.new()
    bm_revolve(wheel, [
        (mm(3.0), -mm(dims["rim_width"]) / 2),
        (rim, -mm(dims["rim_width"]) / 2),
        (rim, mm(dims["rim_width"]) / 2),
        (mm(3.0), mm(dims["rim_width"]) / 2),
    ], segments=48)
    objects.append(new_object(f"{spec['id']}_rim", wheel, collection, "abs_grey"))

    spokes = bmesh.new()
    hub_radius = mm(6.5)
    for index in range(6):
        angle = index * math.pi / 3
        span = rim - hub_radius
        mid = hub_radius + span * 0.5
        bm_box(spokes, (math.cos(angle) * mid, math.sin(angle) * mid, 0.0),
               (span, mm(3.0), mm(dims["rim_width"]) * 0.55))
    bm_cylinder(spokes, hub_radius, mm(dims["rim_width"]) * 0.6)
    objects.append(new_object(f"{spec['id']}_spokes", spokes, collection, "abs_grey"))

    hub = bmesh.new()
    hex_radius = mm(dims["hub_hex"]) / 2
    bm_cylinder(hub, hex_radius, mm(dims["rim_width"]) * 0.85, axis="X", segments=6)
    bore = bmesh.new()
    bm_cylinder(bore, hex_radius * 0.55, mm(dims["rim_width"]) * 2, axis="X", segments=24)
    objects.append(new_object(f"{spec['id']}_hub_hex", hub, collection, "alu"))
    boolean_difference(objects[-1], bore)

    tread = bmesh.new()
    grooves = 18
    for index in range(grooves):
        angle = index * 2 * math.pi / grooves
        bm_box(tread, (math.cos(angle) * (outer - mm(0.8)), math.sin(angle) * (outer - mm(0.8)), 0.0),
               (mm(2.0), mm(3.0), width * 0.62))
    objects.append(new_object(f"{spec['id']}_tread", tread, collection, "rubber"))
    return objects


BUILDERS = {
    "pcb_board": build_pcb_board,
    "dip_ic": build_dip_ic,
    "hobby_servo": build_hobby_servo,
    "panel_potentiometer": build_panel_potentiometer,
    "stepper_motor": build_stepper_motor,
    "rc_brushed_motor": build_rc_brushed_motor,
    "rc_esc": build_rc_esc,
    "rc_battery": build_rc_battery,
    "rc_tire": build_rc_tire,
}
