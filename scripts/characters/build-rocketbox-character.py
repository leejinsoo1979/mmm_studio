"""Build a walkthrough character GLB (mesh + idle/walk/run clips) from a Rocketbox avatar.

Sources (MIT, https://github.com/microsoft/Microsoft-Rocketbox):
  Assets/Avatars/Adults/<Name>/Export/<Name>.fbx and its Textures/*.tga
  Assets/Animations/all_animations_max_motextr_static/<m|f>_idle_neutral_01.max.fbx
  Assets/Animations/all_animations_max_motextr_xy/<m|f>_{walk,run}_neutral_01.max.fbx
(save the clips as <m|f>_idle_neutral_01.fbx etc. in one folder)

Needs Blender's Python module and Pillow (`pip install bpy==5.0.1 pillow`, Python 3.11):
  python build-rocketbox-character.py -- <avatar.fbx> <textures_dir> <m|f> <anims_dir> <out.glb> <meta.json>

The clips' root motion is removed (the walkthrough controller moves the body)
and its length is written to meta.json, which feeds WALKTHROUGH_CHARACTERS in
packages/editor/src/components/editor/first-person/locomotion.ts.
"""

import json
import os
import sys

import bpy
from PIL import Image

avatar_fbx, tex_dir, gender, anims_dir, out_glb, meta_json = sys.argv[sys.argv.index('--') + 1:]
work = os.path.join(os.path.dirname(out_glb), '_tex_' + gender)
os.makedirs(work, exist_ok=True)

CLIPS = {
    'idle': f'{gender}_idle_neutral_01',
    'walk': f'{gender}_walk_neutral_01',
    'run': f'{gender}_run_neutral_01',
}
TEX_SIZE = 1024


def fcurves(act):
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out += list(cb.fcurves)
    return out


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30

bpy.ops.import_scene.fbx(filepath=avatar_fbx)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
for o in list(bpy.data.objects):
    if o not in (arm, mesh):
        bpy.data.objects.remove(o, do_unlink=True)
arm.name = 'Avatar'
mesh.name = 'AvatarMesh'
# The avatar import may carry a bind-pose action; clips replace it.
if arm.animation_data:
    arm.animation_data_clear()
arm.animation_data_create()

meta = {'clips': {}}
bpy.context.view_layer.objects.active = arm
for clip, stem in CLIPS.items():
    before_objs = set(bpy.data.objects)
    before_acts = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=os.path.join(anims_dir, stem + '.fbx'))
    new_objs = set(bpy.data.objects) - before_objs
    src_arm = next(o for o in new_objs if o.type == 'ARMATURE')
    act = src_arm.animation_data.action
    start, end = (int(round(v)) for v in act.frame_range)
    duration = (end - start) / bpy.context.scene.render.fps
    distance = 0.0
    for fc in fcurves(act):
        if fc.data_path == 'location' and fc.array_index in (0, 1):
            first = fc.keyframe_points[0].co[1]
            last = fc.keyframe_points[-1].co[1]
            distance += (last - first) ** 2
            # In place: the character controller moves the body instead.
            for k in fc.keyframe_points:
                k.co[1] = first
                k.handle_left[1] = first
                k.handle_right[1] = first
    distance = distance ** 0.5

    # The clip's skeleton rests in a different pose from the avatar's, so its
    # bone-local keys can't be reused: follow its bones in world space and
    # bake that onto the avatar's own skeleton.
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        if pb.name in src_arm.pose.bones:
            c = pb.constraints.new('COPY_TRANSFORMS')
            c.target = src_arm
            c.subtarget = pb.name
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(
        frame_start=start,
        frame_end=end,
        step=1,
        only_selected=False,
        visual_keying=True,
        clear_constraints=True,
        use_current_action=False,
        bake_types={'POSE'},
    )
    bpy.ops.object.mode_set(mode='OBJECT')
    baked = arm.animation_data.action
    baked.name = clip
    slot = arm.animation_data.action_slot
    arm.animation_data.action = None
    meta['clips'][clip] = {
        'duration': round(duration, 4),
        'distance': round(distance, 4),
        'speed': round(distance / duration, 4) if duration else 0,
    }
    track = arm.animation_data.nla_tracks.new()
    track.name = clip
    strip = track.strips.new(clip, start, baked)
    if slot is not None:
        strip.action_slot = slot
    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in set(bpy.data.actions) - before_acts - {baked}:
        bpy.data.actions.remove(a)


def load_image(name, keep_alpha=False):
    src = os.path.join(tex_dir, name + '.tga')
    img = Image.open(src)
    img = img.convert('RGBA' if keep_alpha else 'RGB').resize((TEX_SIZE, TEX_SIZE), Image.LANCZOS)
    ext = '.png' if keep_alpha else '.jpg'
    dst = os.path.join(work, name + ext)
    if keep_alpha:
        img.save(dst, optimize=True)
    else:
        img.save(dst, quality=88, optimize=True)
    return bpy.data.images.load(dst)


code = os.path.basename(os.path.join(tex_dir, os.listdir(tex_dir)[0])).split('_')[0]
for slot in mesh.material_slots:
    mat = slot.material
    part = mat.name.split('_', 1)[1] if '_' in mat.name else mat.name  # body / head / opacity
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.62 if part != 'opacity' else 0.7
    if part == 'opacity':
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = load_image(f'{code}_opacity_color', keep_alpha=True)
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.surface_render_method = 'DITHERED'
        continue
    col = nt.nodes.new('ShaderNodeTexImage')
    col.image = load_image(f'{code}_{part}_color')
    nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
    nrm_tex = nt.nodes.new('ShaderNodeTexImage')
    nrm_tex.image = load_image(f'{code}_{part}_normal')
    nrm_tex.image.colorspace_settings.name = 'Non-Color'
    nrm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nrm_tex.outputs['Color'], nrm.inputs['Color'])
    nt.links.new(nrm.outputs['Normal'], bsdf.inputs['Normal'])

bbox_h = max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices) - min(
    (mesh.matrix_world @ v.co).z for v in mesh.data.vertices
)
meta['height'] = round(bbox_h, 4)
meta['triangles'] = sum(len(p.vertices) - 2 for p in mesh.data.polygons)

bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format='GLB',
    export_animation_mode='NLA_TRACKS',
    export_anim_single_armature=True,
    export_force_sampling=True,
    export_frame_step=1,
    export_image_format='AUTO',
    export_yup=True,
    export_apply=False,
)
meta['bytes'] = os.path.getsize(out_glb)
with open(meta_json, 'w') as f:
    json.dump(meta, f, indent=2)
print('META', json.dumps(meta))
sys.stdout.flush()
os._exit(0)
