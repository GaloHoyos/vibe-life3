"""Reporta materiales, texturas y salud de UVs de un pack."""
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])

print("PROBE materials", len(bpy.data.materials))
for mat in bpy.data.materials:
    images = [n.image.name for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
    print(f"PROBE mat {mat.name} texturas={images}")

for img in bpy.data.images:
    print(f"PROBE img {img.name} {img.size[0]}x{img.size[1]}")

target = argv[1] if len(argv) > 1 else None
for obj in sorted(bpy.data.objects, key=lambda o: o.name):
    if obj.type != "MESH":
        continue
    if target and target not in obj.name:
        continue
    if "lod0" not in obj.name or "_v0" not in obj.name:
        continue
    mesh = obj.data
    uv = mesh.uv_layers.active
    if uv is None:
        print(f"PROBE {obj.name} SIN UV")
        continue

    degenerate = 0
    spans = []
    for poly in mesh.polygons:
        loops = [uv.data[i].uv for i in poly.loop_indices]
        area = 0.0
        for i in range(len(loops)):
            a = loops[i]
            b = loops[(i + 1) % len(loops)]
            area += a.x * b.y - b.x * a.y
        area = abs(area) / 2
        if area < 1e-7:
            degenerate += 1
        spans.append(area)
    total = sum(spans)
    print(
        f"PROBE {obj.name} caras={len(spans)} degeneradas={degenerate}"
        f" area_uv_total={total:.5f} area_uv_max={max(spans):.5f}"
    )
