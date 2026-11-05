"""User-authorized deterministic sprite sizing, padding and anchor alignment.

Generated pixels stay unchanged apart from proportional Lanczos resampling.
High-resolution originals are retained on D: and never rewritten here.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--original', required=True)
parser.add_argument('--name', required=True)
parser.add_argument('--kind', required=True)
parser.add_argument('--width', type=int, required=True)
parser.add_argument('--height', type=int, required=True)
parser.add_argument('--target-height', type=int, default=1237)
args = parser.parse_args()
if not args.name or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in args.name):
    raise ValueError('Unsafe asset name')
root = Path(__file__).resolve().parent.parent
original = Path(args.original)
export_dir = original.parent / 'exports'
project_dir = root / 'assets' / 'world'
export_dir.mkdir(parents=True, exist_ok=True)
project_dir.mkdir(parents=True, exist_ok=True)
im = Image.open(original).convert('RGBA')
original_size = im.size
w, h = args.width, args.height
if args.kind == 'scene':
    if abs(im.width / im.height - w / h) > 0.15:
        raise ValueError(f'Scene aspect ratio needs review: {im.size}')
    # A proportional cover crop of less than 1% is normally all that is needed.
    ratio = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * ratio), round(im.height * ratio)), Image.Resampling.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    output = im.crop((x, y, x + w, y + h)).convert('RGB')
    anchor = None
else:
    alpha = im.getchannel('A')
    if alpha.getextrema()[0] == 255:
        raise ValueError('Expected actual alpha transparency; source retained for regeneration')
    bbox = alpha.getbbox()
    if not bbox:
        raise ValueError('Empty sprite')
    sprite = im.crop(bbox)
    padding = 16 if args.kind != 'character' and w >= 256 else 4 if w <= 96 else 0
    limit_w, limit_h = w - 2 * padding, h - 2 * padding
    if args.kind == 'character':
        limit_h = min(limit_h, args.target_height)
    ratio = min(limit_w / sprite.width, limit_h / sprite.height)
    sprite = sprite.resize((max(1, round(sprite.width * ratio)), max(1, round(sprite.height * ratio))), Image.Resampling.LANCZOS)
    output = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    x = (w - sprite.width) // 2
    bottom = h if args.kind == 'character' else h - padding
    y = bottom - sprite.height if args.kind in ('character', 'plant', 'tile', 'prop') else (h - sprite.height) // 2
    output.alpha_composite(sprite, (x, y))
    anchor = [w / 2, bottom] if args.kind in ('character', 'plant', 'tile', 'prop') else [w / 2, h / 2]

buffer = io.BytesIO()
output.save(buffer, format='PNG', optimize=True)
data = buffer.getvalue()
digest = hashlib.sha256(data).hexdigest()

def save_unique(folder, filename, content):
    target = folder / filename
    suffix = 2
    while target.exists() and target.read_bytes() != content:
        target = folder / f'{Path(filename).stem}-v{suffix}.png'
        suffix += 1
    if not target.exists():
        target.write_bytes(content)
    if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        raise ValueError('Export hash mismatch')
    return target

saved = save_unique(export_dir, args.name + '.png', data)
project = save_unique(project_dir, args.name + '.png', data)
meta = {'name': args.name, 'kind': args.kind, 'original': str(original),
        'originalSize': original_size, 'size': [w, h], 'anchorPixels': anchor,
        'anchorNormalized': [anchor[0] / w, anchor[1] / h] if anchor else None,
        'alphaBounds': output.getchannel('A').getbbox() if output.mode == 'RGBA' else None,
        'sha256': digest, 'export': str(saved), 'project': str(project)}
(export_dir / (args.name + '.json')).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
(project_dir / (args.name + '.json')).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'name': args.name, 'size': [w, h], 'project': str(project)}, ensure_ascii=False))
