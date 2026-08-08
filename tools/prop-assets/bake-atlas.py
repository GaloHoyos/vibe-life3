"""Hornea una casilla de atlas PBR con los nodos procedurales de Blender.

Uso:
    blender --background --python bake-atlas.py -- <spec.json> <salida>

`spec.json` describe las casillas; por cada una se escriben tres PNG de 512:
`<salida>/<indice>_albedo.png`, `_normal.png` y `_orm.png`. Componer el atlas y
codificar a WebP es trabajo del lado TypeScript, que ya tiene ese camino.

El vocabulario vive en `tools/shared/gltf/materials.ts`; acá sólo se traduce cada
familia a un grafo de nodos. La diferencia con el generador de fBm a mano es que
estos materiales tienen ESTRUCTURA —veta, árido, trama, corrugado— y no una nube
de ruido teñida distinto, que es lo que delataba al set como generado.
"""
import json
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
SPEC = json.load(open(argv[0], encoding="utf8"))
OUT_DIR = argv[1]
os.makedirs(OUT_DIR, exist_ok=True)

SIZE = SPEC.get("tileSize", 512)


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    # El horneado de un material procedural no tiene ruido de muestreo: no hay
    # trazado indirecto, sólo evaluar el grafo. Con 1 muestra alcanza y es 30x
    # más rápido que dejar el default.
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 16
    scene.render.bake.use_clear = True


def make_plane():
    """Plano unitario con UV 0..1: el lienzo sobre el que se hornea."""
    bpy.ops.mesh.primitive_plane_add(size=2)
    plane = bpy.context.active_object
    return plane


def new_image(name: str, is_data: bool):
    image = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=False)
    image.colorspace_settings.name = "Non-Color" if is_data else "sRGB"
    return image


def srgb_to_linear(value: float) -> float:
    """Blender trabaja en lineal; los colores del spec vienen en sRGB 0..255."""
    channel = value / 255
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def rgb(color) -> tuple:
    return (
        srgb_to_linear(color[0]),
        srgb_to_linear(color[1]),
        srgb_to_linear(color[2]),
        1.0,
    )


# ---------------------------------------------------------------------------
# Familias de material
# ---------------------------------------------------------------------------


def coords(nodes, links, scale: float, seed: float, aspect=(1.0, 1.0)):
    """Coordenadas de textura desplazadas por semilla, para que dos casillas de
    la misma familia no salgan idénticas.

    `aspect` estira el mapeo por eje. Sirve para el chorreado: la suciedad que
    baja por una pared es larguísima en vertical y angosta en horizontal, y eso
    no sale de ningún ruido isótropo.
    """
    tex = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Location"].default_value = (seed * 3.7, seed * 8.1, seed * 1.3)
    mapping.inputs["Scale"].default_value = (scale * aspect[0], scale * aspect[1], scale)
    links.new(tex.outputs["UV"], mapping.inputs["Vector"])
    return mapping


def noise(nodes, links, vector, scale, detail=8.0, roughness=0.5, distortion=0.0):
    node = nodes.new("ShaderNodeTexNoise")
    node.inputs["Scale"].default_value = scale
    node.inputs["Detail"].default_value = detail
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Distortion"].default_value = distortion
    links.new(vector, node.inputs["Vector"])
    return node


def voronoi(nodes, links, vector, scale, feature="F1", randomness=1.0):
    node = nodes.new("ShaderNodeTexVoronoi")
    node.feature = feature
    node.inputs["Scale"].default_value = scale
    node.inputs["Randomness"].default_value = randomness
    links.new(vector, node.inputs["Vector"])
    return node


def wave(nodes, links, vector, scale, distortion, detail=2.0, bands="X"):
    node = nodes.new("ShaderNodeTexWave")
    node.wave_type = "BANDS"
    node.bands_direction = bands
    node.wave_profile = "SIN"
    node.inputs["Scale"].default_value = scale
    node.inputs["Distortion"].default_value = distortion
    node.inputs["Detail"].default_value = detail
    links.new(vector, node.inputs["Vector"])
    return node


def ramp(nodes, links, source, stops):
    node = nodes.new("ShaderNodeValToRGB")
    elements = node.color_ramp.elements
    while len(elements) > 1:
        elements.remove(elements[-1])
    elements[0].position = stops[0][0]
    elements[0].color = stops[0][1]
    for position, color in stops[1:]:
        element = elements.new(position)
        element.color = color
    links.new(source, node.inputs["Fac"])
    return node


def mix_rgb(nodes, links, factor, color_a, color_b):
    node = nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    node.blend_type = "MIX"
    links.new(factor, node.inputs["Factor"])
    if hasattr(color_a, "default_value") or not isinstance(color_a, tuple):
        links.new(color_a, node.inputs[6])
    else:
        node.inputs[6].default_value = color_a
    if isinstance(color_b, tuple):
        node.inputs[7].default_value = color_b
    else:
        links.new(color_b, node.inputs[7])
    return node


def math(nodes, links, operation, a, b=None):
    node = nodes.new("ShaderNodeMath")
    node.operation = operation
    if isinstance(a, float):
        node.inputs[0].default_value = a
    else:
        links.new(a, node.inputs[0])
    if b is not None:
        if isinstance(b, float):
            node.inputs[1].default_value = b
        else:
            links.new(b, node.inputs[1])
    return node


def build_family(nodes, links, finish):
    """Devuelve (color, altura, rugosidad_extra, metal_extra) para una familia.

    `altura` alimenta el bump y de ahí sale el normal map, así que color y
    relieve describen la misma superficie: es lo que evita que el normal se lea
    como ruido pegado encima del color.
    """
    family = finish["family"]
    seed = finish["seed"]
    base = rgb(finish["color"])
    dark = tuple(c * 0.62 for c in base[:3]) + (1.0,)
    light = tuple(min(1.0, c * 1.35) for c in base[:3]) + (1.0,)

    if family in ("rawWood", "paintedWood"):
        # Anillos de crecimiento. La distorsión alta y en dos escalas es lo que
        # los saca de "bandas parejas" y los vuelve veta: una tabla real tiene
        # los anillos apretándose y abriéndose a lo largo.
        vector = coords(nodes, links, 1.0, seed)
        rings = wave(nodes, links, vector.outputs["Vector"], 7.0, 7.5, detail=6.0)
        # Nudos y vetas anchas: la variación tonal de tabla a tabla.
        boards = noise(nodes, links, vector.outputs["Vector"], 2.5, detail=4.0)
        fibre = noise(nodes, links, vector.outputs["Vector"], 300.0, detail=4.0)
        color = mix_rgb(nodes, links, rings.outputs["Fac"], dark, base)
        color = mix_rgb(nodes, links, boards.outputs["Fac"], color.outputs[2], light)
        color = mix_rgb(nodes, links, fibre.outputs["Fac"], color.outputs[2], dark)
        pores = voronoi(nodes, links, vector.outputs["Vector"], 150.0, "F1")
        height = math(nodes, links, "MULTIPLY", rings.outputs["Fac"], 0.7)
        height = math(nodes, links, "ADD", height.outputs[0], pores.outputs["Distance"])
        return color.outputs[2], height.outputs[0], 0.06, 0.0

    if family in ("paintedSteel", "plastic"):
        vector = coords(nodes, links, 1.0, seed)
        blotch = noise(nodes, links, vector.outputs["Vector"], 6.0, detail=6.0, roughness=0.6)
        micro = noise(nodes, links, vector.outputs["Vector"], 340.0, detail=2.0)
        color = mix_rgb(nodes, links, blotch.outputs["Fac"], base, dark)
        height = math(nodes, links, "MULTIPLY", micro.outputs["Fac"], 0.25)
        return color.outputs[2], height.outputs[0], 0.05, 0.0

    if family in ("bareSteel", "rustedSteel"):
        vector = coords(nodes, links, 1.0, seed)
        # Grano direccional: el acero laminado tiene marcas en la dirección de
        # laminación, no ruido isótropo.
        brushed = noise(nodes, links, vector.outputs["Vector"], 400.0, detail=2.0, distortion=6.0)
        pit = voronoi(nodes, links, vector.outputs["Vector"], 45.0, "F1")
        rust_mask = ramp(
            nodes, links, pit.outputs["Distance"],
            [(0.0, (1, 1, 1, 1)), (0.45, (0, 0, 0, 1))],
        )
        rust = (0.34, 0.12, 0.05, 1.0)
        color = mix_rgb(nodes, links, brushed.outputs["Fac"], base, light)
        if family == "rustedSteel":
            color = mix_rgb(nodes, links, rust_mask.outputs["Color"], color.outputs[2], rust)
        height = math(nodes, links, "MULTIPLY", pit.outputs["Distance"], 0.5)
        return color.outputs[2], height.outputs[0], 0.08, 0.0

    if family == "concrete":
        vector = coords(nodes, links, 1.0, seed)
        # Árido: piedras embebidas. Voronoi es literalmente eso.
        aggregate = voronoi(nodes, links, vector.outputs["Vector"], 38.0, "F1", 0.85)
        pores = voronoi(nodes, links, vector.outputs["Vector"], 130.0, "F1")
        stain = noise(nodes, links, vector.outputs["Vector"], 4.0, detail=5.0)
        color = mix_rgb(nodes, links, aggregate.outputs["Distance"], dark, base)
        color = mix_rgb(nodes, links, stain.outputs["Fac"], color.outputs[2], dark)
        height = math(nodes, links, "MULTIPLY", aggregate.outputs["Distance"], 0.7)
        height = math(nodes, links, "SUBTRACT", height.outputs[0], pores.outputs["Distance"])
        return color.outputs[2], height.outputs[0], 0.12, 0.0

    if family == "plaster":
        vector = coords(nodes, links, 1.0, seed)
        micro = noise(nodes, links, vector.outputs["Vector"], 260.0, detail=3.0)
        damp = noise(nodes, links, vector.outputs["Vector"], 3.0, detail=6.0)
        color = mix_rgb(nodes, links, damp.outputs["Fac"], base, dark)
        height = math(nodes, links, "MULTIPLY", micro.outputs["Fac"], 0.3)
        return color.outputs[2], height.outputs[0], 0.1, 0.0

    if family == "fabric":
        vector = coords(nodes, links, 1.0, seed)
        # Trama: dos ondas cruzadas. Es lo que hace que el tapizado deje de
        # parecer plastilina.
        warp = wave(nodes, links, vector.outputs["Vector"], 260.0, 0.4, detail=1.0, bands="X")
        weft = wave(nodes, links, vector.outputs["Vector"], 260.0, 0.4, detail=1.0, bands="Y")
        fuzz = noise(nodes, links, vector.outputs["Vector"], 500.0, detail=2.0)
        weave = math(nodes, links, "MULTIPLY", warp.outputs["Fac"], weft.outputs["Fac"])
        blotch = noise(nodes, links, vector.outputs["Vector"], 5.0, detail=5.0)
        color = mix_rgb(nodes, links, blotch.outputs["Fac"], base, dark)
        color = mix_rgb(nodes, links, weave.outputs[0], color.outputs[2], light)
        height = math(nodes, links, "MULTIPLY", weave.outputs[0], 0.8)
        height = math(nodes, links, "ADD", height.outputs[0], fuzz.outputs["Fac"])
        return color.outputs[2], height.outputs[0], 0.2, 0.0

    if family == "cardboard":
        vector = coords(nodes, links, 1.0, seed)
        # Corrugado: ondas anchas en un solo eje.
        flute = wave(nodes, links, vector.outputs["Vector"], 46.0, 0.15, detail=1.0, bands="X")
        fibre = noise(nodes, links, vector.outputs["Vector"], 380.0, detail=3.0)
        color = mix_rgb(nodes, links, fibre.outputs["Fac"], base, dark)
        color = mix_rgb(nodes, links, flute.outputs["Fac"], color.outputs[2], light)
        height = math(nodes, links, "MULTIPLY", flute.outputs["Fac"], 0.55)
        height = math(nodes, links, "ADD", height.outputs[0], fibre.outputs["Fac"])
        return color.outputs[2], height.outputs[0], 0.14, 0.0

    if family == "rubber":
        vector = coords(nodes, links, 1.0, seed)
        micro = noise(nodes, links, vector.outputs["Vector"], 420.0, detail=2.0)
        color = mix_rgb(nodes, links, micro.outputs["Fac"], base, dark)
        height = math(nodes, links, "MULTIPLY", micro.outputs["Fac"], 0.35)
        return color.outputs[2], height.outputs[0], 0.16, 0.0

    # `porcelain` y cualquier familia futura: liso con micrograno.
    vector = coords(nodes, links, 1.0, seed)
    micro = noise(nodes, links, vector.outputs["Vector"], 600.0, detail=2.0)
    color = mix_rgb(nodes, links, micro.outputs["Fac"], base, light)
    height = math(nodes, links, "MULTIPLY", micro.outputs["Fac"], 0.12)
    return color.outputs[2], height.outputs[0], 0.02, 0.0


def build_grime(nodes, links, finish):
    """Máscara de suciedad, 0..1. Dos escalas y ninguna de ellas es ruido fino.

    La mugre real no es parejo: se acumula en manchas grandes y **chorrea hacia
    abajo** desde donde entra el agua. Un ruido isótropo aplicado uniforme es
    exactamente lo que hace ver "textura procedural", que es de lo que veníamos.
    """
    seed = finish["seed"] + 41
    # Manchas: mandan ellas. Son de escala grande a propósito, porque lo que hace
    # que la suciedad se lea como suciedad es que HAYA zonas limpias al lado.
    blotch_vector = coords(nodes, links, 1.0, seed)
    blotch = noise(nodes, links, blotch_vector.outputs["Vector"], 2.2, detail=6.0, roughness=0.6)
    # Chorreado: pocas corridas anchas, estiradas hacia abajo. Con frecuencia
    # alta esto deja de ser suciedad y pasa a ser un peinado vertical parejo que
    # tapa la estructura de la familia.
    streak_vector = coords(nodes, links, 1.0, seed + 7, aspect=(6.0, 0.75))
    streak = noise(nodes, links, streak_vector.outputs["Vector"], 1.0, detail=4.0)

    weighted = math(nodes, links, "MULTIPLY", blotch.outputs["Fac"], 0.68)
    streaked = math(nodes, links, "MULTIPLY", streak.outputs["Fac"], 0.32)
    combined = math(nodes, links, "ADD", weighted.outputs[0], streaked.outputs[0])
    # El umbral es lo que deja superficie limpia: sin él la pieza entera se
    # ensucia por igual y vuelve a leerse pareja.
    shaped = ramp(
        nodes, links, combined.outputs[0],
        [(0.46, (0, 0, 0, 1)), (0.80, (1, 1, 1, 1))],
    )
    return math(nodes, links, "MULTIPLY", shaped.outputs["Color"], finish["grime"])


def build_material(finish):
    material = bpy.data.materials.new(f"tile_{finish['index']}")
    material.use_nodes = True
    tree = material.node_tree
    nodes, links = tree.nodes, tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])

    color_out, height_out, rough_extra, _metal_extra = build_family(nodes, links, finish)

    # La mugre va ENTRE el material y los rayones: un rayón nuevo destapa
    # superficie limpia, así que tiene que pintarse encima de la suciedad.
    grime = build_grime(nodes, links, finish)
    # Y se deposita en lo hundido del material: en el poro del hormigón, en la
    # veta de la madera. Sin este sesgo la suciedad flota sobre la superficie.
    cavity = math(nodes, links, "SUBTRACT", 1.0, height_out)
    cavity = math(nodes, links, "MULTIPLY_ADD", cavity.outputs[0], 0.5)
    cavity.inputs[2].default_value = 0.62
    grime = math(nodes, links, "MULTIPLY", grime.outputs[0], cavity.outputs[0])
    grime.use_clamp = True
    color_out = mix_rgb(
        nodes, links, grime.outputs[0], color_out, rgb(finish["grimeColor"])
    ).outputs[2]

    # Rayones: cortos, densos y en cualquier dirección. Los de antes medían el
    # 91% de la casilla y corrían todos en la misma diagonal.
    vector = coords(nodes, links, 1.0, finish["seed"] + 17)
    scratch_src = voronoi(
        nodes, links, vector.outputs["Vector"], finish["scratchScale"], "DISTANCE_TO_EDGE"
    )
    scratches = ramp(
        nodes, links, scratch_src.outputs["Distance"],
        [(0.0, (1, 1, 1, 1)), (finish["scratchWidth"], (0, 0, 0, 1))],
    )
    scratch_amount = math(nodes, links, "MULTIPLY", scratches.outputs["Color"], finish["wear"])
    # El rayón destapa el material de ABAJO, no metal desnudo: sobre madera es
    # madera clara, sobre cartón es fibra. Ese era el bug que pintaba rayas
    # blancas en todo.
    exposed = rgb(finish["exposedColor"])
    color_final = mix_rgb(nodes, links, scratch_amount.outputs[0], color_out, exposed)
    links.new(color_final.outputs[2], principled.inputs["Base Color"])

    height_total = math(nodes, links, "SUBTRACT", height_out, scratch_amount.outputs[0])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = finish["bump"]
    bump.inputs["Distance"].default_value = 0.06
    links.new(height_total.outputs[0], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], principled.inputs["Normal"])

    roughness = math(nodes, links, "ADD", float(finish["roughness"]), rough_extra)
    # Lo sucio refleja menos: la mugre sube la rugosidad además de teñir.
    grime_rough = math(nodes, links, "MULTIPLY", grime.outputs[0], 0.24)
    roughness = math(nodes, links, "ADD", roughness.outputs[0], grime_rough.outputs[0])
    roughness.use_clamp = True
    links.new(roughness.outputs[0], principled.inputs["Roughness"])
    principled.inputs["Metallic"].default_value = finish["metallic"]
    return material, color_final.outputs[2], roughness, bump


def bake_to(image, plane, bake_type, pass_filter=None):
    material = plane.data.materials[0]
    nodes = material.node_tree.nodes
    target = nodes.new("ShaderNodeTexImage")
    target.image = image
    target.select = True
    nodes.active = target
    kwargs = {"type": bake_type}
    if pass_filter:
        kwargs["pass_filter"] = pass_filter
    bpy.ops.object.bake(**kwargs)
    nodes.remove(target)


def emit_bake(image, plane, source_socket, material, principled):
    """Hornea un socket escalar cualquiera pasándolo por una emisión."""
    tree = material.node_tree
    emission = tree.nodes.new("ShaderNodeEmission")
    output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    tree.links.new(source_socket, emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    bake_to(image, plane, "EMIT")
    tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    tree.nodes.remove(emission)


for finish in SPEC["tiles"]:
    reset()
    plane = make_plane()
    material, color_socket, roughness_node, _bump = build_material(finish)
    plane.data.materials.append(material)
    principled = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")

    albedo = new_image(f"albedo{finish['index']}", is_data=False)
    normal = new_image(f"normal{finish['index']}", is_data=True)
    rough_img = new_image(f"rough{finish['index']}", is_data=True)

    # El albedo va por emisión y NO por `DIFFUSE`: un material metálico no tiene
    # componente difusa, así que hornearlo con DIFFUSE devolvía negro. Con
    # emisión sale el color base tal cual, sea metal o no.
    emit_bake(albedo, plane, color_socket, material, principled)
    bake_to(normal, plane, "NORMAL")
    emit_bake(rough_img, plane, roughness_node.outputs[0], material, principled)

    for image, suffix in ((albedo, "albedo"), (normal, "normal"), (rough_img, "rough")):
        path = os.path.join(OUT_DIR, f"{finish['index']}_{suffix}.png")
        image.filepath_raw = path
        image.file_format = "PNG"
        image.save()
    print(f"BAKE tile {finish['index']} {finish['family']} listo")

print("BAKE done")
