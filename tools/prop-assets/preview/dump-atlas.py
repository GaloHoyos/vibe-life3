"""Vuelca los atlas de un pack a PNG y reporta su color medio por casilla."""
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
out_dir = argv[1]
os.makedirs(out_dir, exist_ok=True)

for img in bpy.data.images:
    if img.size[0] == 0:
        continue
    path = os.path.join(out_dir, f"{img.name}.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    print(f"DUMP {img.name} -> {path}")

    if "albedo" not in img.name:
        continue
    width, height = img.size
    pixels = list(img.pixels)
    # Media por cuadrante: el atlas son cuatro casillas.
    for tile_y in range(2):
        for tile_x in range(2):
            total = [0.0, 0.0, 0.0]
            count = 0
            for y in range(tile_y * height // 2, (tile_y + 1) * height // 2, 4):
                for x in range(tile_x * width // 2, (tile_x + 1) * width // 2, 4):
                    base = (y * width + x) * 4
                    total[0] += pixels[base]
                    total[1] += pixels[base + 1]
                    total[2] += pixels[base + 2]
                    count += 1
            tile = tile_y * 2 + tile_x
            srgb = [round((c / count) ** (1 / 2.2) * 255) for c in total]
            print(f"DUMP tile{tile} medio_sRGB={srgb}")
