"""Build walkthrough character GLBs from the Microsoft Rocketbox avatars.

Every Rocketbox avatar shares one 3ds Max biped skeleton, so the motion is
built once per gender and shared, and each avatar ships only its body:

  anims   <avatar.fbx> <m|f> <anims_dir> <cmu_bvh_dir> <out.glb> <meta.json>
      Locomotion, crouch and jump clips baked onto a reference avatar's
      skeleton (no mesh). Clip lengths and root-motion distances go to
      meta.json, which feeds locomotion.ts.
  emotes  <avatar.fbx> <m|f> <anims_dir> <out.glb> <meta.json>
      The gestures, dances and idles a player plays on a key (EMOTES), baked
      onto the reference avatar's skeleton like the anims (no mesh). Clip
      lengths go to meta.json, which feeds emotes.ts.
  avatar  <avatar.fbx> <textures_dir> <out.glb> <meta.json>
      One avatar's skinned mesh and materials, no clips. Its hip height goes
      to meta.json (clips from another body are scaled to it).

Sources (MIT, https://github.com/microsoft/Microsoft-Rocketbox):
  Assets/Avatars/<group>/<Name>/Export/<Name>.fbx and its Textures/*.tga
  Assets/Animations/all_animations_max_motextr_*/<m|f>_{idle_neutral_01,walk_neutral_01,
    walk_fast_01,run_neutral_01,run_fast_01,crouch_in,crouch_idle,crouch_out}.max.fbx
  Assets/Animations/all_animations_max_motextr_static/<m|f>_<EMOTES stem>.max.fbx
(save them as <m|f>_idle_neutral_01.fbx etc. in one folder)
The jumps are CMU motion capture (http://mocap.cs.cmu.edu, free for any use) in
Bruce Hahne's BVH conversion (data/<subject>/<trial>.bvh of
https://github.com/una-dinosauria/cmu-mocap), retargeted onto the Rocketbox
skeleton: see JUMPS for the trials.

Needs Blender's Python module (with its numpy) and Pillow (`pip install bpy==5.0.1 pillow`, Python 3.11):
  python build-rocketbox-character.py -- <mode> <args...>
build-rocketbox-library.sh runs it over the whole library and compresses the
results (WebP textures, meshopt geometry).
"""

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from PIL import Image, ImageFilter

mode, *args = sys.argv[sys.argv.index('--') + 1:]
if mode == 'anims':
    avatar_fbx, gender, anims_dir, cmu_dir, out_glb, meta_json = args
elif mode == 'emotes':
    avatar_fbx, gender, anims_dir, out_glb, meta_json = args
elif mode == 'avatar':
    avatar_fbx, tex_dir, out_glb, meta_json = args
    gender = ''
else:
    raise SystemExit(f'unknown mode {mode!r}: anims, emotes or avatar')
work = os.path.join(os.path.dirname(out_glb), '_tex_' + os.path.splitext(os.path.basename(out_glb))[0])
os.makedirs(work, exist_ok=True)

CLIPS = {
    'idle': f'{gender}_idle_neutral_01',
    'walk': f'{gender}_walk_neutral_01',
    'walkFast': f'{gender}_walk_fast_01',
    'run': f'{gender}_run_neutral_01',
    'runFast': f'{gender}_run_fast_01',
    'crouchIn': f'{gender}_crouch_in',
    'crouchIdle': f'{gender}_crouch_idle',
    'crouchOut': f'{gender}_crouch_out',
}
# Played on the spot (motion extraction static), by the emote ids of emotes.ts.
EMOTES = {
    'wave': 'wave_01',
    'waveBig': 'wave_02',
    'clap': 'claphands_01',
    'cheer': 'cheer_01',
    'hooray': 'cheer_03',
    'danceCool': 'dancing_cool',
    'danceGroove': 'dancing_neutral',
    'danceSilly': 'dancing_silly',
    'danceHard': 'dancing_aggressive',
    'laugh': 'gestic_laugh_loud',
    'shrug': 'gestic_shrug_01',
    'think': 'gestic_thoughtful_01',
    'present': 'gestic_presentation_right_01',
    'nod': 'gestic_listen_accept_01',
    'headShake': 'gestic_listen_deny_01',
    'talk': 'gestic_talk_excited_01',
    'angry': 'gestic_listen_angry_01',
    'sad': 'gestic_listen_sad_01',
    'stretch': 'idle_stretch_arms_01',
    'yawn': 'idle_yawn_01',
    'lookAround': 'idle_look_around_01',
    'scratchHead': 'idle_scratch_head_01',
    'photo': 'take_picture',
    'knock': 'knock_door',
    'drink': 'drink_drinking',
}
EMOTES = {emote: f'{gender}_{stem}' for emote, stem in EMOTES.items()}
# The face is seen up close in third person: its colour and normals keep the
# source's full 2K. Roughness (and the skin mask with it) changes slowly.
TEX_SIZE = {'head': 2048, 'body': 1024, 'opacity': 1024}
ROUGH_SIZE = {'head': 1024, 'body': 512}


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
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in list(bpy.data.objects):
    if o is not arm and o not in meshes:
        bpy.data.objects.remove(o, do_unlink=True)
if len(meshes) > 1:
    for o in bpy.context.view_layer.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
mesh = meshes[0]
arm.name = 'Avatar'
mesh.name = 'AvatarMesh'
# The children's bipeds are named Bip02: one naming lets every body play the
# same clips (renaming a bone renames its vertex group too).
for bone in arm.data.bones:
    if bone.name.startswith('Bip02 '):
        bone.name = 'Bip01 ' + bone.name[len('Bip02 '):]
# The avatar import may carry a bind-pose action; clips replace it.
if arm.animation_data:
    arm.animation_data_clear()
arm.animation_data_create()

def bake_clips(clips):
    """Bakes the Rocketbox clips onto the avatar's skeleton, one NLA track each."""
    meta['clips'] = {}
    bpy.context.view_layer.objects.active = arm
    for clip, stem in clips.items():
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


# CMU (BVH) joints -> Rocketbox bones, matched by direction: every limb bone
# turns from its rest pose so it points where the source limb points (the
# two skeletons rest in different poses, so their rotations can't be copied),
# and the pelvis, spine and neck match the source's up and left-right axes.
LIMBS = []
for side, cmu in (('L', 'Left'), ('R', 'Right')):
    LIMBS += [
        # (rocketbox bone, rocketbox limb end, cmu joint, cmu limb end)
        (f'Bip01 {side} Clavicle', f'Bip01 {side} UpperArm', f'{cmu}Shoulder', f'{cmu}Arm'),
        (f'Bip01 {side} UpperArm', f'Bip01 {side} Forearm', f'{cmu}Arm', f'{cmu}ForeArm'),
        (f'Bip01 {side} Forearm', f'Bip01 {side} Hand', f'{cmu}ForeArm', f'{cmu}Hand'),
        (f'Bip01 {side} Thigh', f'Bip01 {side} Calf', f'{cmu}UpLeg', f'{cmu}Leg'),
        (f'Bip01 {side} Calf', f'Bip01 {side} Foot', f'{cmu}Leg', f'{cmu}Foot'),
        (f'Bip01 {side} Foot', f'Bip01 {side} Toe0', f'{cmu}Foot', f'{cmu}ToeBase'),
    ]
# (rocketbox bone, its up end, cmu joint, cmu up end, left-right pair: rocketbox, cmu)
TRUNK = [
    ('Bip01 Pelvis', 'Bip01 Neck', 'Hips', 'Neck', ('Bip01 L Thigh', 'Bip01 R Thigh'), ('LeftUpLeg', 'RightUpLeg')),
    ('Bip01 Spine', 'Bip01 Neck', 'LowerBack', 'Neck', ('Bip01 L UpperArm', 'Bip01 R UpperArm'), ('LeftArm', 'RightArm')),
    ('Bip01 Spine1', 'Bip01 Neck', 'Spine', 'Neck', ('Bip01 L UpperArm', 'Bip01 R UpperArm'), ('LeftArm', 'RightArm')),
    ('Bip01 Spine2', 'Bip01 Neck', 'Spine1', 'Neck', ('Bip01 L UpperArm', 'Bip01 R UpperArm'), ('LeftArm', 'RightArm')),
    ('Bip01 Neck', 'Bip01 Head', 'Neck1', 'Head', ('Bip01 L UpperArm', 'Bip01 R UpperArm'), ('LeftArm', 'RightArm')),
]
# End bones keep their pose relative to the bone above them.
FOLLOWERS = {
    'Bip01 Head': 'Bip01 Neck',
    'Bip01 L Hand': 'Bip01 L Forearm',
    'Bip01 R Hand': 'Bip01 R Forearm',
    'Bip01 L Toe0': 'Bip01 L Foot',
    'Bip01 R Toe0': 'Bip01 R Foot',
}

# CMU trials at 120 fps, each cut from the lead-in to the recovery: its
# take-off, top, touch-down and upright frames, and which way it faces — the
# hips for a jump on the spot, the direction of travel for a running one.
JUMPS = {
    # A standing jump: dip, spring up, land softly.
    'jump': {'trial': '16_01', 'start': 109, 'takeoff': 129, 'apex': 153, 'land': 181, 'end': 229, 'stand': 1, 'heading': 'hips'},
    # A running jump: a quick hop out of a run, landing into the next stride.
    'jumpRun': {'trial': '75_01', 'start': 121, 'takeoff': 137, 'apex': 153, 'land': 167, 'end': 189, 'stand': 250, 'heading': 'travel'},
}
if os.environ.get('JUMPS'):
    JUMPS = json.loads(os.environ['JUMPS'])
JUMP_STEP = 4  # 120 fps -> 30 fps
JUMP_MARKS = ('takeoff', 'apex', 'land', 'end')


def rest_head_world(obj, bone_name):
    return obj.matrix_world @ obj.data.bones[bone_name].head_local


def pose_head_world(obj, bone_name):
    return obj.matrix_world @ obj.pose.bones[bone_name].head


def basis(up, side):
    """Rotation whose Z is `up` and X is `side` (made orthogonal)."""
    z = up.normalized()
    x = (side - z * side.dot(z)).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed().to_quaternion()


def heading(direction):
    return math.atan2(direction.y, direction.x)


def retarget_jump(arm, name, spec):
    before = set(bpy.data.objects)
    bvh_path = os.path.join(cmu_dir, spec['trial'] + '.bvh')
    bpy.ops.import_anim.bvh(filepath=bvh_path, global_scale=0.056444, frame_start=1, update_scene_fps=False)
    src = next(o for o in set(bpy.data.objects) - before if o.type == 'ARMATURE')
    bpy.context.scene.render.fps = 30
    up = Vector((0.0, 0.0, 1.0))

    # Face the source the way the avatar faces: its hips at the upright frame,
    # or its run-up for a running jump (the actor ran diagonally).
    avatar_forward = (rest_head_world(arm, 'Bip01 L Thigh') - rest_head_world(arm, 'Bip01 R Thigh')).cross(up)
    if spec['heading'] == 'travel':
        bpy.context.scene.frame_set(spec['start'])
        run_up = pose_head_world(src, 'Hips')
        bpy.context.scene.frame_set(spec['takeoff'])
        source_forward = pose_head_world(src, 'Hips') - run_up
    else:
        bpy.context.scene.frame_set(spec['stand'])
        source_forward = (pose_head_world(src, 'LeftUpLeg') - pose_head_world(src, 'RightUpLeg')).cross(up)
    src.rotation_euler.z += heading(avatar_forward) - heading(source_forward)
    bpy.context.view_layer.update()

    arm_q = arm.matrix_world.to_quaternion()
    bones = arm.data.bones
    rest_world_q = {b.name: arm_q @ b.matrix_local.to_quaternion() for b in bones}
    limb_rest = {
        dst: rest_head_world(arm, dst_end) - rest_head_world(arm, dst) for dst, dst_end, _, _ in LIMBS
    }

    def trunk_now(cmu, cmu_up, cmu_pair):
        return basis(
            pose_head_world(src, cmu_up) - pose_head_world(src, cmu),
            pose_head_world(src, cmu_pair[0]) - pose_head_world(src, cmu_pair[1]),
        )

    # The actor's standing posture is the avatar's upright rest, so the trunk
    # turns relative to it (the actor's neck leans further forward).
    bpy.context.scene.frame_set(spec['stand'])
    trunk_stand = {dst: trunk_now(cmu, cmu_up, cmu_pair) for dst, _, cmu, cmu_up, _, cmu_pair in TRUNK}

    # Hip height: source standing height -> avatar pelvis height.
    src_stand = pose_head_world(src, 'Hips').z
    hip_scale = rest_head_world(arm, 'Bip01 Pelvis').z / src_stand

    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    driven = {m[0] for m in LIMBS} | {t[0] for t in TRUNK} | set(FOLLOWERS)
    order = [b.name for b in bones if b.name in driven]  # parents before children
    out_frame = 1
    for f in range(spec['start'], spec['end'] + 1, JUMP_STEP):
        bpy.context.scene.frame_set(f)
        turn = {}
        for dst, _, cmu, cmu_up, _, cmu_pair in TRUNK:
            turn[dst] = trunk_now(cmu, cmu_up, cmu_pair) @ trunk_stand[dst].inverted()
        for dst, _, cmu, cmu_end in LIMBS:
            turn[dst] = limb_rest[dst].rotation_difference(pose_head_world(src, cmu_end) - pose_head_world(src, cmu))
        for follower, leader in FOLLOWERS.items():
            turn[follower] = turn[leader]

        airborne = spec['takeoff'] <= f <= spec['land']
        desired = {}
        for name in order:
            arm_space_q = arm_q.inverted() @ (turn[name] @ rest_world_q[name])
            bone = bones[name]
            if bone.parent is None:
                head = bone.head_local.copy()
                # In flight the controller lifts the body; only the dips stay.
                lift = 0.0 if airborne else (pose_head_world(src, 'Hips').z - src_stand) * hip_scale
                head += arm.matrix_world.inverted().to_3x3() @ Vector((0.0, 0.0, lift))
            else:
                rest_rel = bone.parent.matrix_local.inverted() @ bone.matrix_local
                head = (desired[bone.parent.name] @ rest_rel).translation
            desired[name] = Matrix.Translation(head) @ arm_space_q.to_matrix().to_4x4()
        for name in order:
            pb = arm.pose.bones[name]
            bone = bones[name]
            if bone.parent is None:
                base = bone.matrix_local
            else:
                base = desired[bone.parent.name] @ (bone.parent.matrix_local.inverted() @ bone.matrix_local)
            pb.matrix_basis = base.inverted() @ desired[name]
            pb.keyframe_insert('rotation_quaternion', frame=out_frame)
            if bone.parent is None:
                pb.keyframe_insert('location', frame=out_frame)
        out_frame += 1
    slot = arm.animation_data.action_slot
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix()
    bpy.data.objects.remove(src, do_unlink=True)
    fps = 120
    marks = {k: round((spec[k] - spec['start']) / fps, 4) for k in JUMP_MARKS}
    return action, slot, marks


def bake_jumps():
    meta['jumps'] = {}
    for jump_name, jump_spec in JUMPS.items():
        jump_action, jump_slot, jump_marks = retarget_jump(arm, jump_name, jump_spec)
        track = arm.animation_data.nla_tracks.new()
        track.name = jump_name
        strip = track.strips.new(jump_name, 1, jump_action)
        if jump_slot is not None:
            strip.action_slot = jump_slot
        meta['jumps'][jump_name] = jump_marks


def texture_file(material, images, kind):
    """The avatar's `<material>_<kind>*.tga`, e.g. m002_body_color.tga or the
    body_color_blue variant, preferring what the FBX material itself links."""
    files = sorted(f for f in os.listdir(tex_dir) if f.lower().endswith('.tga'))
    shipped = {os.path.splitext(f)[0].lower(): os.path.splitext(f)[0] for f in files}
    for name in images:
        # Some materials link a map the avatar doesn't ship.
        if (f'_{kind}' in name.lower() or name.lower().startswith(kind)) and name.lower() in shipped:
            return shipped[name.lower()]
    stem = f'{material}_{kind}'.lower()
    exact = [f for f in files if f.lower() == stem + '.tga']
    loose = [f for f in files if f.lower().startswith(stem)]
    found = exact or loose
    return os.path.splitext(found[0])[0] if found else None


def load_image(name, size, keep_alpha=False, lossless=False):
    """A source texture at `size`², for the export: through a JPEG, or
    through a PNG for cut-outs and where `lossless` (the face's normals,
    whose X and Y JPEG's chroma subsampling bends visibly up close), so
    the library's WebP pass is the only lossy one they see."""
    src = os.path.join(tex_dir, name + '.tga')
    img = Image.open(src)
    img = img.convert('RGBA' if keep_alpha else 'RGB').resize((size, size), Image.LANCZOS)
    png = keep_alpha or lossless
    dst = os.path.join(work, name + ('.png' if png else '.jpg'))
    if png:
        img.save(dst, optimize=True)
    else:
        img.save(dst, quality=90, optimize=True)
    return bpy.data.images.load(dst)


def lab(rgb):
    """CIE Lab (D65) of sRGB colours, an array of 0–255 RGB triples."""
    c = np.asarray(rgb, dtype=np.float32) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def box_mean(values, radius):
    """Each value's mean over the (2·radius + 1)² box round it, the edges held."""
    k = 2 * radius + 1
    summed = np.pad(np.pad(values.astype(np.float64), radius, mode='edge').cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    return (summed[k:, k:] - summed[:-k, k:] - summed[k:, :-k] + summed[:-k, :-k]) / (k * k)


# The cheeks, where the skin's colour is read: midway between each eye and the
# corner of the mouth below it, this far (m) round on the front of the face.
CHEEK_BONES = ('Bip01 Head', 'Bip01 LEye', 'Bip01 REye', 'Bip01 LMouthCorner', 'Bip01 RMouthCorner')
CHEEK_REACH = 0.012
# What any skin's colour is like (Lab): warm, never grey or black. A balaclava's isn't.
SKIN_HUE = (15, 95)
SKIN_CHROMA = 8
SKIN_LIGHTNESS = 10
# The skin mask is worked out at this size; a texel counts as skin as near the
# cheeks' colour as NEAR (Lab, lightness counting half: Rocketbox paints its
# shading in), not at all from FAR, and only where it is smooth (painted hair
# and cloth weave vary from texel to texel).
MASK_SIZE = 1024
NEAR, FAR = 10, 22
SMOOTH, ROUGH = 3, 7
SKIN_PARTS = ('head', 'body')


def skin_colour(color_name, head_slot):
    """The skin's colour (Lab) on the head's colour map, read off its cheeks
    by the face's bones; None where the head lacks them or isn't bare there."""
    bones = arm.data.bones
    if not all(name in bones for name in CHEEK_BONES):
        return None
    at = {name: arm.matrix_world @ bones[name].head_local for name in CHEEK_BONES}
    front = (at['Bip01 LEye'] + at['Bip01 REye']) / 2 - at['Bip01 Head']
    front.normalize()
    cheeks = [(at[f'Bip01 {side}Eye'] + at[f'Bip01 {side}MouthCorner']) / 2 for side in 'LR']
    image = np.asarray(Image.open(os.path.join(tex_dir, color_name + '.tga')).convert('RGB'))
    height, width = image.shape[:2]
    data = mesh.data
    uvs = data.uv_layers.active.data
    turn = mesh.matrix_world.to_3x3()
    samples = []
    for poly in data.polygons:
        if poly.material_index != head_slot or (turn @ poly.normal).normalized().dot(front) < 0.5:
            continue
        for loop in poly.loop_indices:
            point = mesh.matrix_world @ data.vertices[data.loops[loop].vertex_index].co
            for cheek in cheeks:
                off = point - cheek
                if (off - front * off.dot(front)).length < CHEEK_REACH and off.dot(front) > -CHEEK_REACH:
                    u, v = uvs[loop].uv
                    x = min(width - 1, max(0, int(u % 1 * width)))
                    y = min(height - 1, max(0, int((1 - v % 1) * height)))
                    samples.append(image[y, x])
    if len(samples) < 6:
        return None
    colour = np.median(lab(np.array(samples)), axis=0)
    hue = math.degrees(math.atan2(colour[2], colour[1]))
    bare = (
        SKIN_HUE[0] <= hue <= SKIN_HUE[1]
        and math.hypot(colour[1], colour[2]) >= SKIN_CHROMA
        and colour[0] >= SKIN_LIGHTNESS
    )
    print('SKIN', [round(float(c), 1) for c in colour], 'from', len(samples), 'bare' if bare else 'not skin')
    return colour if bare else None


def skin_mask(color_name, skin, size):
    """How much each texel of a colour map is bare skin (an L image, size²)."""
    image = Image.open(os.path.join(tex_dir, color_name + '.tga')).convert('RGB')
    colours = lab(np.asarray(image.resize((MASK_SIZE, MASK_SIZE), Image.LANCZOS)))
    off = colours - skin
    distance = np.sqrt((off[..., 0] * 0.5) ** 2 + off[..., 1] ** 2 + off[..., 2] ** 2)
    t = np.clip((FAR - distance) / (FAR - NEAR), 0, 1)
    near = t * t * (3 - 2 * t)
    lightness = colours[..., 0]
    spread = np.sqrt(np.maximum(box_mean(lightness**2, 2) - box_mean(lightness, 2) ** 2, 0))
    smooth = np.clip((ROUGH - spread) / (ROUGH - SMOOTH), 0, 1)
    mask = Image.fromarray((np.clip(box_mean(near * smooth, 1), 0, 1) * 255).astype(np.uint8))
    # Freckles and pores filled in, specks dropped.
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(3))
    return mask.filter(ImageFilter.GaussianBlur(1.5)).resize((size, size), Image.LANCZOS)


def roughness_image(name, size, skin=None):
    """glTF metallic-roughness texture from a Rocketbox specular map.

    The specular map is dark on dry skin and cloth, brighter on lips and
    brightest on the wet eyes; roughness follows it inversely (G channel),
    metal is none (B). R, which glTF leaves unused, carries `skin` (an L
    image): how much each texel is bare skin, for skin shading to go by.
    Data: saved lossless (see load_image).
    """
    spec = Image.open(os.path.join(tex_dir, name + '.tga')).convert('L').resize((size, size), Image.LANCZOS)
    rough = spec.point(lambda v: round(255 * (0.84 - 0.66 * min(1.0, v / 150))))
    black = Image.new('L', (size, size), 0)
    img = Image.merge('RGB', (skin or black, rough, black))
    dst = os.path.join(work, name + '_roughness.png')
    img.save(dst, optimize=True)
    image = bpy.data.images.load(dst)
    image.colorspace_settings.name = 'Non-Color'
    return image


def dress():
    """PBR materials from each Rocketbox material's color, normal and specular maps."""
    slots = []
    for index, slot in enumerate(mesh.material_slots):
        mat = slot.material
        if mat is None:
            continue
        nt = mat.node_tree
        linked = [
            os.path.splitext(os.path.basename(n.image.filepath))[0]
            for n in (nt.nodes if nt else [])
            if n.type == 'TEX_IMAGE' and n.image
        ]
        part = mat.name.split('_', 1)[1].lower() if '_' in mat.name else ''  # body / head / opacity / …
        maps = {kind: texture_file(mat.name, linked, kind) for kind in ('color', 'normal', 'specular')}
        slots.append((index, mat, part, maps))
    head = next(((index, maps) for index, _, part, maps in slots if part == 'head' and maps['color']), None)
    skin = skin_colour(head[1]['color'], head[0]) if head else None
    for _, mat, part, maps in slots:
        color, normal, specular = maps['color'], maps['normal'], maps['specular']
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 0.62
        size = TEX_SIZE.get(part, TEX_SIZE['body'])
        cutout = part.startswith('opacity')
        if color:
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = load_image(color, size, keep_alpha=cutout)
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            if cutout:
                # Hair and lashes: alpha cards.
                nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
                mat.surface_render_method = 'DITHERED'
                bsdf.inputs['Roughness'].default_value = 0.7
                continue
        if normal:
            nrm_tex = nt.nodes.new('ShaderNodeTexImage')
            nrm_tex.image = load_image(normal, size, lossless=part == 'head')
            nrm_tex.image.colorspace_settings.name = 'Non-Color'
            nrm = nt.nodes.new('ShaderNodeNormalMap')
            nt.links.new(nrm_tex.outputs['Color'], nrm.inputs['Color'])
            nt.links.new(nrm.outputs['Normal'], bsdf.inputs['Normal'])
        if specular:
            rough_size = ROUGH_SIZE.get(part, ROUGH_SIZE['body'])
            bare = skin_mask(color, skin, rough_size) if skin is not None and color and part in SKIN_PARTS else None
            rough_tex = nt.nodes.new('ShaderNodeTexImage')
            rough_tex.image = roughness_image(specular, rough_size, bare)
            split = nt.nodes.new('ShaderNodeSeparateColor')
            nt.links.new(rough_tex.outputs['Color'], split.inputs['Color'])
            nt.links.new(split.outputs['Green'], bsdf.inputs['Roughness'])
            nt.links.new(split.outputs['Blue'], bsdf.inputs['Metallic'])
        if part == 'head':
            # A warm grazing sheen: the soft glow light picks up on skin edges.
            # (glTF carries the tint as the sheen's strength, so it stays dim.)
            bsdf.inputs['Sheen Weight'].default_value = 1.0
            bsdf.inputs['Sheen Roughness'].default_value = 0.45
            bsdf.inputs['Sheen Tint'].default_value = (0.3, 0.17, 0.14, 1.0)


meta = {}
if mode in ('anims', 'emotes'):
    bake_clips(CLIPS if mode == 'anims' else EMOTES)
    if mode == 'anims':
        bake_jumps()
    # The clips drive any Rocketbox body by bone name: ship the skeleton only.
    bpy.data.objects.remove(mesh, do_unlink=True)
else:
    dress()
    zs = [(mesh.matrix_world @ v.co).z for v in mesh.data.vertices]
    meta['height'] = round(max(zs) - min(zs), 4)
    meta['hip'] = round((arm.matrix_world @ arm.data.bones['Bip01 Pelvis'].head_local).z - min(zs), 4)
    meta['triangles'] = sum(len(p.vertices) - 2 for p in mesh.data.polygons)

bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format='GLB',
    export_animations=mode != 'avatar',
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
