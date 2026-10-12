"""Swaps some images of a binary glTF for another's same-named ones, every other byte (geometry
included) kept as it was. The Rocketbox library's head normal and roughness maps were put into
its previously built GLBs this way (see build-rocketbox-library.sh):

  python3 -I swap-glb-images.py <base.glb> <donor.glb> <out.glb> <regex>

Images whose name matches <regex> come from <donor>. The BIN chunk is laid out anew (4-byte
aligned), every bufferView and EXT_meshopt_compression offset into it moved with it.
"""
import json
import re
import struct
import sys

base_path, donor_path, out_path, pattern = sys.argv[1:5]
wanted = re.compile(pattern)


def read(path):
    data = open(path, 'rb').read()
    magic, version, _ = struct.unpack('<4sII', data[:12])
    assert magic == b'glTF' and version == 2, f'{path}: not a binary glTF 2'
    json_len, json_type = struct.unpack('<I4s', data[12:20])
    assert json_type == b'JSON'
    doc = json.loads(data[20:20 + json_len])
    at = 20 + json_len
    bin_len, bin_type = struct.unpack('<I4s', data[at:at + 8])
    assert bin_type == b'BIN\x00'
    return doc, data[at + 8:at + 8 + bin_len]


def image_bytes(doc, blob):
    out = {}
    for image in doc['images']:
        view = doc['bufferViews'][image['bufferView']]
        assert view['buffer'] == 0 and 'extensions' not in view
        start = view.get('byteOffset', 0)
        out[image['name']] = blob[start:start + view['byteLength']]
    return out


doc, blob = read(base_path)
donor_doc, donor_blob = read(donor_path)
donor_images = image_bytes(donor_doc, donor_blob)
replace = {}  # bufferView index -> new bytes
for image in doc['images']:
    if wanted.search(image['name']):
        replace[image['bufferView']] = donor_images[image['name']]

# Every region of the BIN buffer: a plain bufferView's bytes or a meshopt view's compressed bytes.
regions = []
for index, view in enumerate(doc['bufferViews']):
    if view['buffer'] == 0:
        regions.append((view.get('byteOffset', 0), view['byteLength'], view, None, index))
    ext = view.get('extensions', {}).get('EXT_meshopt_compression')
    if ext and ext['buffer'] == 0:
        regions.append((ext.get('byteOffset', 0), ext['byteLength'], view, ext, index))
regions.sort(key=lambda r: r[0])
out = bytearray()
for offset, length, view, ext, index in regions:
    data = blob[offset:offset + length]
    if ext is None and index in replace:
        data = replace[index]
    out += b'\x00' * (-len(out) % 4)
    if ext is None:
        view['byteOffset'] = len(out)
        view['byteLength'] = len(data)
    else:
        ext['byteOffset'] = len(out)
    out += data
out += b'\x00' * (-len(out) % 4)
doc['buffers'][0]['byteLength'] = len(out)
text = json.dumps(doc, separators=(',', ':')).encode()
text += b' ' * (-len(text) % 4)
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(text) + 8 + len(out))
glb += struct.pack('<I4s', len(text), b'JSON') + text + struct.pack('<I4s', len(out), b'BIN\x00') + bytes(out)
open(out_path, 'wb').write(glb)
print(out_path, len(glb), 'swapped', len(replace))
