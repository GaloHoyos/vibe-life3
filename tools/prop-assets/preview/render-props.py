"""Renderiza una lámina de contacto de los props de un pack.

Uso:
    blender --background --python render_props.py -- <pack.glb> <salida.png> [columnas]

Existe para poder MIRAR el catálogo: se generaron decenas de props sin que nadie
los viera nunca, y la calidad de un asset no se audita leyendo su builder.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
GLB_PATH = argv[0]
OUT_DIR = argv[1]
TILE = int(argv[2]) if len(argv) > 2 else 320

bpy.ops.wm.read_factory_settings(use_empty=True)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = TILE
scene.render.resolution_y = TILE
scene.render.film_transparent = False

# Fondo gris medio: no compite con el prop y deja ver tanto lo claro como lo oscuro.
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.22, 0.23, 0.25, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

bpy.ops.import_scene.gltf(filepath=GLB_PATH)

# Luz clave más relleno: sin relleno los flancos quedan negros y no se juzga nada.
key_data = bpy.data.lights.new("key", type="SUN")
key_data.energy = 3.2
key_data.angle = 0.12
key = bpy.data.objects.new("key", key_data)
scene.collection.objects.link(key)

fill_data = bpy.data.lights.new("fill", type="SUN")
fill_data.energy = 1.0
fill_data.angle = 0.5
fill = bpy.data.objects.new("fill", fill_data)
scene.collection.objects.link(fill)

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def visual_meshes(root):
    """Mallas del LOD0, variante 0. Es lo que el jugador ve de cerca."""
    found = []
    for child in root.children_recursive:
        if child.type != "MESH":
            continue
        names = []
        node = child
        while node is not None:
            names.append(node.name)
            node = node.parent
        chain = " ".join(names)
        if "lod0" in chain and "collider" not in chain and "chunk" not in chain:
            if "_v0" in child.name or "variant_0" in chain:
                found.append(child)
    return found


def world_bounds(objects):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], point[i]) for i in range(3)))
            hi = Vector((max(hi[i], point[i]) for i in range(3)))
    return lo, hi


roots = [o for o in scene.objects if o.name.startswith("prop_") and o.parent is None or o.name.startswith("prop_")]
roots = sorted({o.name: o for o in scene.objects if o.name.startswith("prop_")}.values(), key=lambda o: o.name)
print(f"RENDER props={len(roots)}")

os.makedirs(OUT_DIR, exist_ok=True)

for root in roots:
    meshes = visual_meshes(root)
    if not meshes:
        print(f"RENDER skip {root.name} (sin lod0)")
        continue

    # Sólo este prop visible.
    for obj in scene.objects:
        if obj.type == "MESH":
            obj.hide_render = True
    for obj in meshes:
        obj.hide_render = False

    lo, hi = world_bounds(meshes)
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.05)

    # Tres cuartos desde arriba: la vista que más informa sobre una silueta.
    direction = Vector((1.0, -1.35, 0.75)).normalized()
    distance = radius * 3.1
    cam.location = center + direction * distance
    cam_data.lens = 55
    track = cam.constraints.new(type="TRACK_TO")
    empty = bpy.data.objects.new("target", None)
    empty.location = center
    scene.collection.objects.link(empty)
    track.target = empty
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    key.location = center + Vector((2.2, -2.6, 3.0)).normalized() * (radius * 4)
    fill.location = center + Vector((-2.6, -1.4, 1.0)).normalized() * (radius * 5)
    for light in (key, fill):
        light.rotation_mode = "QUATERNION"
        light.rotation_quaternion = (center - light.location).to_track_quat("-Z", "Y")
    # El sol se mide en W/m2: no depende de la distancia, asi que la exposicion
    # no cambia entre un frasco y un ropero. Con luces de area habia que escalar
    # por el radio y el cajon salia quemado a blanco.

    name = root.name.replace("prop_", "")
    scene.render.filepath = os.path.join(OUT_DIR, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"RENDER ok {name}")

    cam.constraints.remove(track)
    bpy.data.objects.remove(empty)

print("RENDER done")
