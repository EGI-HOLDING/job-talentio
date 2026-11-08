"""Package image-gen PNG assets for the web; preserve artwork and alpha pixels.

Only transparent canvas margins are trimmed. No mockup extraction, background
segmentation, repainting, or character changes are performed here.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'apps/web/public/images/hr-onboarding/generated'
OUTPUT = ROOT / 'output/hr-assistant'
OUTPUT.mkdir(parents=True, exist_ok=True)
records = []
files = sorted(path for path in ASSETS.glob('*.png') if not path.name.endswith('.browser.png'))
for source in files:
    image = Image.open(source).convert('RGBA')
    alpha = image.getchannel('A')
    assert alpha.getextrema()[0] == 0, f'{source.name} lacks a transparent background'
    bbox = alpha.point(lambda a: 255 if a > 32 else 0).getbbox()
    assert bbox, f'{source.name} is empty'
    # Include the existing antialiased edge around the solid illustration.
    bbox = (max(0,bbox[0]-3),max(0,bbox[1]-3),min(image.width,bbox[2]+3),min(image.height,bbox[3]+3))
    web = image.crop(bbox)
    # Export at up to twice the largest rendered size; keep the generated PNG
    # as the source and preserve alpha in the browser asset.
    name = source.stem
    if name.startswith('logo-'):
        limit = (440, 190)
    elif name.startswith('candidate-'):
        limit = (360, 360)
    elif name.startswith('tara-chat-'):
        limit = (390, 410)
    elif name == 'tara-interviewer':
        limit = (620, 620)
    elif name.startswith('arrow-'):
        limit = (1070, 580)
    elif name == 'cv-sheet':
        limit = (140, 180)
    elif name == 'cv-stack':
        limit = (390, 340)
    elif name == 'talentio-tray':
        limit = (800, 410)
    elif name == 'upload-cloud':
        limit = (200, 180)
    else:
        limit = (1100, 1450)
    web.thumbnail(limit, Image.Resampling.LANCZOS)
    web.save(source.with_suffix('.webp'), lossless=True, quality=100, method=4)
    # Keep the original square canvas for tiny portraits. Chrome introduces
    # alpha speckles when cover-scaling tightly cropped transparent portraits.
    if name.startswith(('tara-chat-', 'candidate-')):
        portrait = image.copy()
        portrait.thumbnail((420, 420), Image.Resampling.LANCZOS)
        portrait.save(source.with_name(name + '.browser.png'), optimize=True)
    records.append({'name':source.stem,'generator':'built-in image-gen','png':source.name,'webp':source.with_suffix('.webp').name,'originalSize':list(image.size),'webSize':list(web.size),'trimmedTransparentBounds':bbox,'webBytes':source.with_suffix('.webp').stat().st_size})
    if name.startswith(('tara-chat-', 'candidate-')):
        records[-1]['browserPng'] = name + '.browser.png'

(ASSETS / 'assets.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
columns=5
sheet=Image.new('RGB',(columns*280,((len(files)+columns-1)//columns)*300),'#f4f0ff')
draw=ImageDraw.Draw(sheet)
for i,source in enumerate(files):
    image=Image.open(source.with_suffix('.webp')).convert('RGBA')
    image.thumbnail((245,245))
    x=(i%columns)*280+(280-image.width)//2
    y=(i//columns)*300+20
    sheet.paste(image,(x,y),image)
    draw.text(((i%columns)*280+15,(i//columns)*300+273),source.stem,fill='#201633')
sheet.save(OUTPUT / 'generated-assets-review.jpg',quality=94)
print(json.dumps({'assets':len(records),'webBytes':sum(r['webBytes'] for r in records),'review':str(OUTPUT/'generated-assets-review.jpg')}))
