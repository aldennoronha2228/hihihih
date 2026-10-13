"""Custom RC vehicle geometry: chassis, running gear, steering, drivetrain, body.

Every dimension comes from ``specs/rc-chassis-assembly.json``. This is a custom
design fitted around the sourced component envelopes, not a model of a product.
"""

from __future__ import annotations

import math

import bmesh
from mathutils import Matrix, Vector

from builders import MM, mm
from pipeline import (bm_box, bm_cone, bm_cylinder, bm_revolve, boolean_difference,
                      collection_for, new_object)

FRONT_AXLE_X_RATIO = 0.5


class Vehicle:
    def __init__(self, spec):
        self.spec = spec
        self.dims = spec["dimensions_mm"]
        self.features = spec["features"]
        self.wheelbase = self.dims["wheelbase"]
        self.front_x = self.wheelbase * FRONT_AXLE_X_RATIO
        self.rear_x = -self.wheelbase * FRONT_AXLE_X_RATIO
        self.front_radius = 29.5
        self.rear_radius = 34.0
        self.front_track = self.dims["track_front"] / 2
        self.rear_track = self.dims["track_rear"] / 2
        self.lower_z = self.dims["lower_plate_height"]
        self.lower_thickness = self.dims["lower_plate_thickness"]
        self.upper_z = self.lower_z + self.lower_thickness + self.dims["plate_gap"]
        self.upper_thickness = self.dims["upper_plate_thickness"]
        self.objects = []

    def add(self, name, bm, mat):
        collection = collection_for("rc_car")
        obj = new_object(f"rc_{name}", bm, collection, mat)
        self.objects.append(obj)
        return obj

    def plate_with_holes(self, name, length, width, z, thickness, holes, mat, cut_mat="alu"):
        bm = bmesh.new()
        bm_box(bm, (0.0, 0.0, mm(z)), (mm(length), mm(width), mm(thickness)))
        cutter = bmesh.new()
        for hole in holes:
            bm_cylinder(cutter, mm(hole["diameter"]) / 2, mm(thickness) * 6,
                        (mm(hole["x"]), mm(hole["y"]), mm(z)))
        obj = self.add(name, bm, mat)
        boolean_difference(obj, cutter)
        return obj

    def build(self):
        self.build_chassis()
        self.build_body()
        self.build_running_gear()
        self.build_steering()
        self.build_drivetrain()
        return self.objects

    def build_chassis(self):
        dims = self.dims
        hole_diameter = dims["lightening_hole_diameter"]
        lower_holes = []
        for index in range(6):
            lower_holes.append({"x": -100 + index * 40, "y": 0.0,
                                "diameter": hole_diameter * 0.8})
        for sign in (-1, 1):
            for index in range(4):
                lower_holes.append({"x": -90 + index * 60,
                                    "y": sign * (dims["chassis_width"] / 2 - 8.0),
                                    "diameter": hole_diameter * 0.55})
        self.plate_with_holes("chassis_lower", dims["chassis_length"], dims["chassis_width"],
                              self.lower_z, self.lower_thickness, lower_holes, "alu")

        upper_holes = [
            {"x": dims["servo_mount_position"][0], "y": 0.0, "diameter": 8.0},
            {"x": dims["servo_mount_position"][0] + 55.0, "y": 0.0, "diameter": 8.0},
            {"x": dims["servo_mount_position"][0], "y": -50.0, "diameter": 5.0},
            {"x": dims["servo_mount_position"][0], "y": 50.0, "diameter": 5.0},
        ]
        self.plate_with_holes("chassis_upper", dims["chassis_length"] * 0.92,
                              dims["chassis_width"] * 0.9, self.upper_z,
                              self.upper_thickness, upper_holes, "alu")

        standoffs = bmesh.new()
        for x in (-110.0, -40.0, 40.0, 110.0):
            for sign in (-1, 1):
                y = sign * (dims["chassis_width"] / 2 - 10.0)
                bm_cylinder(standoffs, mm(dims["standoff_diameter"]) / 2,
                            mm(dims["plate_gap"]),
                            (mm(x), mm(y), mm(self.lower_z + self.lower_thickness
                                             + dims["plate_gap"] / 2)), segments=16)
        self.add("standoffs", standoffs, "alu")

        deck = bmesh.new()
        deck_position = dims["electronics_deck_position"]
        bm_box(deck, (mm(deck_position[0]), mm(deck_position[1]),
                      mm(self.lower_z + self.lower_thickness + 1.5)),
               (mm(60.0), mm(110.0), mm(3.0)))
        self.add("electronics_deck", deck, "alu")

        tray = bmesh.new()
        tray_position = dims["battery_tray_position"]
        bm_box(tray, (mm(tray_position[0]), mm(tray_position[1]),
                      mm(self.lower_z + self.lower_thickness + 2.0)),
               (mm(145.0), mm(52.0), mm(2.0)))
        for sign in (-1, 1):
            bm_box(tray, (mm(tray_position[0]), mm(tray_position[1] + sign * 26.0),
                          mm(self.lower_z + self.lower_thickness + 8.0)),
                   (mm(145.0), mm(3.0), mm(14.0)))
        self.add("battery_tray", tray, "alu")

        straps = bmesh.new()
        for x in (tray_position[0] - 40.0, tray_position[0] + 40.0):
            bm_box(straps, (mm(x), mm(tray_position[1]),
                            mm(self.lower_z + self.lower_thickness + 28.0)),
                   (mm(12.0), mm(60.0), mm(1.2)))
        self.add("battery_straps", straps, "rubber")

    def build_body(self):
        dims = self.dims
        length = dims["body_length"]
        width = dims["body_width"]
        height = dims["body_height"]
        base_z = self.upper_z + self.upper_thickness
        shell = bmesh.new()
        bm_box(shell, (mm(-10.0), 0.0, mm(base_z + 10.0)),
               (mm(length), mm(width), mm(20.0)))
        bm_box(shell, (mm(60.0), 0.0, mm(base_z + 26.0)),
               (mm(length * 0.45), mm(width * 0.86), mm(32.0)))
        bm_box(shell, (mm(-80.0), 0.0, mm(base_z + 34.0)),
               (mm(length * 0.4), mm(width * 0.8), mm(48.0)))
        cabin = bmesh.new()
        bm_box(cabin, (mm(55.0), 0.0, mm(base_z + 58.0)),
               (mm(length * 0.34), mm(width * 0.72), mm(30.0)))
        self.add("body_shell", shell, "body_shell")
        boolean_difference(self.objects[-1], cabin)

        arches = bmesh.new()
        for x, radius, half_track in ((self.front_x, self.front_radius, self.front_track),
                                      (self.rear_x, self.rear_radius, self.rear_track)):
            for sign in (-1, 1):
                bm_cylinder(arches, mm(radius + dims["wheel_arch_clearance"]),
                            mm(30.0),
                            (mm(x), mm(sign * half_track), mm(self.front_radius)), axis="Y",
                            segments=40)
        boolean_difference(self.objects[-1], arches)

        glass = bmesh.new()
        bm_box(glass, (mm(55.0), 0.0, mm(base_z + 62.0)),
               (mm(length * 0.3), mm(width * 0.68), mm(22.0)))
        self.add("body_glass", glass, "glass")

        wing = bmesh.new()
        bm_box(wing, (mm(-135.0), 0.0, mm(base_z + 46.0)),
               (mm(70.0), mm(width * 0.9), mm(3.0)))
        for sign in (-1, 1):
            bm_box(wing, (mm(-135.0), mm(sign * width * 0.3), mm(base_z + 33.0)),
                   (mm(60.0), mm(3.0), mm(26.0)))
        self.add("rear_wing", wing, "body_shell")

    def build_running_gear(self):
        dims = self.dims
        for name, x, radius, track in (("front", self.front_x, self.front_radius, self.front_track),
                                       ("rear", self.rear_x, self.rear_radius, self.rear_track)):
            axle = bmesh.new()
            bm_cylinder(axle, mm(dims["front_axle_diameter" if name == "front"
                                       else "rear_axle_diameter"]) / 2,
                        mm(dims["front_axle_length" if name == "front" else "rear_axle_length"]),
                        (mm(x), 0.0, mm(radius)), axis="Y", segments=20)
            self.add(f"{name}_axle", axle, "steel_dark")

            bearing = bmesh.new()
            for sign in (-1, 1):
                bm_cylinder(bearing, mm(5.0), mm(8.0),
                            (mm(x), mm(sign * (track - 12.0)), mm(radius)), axis="Y", segments=20)
            self.add(f"{name}_axle_carriers", bearing, "alu")

            for sign, side in ((1, "left"), (-1, "right")):
                knuckle = bmesh.new()
                bm_box(knuckle, (mm(x), mm(sign * (track + 6.0)), mm(radius)),
                       (mm(12.0), mm(6.0), mm(28.0)))
                bm_cylinder(knuckle, mm(dims["kingpin_diameter"]) / 2, mm(dims["kingpin_height"]),
                            (mm(x), mm(sign * (track + 3.0)), mm(radius + 12.0)), segments=16)
                self.add(f"{name}_knuckle_{side}", knuckle, "alu")

                hub = bmesh.new()
                bm_cylinder(hub, mm(6.0), mm(20.0),
                            (mm(x), mm(sign * track), mm(radius)), axis="Y", segments=20)
                self.add(f"{name}_wheel_hub_{side}", hub, "alu")

    def build_steering(self):
        dims = self.dims
        z = self.upper_z + 22.0
        arm_length = dims["steering_arm_length"]
        for sign, side in ((1, "left"), (-1, "right")):
            arm = bmesh.new()
            bm_box(arm, (mm(self.front_x), mm(sign * (self.front_track - 12.0)), mm(z)),
                   (mm(arm_length), mm(6.0), mm(4.0)))
            steering_pivot = bmesh.new()
            bm_cylinder(steering_pivot, mm(dims["kingpin_diameter"]) / 2, mm(6.0),
                        (mm(self.front_x), mm(sign * (self.front_track - 12.0)), mm(z)), segments=16)
            boolean_difference(self.add(f"steering_arm_{side}", arm, "alu"), steering_pivot)

            tie = bmesh.new()
            start = Vector((self.front_x - arm_length * 0.8, sign * (self.front_track - 12.0), z)) * MM
            end = Vector((self.front_x + dims["servo_horn_offset"],
                          sign * dims["tie_rod_length"] / 2, z)) * MM
            direction = end - start
            bm_cylinder(tie, mm(2.0), direction.length, (0.0, 0.0, 0.0), segments=12)
            rotation = direction.to_track_quat("Z", "Y").to_matrix().to_4x4()
            bmesh.ops.transform(tie, matrix=Matrix.Translation((start + end) / 2.0) @ rotation,
                                verts=tie.verts[:])
            self.add(f"tie_rod_{side}", tie, "steel_dark")

    def build_drivetrain(self):
        dims = self.dims
        mount = dims["motor_mount_position"]
        motor_y = dims["motor_offset_from_centerline"]
        motor_z = self.lower_z + self.lower_thickness + 18.0

        plate = bmesh.new()
        bm_box(plate, (mm(mount[0]), mm(motor_y / 2), mm(mount[2])),
               (mm(60.0), mm(70.0), mm(5.0)))
        self.add("motor_mount_plate", plate, "alu")

        can = bmesh.new()
        bm_cylinder(can, mm(18.0), mm(45.0), (mm(mount[0]), mm(motor_y), mm(motor_z)),
                    axis="Y", segments=40)
        self.add("drive_motor_can", can, "steel_dark")

        endbell = bmesh.new()
        bm_cylinder(endbell, mm(18.5), mm(9.0),
                    (mm(mount[0]), mm(motor_y - 27.0), mm(motor_z)), axis="Y", segments=40)
        self.add("drive_motor_endbell", endbell, "epoxy_black")

        pinion_shaft = bmesh.new()
        bm_cylinder(pinion_shaft, mm(1.6), mm(12.0),
                    (mm(mount[0]), mm(motor_y - 33.0), mm(motor_z)), axis="Y", segments=16)
        self.add("motor_shaft", pinion_shaft, "silver")

        pinion = bmesh.new()
        teeth = dims["pinion_teeth"]
        module = dims["gear_module_mm"]
        pitch_radius = teeth * module / 2
        bm_cylinder(pinion, mm(pitch_radius) * 0.62, mm(6.0),
                    (mm(mount[0]), mm(motor_y - 36.0), mm(motor_z)), axis="Y", segments=24)
        for index in range(teeth):
            angle = index * 2 * math.pi / teeth
            bm_box(pinion, (mm(mount[0]) + math.cos(angle) * mm(pitch_radius),
                            mm(motor_y - 36.0),
                            mm(motor_z) + math.sin(angle) * mm(pitch_radius)),
                   (mm(module), mm(6.0), mm(module)))
        self.add("pinion_12t", pinion, "steel_dark")

        spur_teeth = dims["spur_teeth"]
        spur_radius = spur_teeth * module / 2
        spur_center_y = motor_y - 36.0 - pitch_radius - spur_radius
        spur = bmesh.new()
        bm_revolve(spur, [
            (mm(6.0), -mm(3.0)),
            (mm(spur_radius), -mm(3.0)),
            (mm(spur_radius), mm(3.0)),
            (mm(6.0), mm(3.0)),
        ], center=(mm(mount[0]), mm(spur_center_y), mm(motor_z)), axis="Y", segments=48)
        for index in range(spur_teeth):
            angle = index * 2 * math.pi / spur_teeth
            bm_box(spur, (mm(mount[0]) + math.cos(angle) * mm(spur_radius),
                          mm(spur_center_y),
                          mm(motor_z) + math.sin(angle) * mm(spur_radius)),
                   (mm(module), mm(6.0), mm(module)))
        self.add("spur_50t", spur, "silver")

        diff = bmesh.new()
        bm_revolve(diff, [
            (mm(6.0), -mm(14.0)),
            (mm(dims["center_diff_diameter"]) / 2, -mm(10.0)),
            (mm(dims["center_diff_diameter"]) / 2, mm(10.0)),
            (mm(6.0), mm(14.0)),
        ], center=(mm(mount[0]), 0.0, mm(motor_z)), axis="Y", segments=40)
        self.add("center_differential", diff, "alu")

        shafts = bmesh.new()
        for sign in (-1, 1):
            bm_cylinder(shafts, mm(2.5), mm(120.0),
                        (mm(mount[0]), mm(sign * (self.rear_track - 10.0)), mm(self.rear_radius)),
                        axis="Y", segments=16)
        self.add("driveshafts", shafts, "steel_dark")

        converter = bmesh.new()
        bm_box(converter, (mm(15.0), mm(20.0), mm(self.lower_z + 6.0)),
               (mm(30.0), mm(24.0), mm(12.0)))
        self.add("battery_connector", converter, "epoxy_dark")


def place_parts(spec_id, objects_by_id, location, rotation_deg=(0.0, 0.0, 0.0)):
    for obj in objects_by_id.get(spec_id, []):
        obj.location = Vector(location)
        obj.rotation_euler = tuple(math.radians(angle) for angle in rotation_deg)
    return objects_by_id.get(spec_id, [])
