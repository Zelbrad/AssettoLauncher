# Dev tool: builds resources/data/rally-game.json, the texts Assetto Corsa Rally
# shows for its released stages and cars, in every language both the game and the
# launcher have:
#   stages  in-game stage names ("La Bollène-Vésubie - Turini")
#   groups  stage group names and descriptions ("Col de Turini", "Discover the beautiful roads…")
#   cars    each car's description and the name of its default livery ("Erreffe Team 2025")
# They come from the game's Localization/Game/<lang>/Game.locres inside
# acr/Content/Paks/pakchunk0-Windows.pak. That pak is Oodle-compressed, so this
# needs the ooz decompressor (GPL), on this computer only; the launcher only ships
# the JSON:  py -m pip install pyooz
# It also exports each stage variant's map (the whole stage, the part driven in red,
# start arrow and finish flag) from the game's UI textures (IoStore containers, also
# Oodle) into resources/img/rally/stages/<stage id>.png, cropped to the drawing, and a
# small thick-lined copy for Quick Drive's buttons, <stage id>-chip.png; the JSON lists
# them under "media".
# Run after a Rally update, then commit the JSON (launchers fetch it from GitHub)
# and the pictures:
#   py -m pip install pyooz pillow
#   py tools/rally-data.py ["<Rally folder>"]
import json, os, re, struct, sys, datetime
import ooz
from PIL import Image, ImageChops, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'resources', 'data', 'rally-game.json')
LANGS = ['en', 'es', 'fr', 'de', 'it']

# Save-style stage group -> (locres stage key, locres group key, description key, the
# locres' word for "Cut" variants; Col de Turini's Cut1-3 are its SHORT1-3).
GROUPS = {
    'AlsaceS2Munster': ('MUNSTER', 'TRACK_STAGE_ALSACE_MUNSTER', 'GROUP_MUNSTER_DESC', None),
    'AlsaceS4Saverne': ('SAVERNE', 'TRACK_STAGE_ALSACE_SAVERNE', 'GROUP_SAVERNE_DESC', None),
    'GreeceS3Elatia': ('ELATIA', 'TRACK_STAGE_GREECE_ELATIA', 'GROUP_ELATIA_DESC', None),
    'GreeceS4Loutraki': ('LOUTRAKI', 'TRACK_STAGE_GREECE_LOUTRAKI', 'GROUP_LOUTRAKI_DESC', None),
    'LivignoTestTrack01': ('LIVIGNOTESTTRACK', 'TRACK_TEST_LIVIGNO_TRACK01', 'GROUP_LIVIGNO_DESC', None),
    'MonteCarloS1Bollene': ('COLDETURINI', 'TRACK_STAGE_MONTECARLO_COLDETURINI', 'GROUP_BOLLENE_DESC', 'SHORT'),
    'MonteCarloS2Sisteron': ('SISTERON', 'TRACK_STAGE_MONTECARLO_SISTERON', 'GROUP_SISTERON_DESC', None),
    'WelesS3HafrenNorth': ('HAFRENNORTH', 'TRACK_STAGE_WALES_HAFRENNORTH', 'GROUP_HAFREN_NORTH_DESC', None),
    'WelesS4HafrenSouth': ('HAFRENSOUTH', 'TRACK_STAGE_WALES_HAFRENSOUTH', 'GROUP_HAFREN_SOUTH_DESC', None),
}
VARIANTS = {
    'AlsaceS2Munster': ['Full', 'Short1', 'Short2'], 'AlsaceS4Saverne': ['Full', 'Short1'],
    'GreeceS3Elatia': ['Full', 'Cut1', 'Cut2'], 'GreeceS4Loutraki': ['Full', 'Cut1', 'Cut2'],
    'LivignoTestTrack01': ['Full'],
    'MonteCarloS1Bollene': ['Full', 'Cut1', 'Cut2', 'Cut3'], 'MonteCarloS2Sisteron': ['Full', 'Cut1', 'Cut2'],
    'WelesS3HafrenNorth': ['Full', 'Cut1', 'Cut2'], 'WelesS4HafrenSouth': ['Full'],
}
# Launcher car id -> (default livery key, description key).
CARS = {
    'AlfaRomeoGTA1300': ('LIVERY_GIULIAGTA1300_1', 'GROUP_GIULIAGTA1300_DESC'),
    'AlpineA110': ('LIVERY_A110_1', 'GROUP_A110_DESC'),
    'AudiQuattroGr4': ('LIVERY_QUATTRO_GR4_1', 'GROUP_QUATTROGR4_DESC'),
    'CitroenXsaraWRC': ('LIVERY_XSARAWRC_1', 'GROUP_XSARAWRC_DESC'),
    'Fiat124Abarth': ('LIVERY_124ABARTH_1', 'GROUP_124ABARTH_DESC'),
    'Fiat131Abarth': ('LIVERY_131ABARTH_1', 'GROUP_131ABARTH_DESC'),
    'Hyundaii20NRally2': ('LIVERY_I20RALLY2_1', 'GROUP_I20RALLY2_DESC'),
    'LanciaDeltaIntegraleEvo': ('LIVERY_DELTAINTEGRALEEVO_1', 'GROUP_DELTAINTEGRALEEVO_DESC'),
    'LanciaFulviaHF': ('LIVERY_FULVIAHF_1', 'GROUP_FULVIACOUPEHF_DESC'),
    'LanciaRally037Evo2': ('LIVERY_RALLY037EVO2_1', 'GROUP_RALLY037EVO2_DESC'),
    'LanciaStratosHF': ('LIVERY_STRATOSHF_1', 'GROUP_STRATOSHF_DESC'),
    'MiniCooperS1275': ('LIVERY_COOPERS_1', 'GROUP_MINI_COOPERS_DESC'),
    'Peugeot206': ('LIVERY_206_WRC_1', 'GROUP_206WRC_DESC'),
    'Peugeot208Rally4': ('LIVERY_208RALLY4_1', 'GROUP_208RALLY4_DESC'),
    'Peugeot306IIMaxiKitCar': ('LIVERY_306IIMAXI_1', 'GROUP_306MAXI_DESC'),
    'SkodaFabiaRSRally2': ('LIVERY_FABIARSRALLY2_1', 'GROUP_FABIARSR2_DESC'),
    'SubaruImprezaS3': ('LIVERY_IMPREZA_S3_1', 'GROUP_IMPREZAS3_DESC'),
    'VWPoloGTIR5': ('LIVERY_POLO_GTI_R5_1', 'GROUP_POLOGTIR5_DESC'),
}


# Stage id -> its map under acr/Content/Data/UITextures/Tracks/Tracks/. The game
# names these files freely, so each is listed.
MEDIA_DIR = 'Data/UITextures/Tracks/Tracks/'
def _variants(prefix, fmt):
    return {f'{prefix}{v}{d}': fmt(v, d) for v in ('Cut1', 'Cut2', 'Cut3') for d in ('Forward', 'Reverse')}
MEDIA = {
    'AlsaceS2MunsterFullForward': 'RallydeAlcace/Munster/T_MunsterS1FullForward',
    'AlsaceS2MunsterFullReverse': 'RallydeAlcace/Munster/T_MunsterS1FullReverse',
    'AlsaceS2MunsterShort1Forward': 'RallydeAlcace/Munster/T_MunsterS2Cut1Forward',
    'AlsaceS2MunsterShort1Reverse': 'RallydeAlcace/Munster/T_MunsterS2Cut1Reverse',
    'AlsaceS2MunsterShort2Forward': 'RallydeAlcace/Munster/T_MunsterS3Cut2Forward',
    'AlsaceS2MunsterShort2Reverse': 'RallydeAlcace/Munster/T_MunsterS3Cut2Reverse',
    'AlsaceS4SaverneFullForward': 'RallydeAlcace/Saverne/T_SaverneS4FullForward',
    'AlsaceS4SaverneFullReverse': 'RallydeAlcace/Saverne/T_SaverneS4FullReverse',
    'AlsaceS4SaverneShort1Forward': 'RallydeAlcace/Saverne/T_SaverneS4Cut1Forward',
    'AlsaceS4SaverneShort1Reverse': 'RallydeAlcace/Saverne/T_SaverneS4Cut1Reverse',
    'GreeceS3ElatiaFullForward': 'Greece/S3Elatia/T_S3FullForward',
    'GreeceS3ElatiaFullReverse': 'Greece/S3Elatia/T_S3FullReverse',
    'GreeceS3ElatiaCut1Forward': 'Greece/S3Elatia/T_S3Cut1Forward',
    'GreeceS3ElatiaCut1Reverse': 'Greece/S3Elatia/T_S3Cut1Reverse',
    'GreeceS3ElatiaCut2Forward': 'Greece/S3Elatia/T_S3Cut2Forward',
    'GreeceS3ElatiaCut2Reverse': 'Greece/S3Elatia/T_S3Cut2Reverse',
    'GreeceS4LoutrakiFullForward': 'Greece/S4Loutraki/T_S4_Loutraki_FullForward',
    'GreeceS4LoutrakiFullReverse': 'Greece/S4Loutraki/T_S4_Loutraki_FulReverse',
    'GreeceS4LoutrakiCut1Forward': 'Greece/S4Loutraki/T_S4_Cut1_Forward',
    'GreeceS4LoutrakiCut1Reverse': 'Greece/S4Loutraki/T_S4_Cut1_Reverse',
    'GreeceS4LoutrakiCut2Forward': 'Greece/S4Loutraki/T_S4_Cut2_Forward',
    'GreeceS4LoutrakiCut2Reverse': 'Greece/S4Loutraki/T_S4_Cut2_Reverse',
    'LivignoTestTrack01FullForward': 'Livigno/T_LivignoFullForward',
    'LivignoTestTrack01FullReverse': 'Livigno/T_LivignoFullReverse',
    'MonteCarloS1BolleneFullForward': 'MonteCarlo/T_MonteCarloS1FullForward',
    'MonteCarloS1BolleneFullReverse': 'MonteCarlo/T_MonteCarloS1FullReverse',
    **_variants('MonteCarloS1Bollene', lambda v, d: f'MonteCarlo/T_MonteCarloS1{v}{d}'),
    'MonteCarloS2SisteronFullForward': 'MonteCarlo/S2/T_MonteCarloS2Forward',
    'MonteCarloS2SisteronFullReverse': 'MonteCarlo/S2/T_MonteCarloS2Reverse',
    **{k: v for k, v in _variants('MonteCarloS2Sisteron', lambda v, d: f'MonteCarlo/S2/T_MonteCarloS2{v}{d}').items() if 'Cut3' not in k},
    'WelesS3HafrenNorthFullForward': 'Wales/HafrenNorth/T_HafrenNorthFullForward',
    'WelesS3HafrenNorthFullReverse': 'Wales/HafrenNorth/T_HafrenNorthFullReverse',
    'WelesS3HafrenNorthCut1Forward': 'Wales/HafrenNorth/T_HafrenNorthCut1',
    'WelesS3HafrenNorthCut1Reverse': 'Wales/HafrenNorth/T_HafrenNorthCut1Reverse',
    'WelesS3HafrenNorthCut2Forward': 'Wales/HafrenNorth/T_HafrenNorthCut2',
    'WelesS3HafrenNorthCut2Reverse': 'Wales/HafrenNorth/T_HafrenNorthCut2Reverse',
    'WelesS4HafrenSouthFullForward': 'Wales/T_HafrenSouthS4',
    'WelesS4HafrenSouthFullReverse': 'Wales/T_HafrenSouthS4Reverse',
}
MEDIA_OUT = os.path.join(ROOT, 'resources', 'img', 'rally', 'stages')
MAP_SIZE = 240  # px; the game's are 800
CHIP_SIZE = (68, 52)  # Quick Drive's 34x26 stage button picture, twice for sharp screens
CHIP_GROW = 15  # px of the game's 800 a chip's lines are widened to


class IoStore:
    """An unencrypted IoStore container (.utoc + .ucas): .paths {path: toc index}, .read(index)."""
    def __init__(self, utoc):
        b = open(utoc, 'rb').read()
        hs, n, nblocks, bsize, nmeth, mlen, self.block_size, dsize, nparts = struct.unpack_from('<9I', b, 20)
        flags, = struct.unpack_from('<B', b, 80)
        nseeds, = struct.unpack_from('<I', b, 84)
        self.part_size, = struct.unpack_from('<Q', b, 88)
        nnohash, = struct.unpack_from('<I', b, 96)
        o = hs + 12 * n
        self.offlen = [(int.from_bytes(b[o + 10 * i:o + 10 * i + 5], 'big'), int.from_bytes(b[o + 10 * i + 5:o + 10 * i + 10], 'big')) for i in range(n)]
        o += 10 * n + 4 * nseeds + 4 * nnohash
        self.blocks = [(int.from_bytes(b[o + bsize * i:o + bsize * i + 5], 'little'), int.from_bytes(b[o + bsize * i + 5:o + bsize * i + 8], 'little'),
                        int.from_bytes(b[o + bsize * i + 8:o + bsize * i + 11], 'little'), b[o + bsize * i + 11]) for i in range(nblocks)]
        o += bsize * nblocks + mlen * nmeth
        if flags & 4:
            ns, = struct.unpack_from('<I', b, o); o += 4 + 2 * ns + 20 * nblocks
        self.paths = self._index(b, o) if flags & 8 and dsize and not flags & 2 else {}
        self.ucas = [utoc[:-5] + ('.ucas' if p == 0 else f'_s{p}.ucas') for p in range(max(nparts, 1))]

    @staticmethod
    def _index(b, o):
        p = [o]
        def u32():
            v, = struct.unpack_from('<I', b, p[0]); p[0] += 4; return v
        def text():
            s, p[0] = fstring(b, p[0]); return s
        mount = text()
        dirs = [(u32(), u32(), u32(), u32()) for _ in range(u32())]
        files = [(u32(), u32(), u32()) for _ in range(u32())]
        names = [text() for _ in range(u32())]
        NONE, out, stack = 0xFFFFFFFF, {}, ([(0, mount)] if dirs else [])
        while stack:
            d, base = stack.pop()
            while d != NONE:
                path = base if dirs[d][0] == NONE else f'{base}{names[dirs[d][0]]}/'
                f = dirs[d][3]
                while f != NONE:
                    out[path + names[files[f][0]]] = files[f][2]; f = files[f][1]
                if dirs[d][1] != NONE: stack.append((dirs[d][1], path))
                d = dirs[d][2]
        return out

    def read(self, index):
        off, length = self.offlen[index]
        first, last = off // self.block_size, (off + length - 1) // self.block_size
        out = bytearray()
        for boff, csize, usize, method in self.blocks[first:last + 1]:
            part, at = (boff // self.part_size, boff % self.part_size) if self.part_size else (0, boff)
            with open(self.ucas[part], 'rb') as f:
                f.seek(at); raw = f.read(csize)
            out += raw if method == 0 else ooz.decompress(raw, usize)
        start = off - first * self.block_size
        return bytes(out[start:start + length])


# Texture2D packages: the platform data follows SizeX, SizeY, PackedData and the
# pixel format as an FString; then FirstMip, NumMips, and per mip a 4-byte header and
# the pixels (the largest mips are in the .ubulk next to it when there is one).
FORMATS = {'PF_DXT1': (8, 'bcn', 1), 'PF_DXT5': (16, 'bcn', 3), 'PF_BC7': (16, 'bcn', 7), 'PF_B8G8R8A8': (4, 'raw', 'BGRA'), 'PF_R8G8B8A8': (4, 'raw', 'RGBA')}

def texture(stores, path):
    asset = bulk = None
    for s in stores:
        if asset is None and path + '.uasset' in s.paths: asset = s.read(s.paths[path + '.uasset'])
        if bulk is None and path + '.ubulk' in s.paths: bulk = s.read(s.paths[path + '.ubulk'])
    if asset is None: raise SystemExit(f'no texture {path}: has the game renamed it?')
    for m in re.finditer(rb'PF_[A-Z0-9_]+\0', asset):
        i, n = m.start(), len(m.group(0))
        if i < 16 or struct.unpack_from('<i', asset, i - 4)[0] != n: continue
        w, h = struct.unpack_from('<ii', asset, i - 16)
        fmt = m.group(0)[:-1].decode()
        if fmt not in FORMATS or not (0 < w <= 16384 and 0 < h <= 16384): continue
        bpp, codec, arg = FORMATS[fmt]
        size = ((w + 3) // 4) * ((h + 3) // 4) * bpp if codec == 'bcn' else w * h * bpp
        data = bulk[:size] if bulk else asset[i + n + 12:i + n + 12 + size]
        return Image.frombytes('RGBA', (w, h), data, codec, arg)
    raise SystemExit(f'{path}: not a texture this tool reads')


def export_media(game):
    paks = os.path.join(game, 'acr', 'Content', 'Paks')
    stores = [IoStore(os.path.join(paks, f)) for f in sorted(os.listdir(paks)) if f.endswith('.utoc')]
    prefix = '../../../acr/Content/' + MEDIA_DIR
    for s in stores: s.paths = {k[len(prefix):]: v for k, v in s.paths.items() if k.startswith(prefix)}
    os.makedirs(MEDIA_OUT, exist_ok=True)
    media = {}
    for stage, path in MEDIA.items():
        full = texture(stores, path)
        img = crop(full)
        img.thumbnail((MAP_SIZE, MAP_SIZE), Image.LANCZOS)
        img.save(os.path.join(MEDIA_OUT, f'{stage}.png'), optimize=True)
        chip(full).save(os.path.join(MEDIA_OUT, f'{stage}-chip.png'), optimize=True)
        media[stage] = {'map': f'img/rally/stages/{stage}.png', 'chip': f'img/rally/stages/{stage}-chip.png'}
    return media


def chip(img):
    """The map for Quick Drive's small stage buttons: only the stage (white) and the part
    driven (red), lines thickened so they still read at 34 px; no start/finish icons."""
    r, g, b, a = img.split()
    on = a.point(lambda v: 255 if v > 96 else 0)
    red = ImageChops.multiply(on, ImageChops.subtract(r, g).point(lambda v: 255 if v > 80 else 0))
    white = ImageChops.multiply(on, ImageChops.multiply(r.point(lambda v: 255 if v > 150 else 0), g.point(lambda v: 255 if v > 150 else 0)))
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.paste((255, 255, 255, 255), mask=white.filter(ImageFilter.MaxFilter(CHIP_GROW)))
    out.paste((225, 6, 0, 255), mask=red.filter(ImageFilter.MaxFilter(CHIP_GROW)))
    out = crop(out)
    out.thumbnail(CHIP_SIZE, Image.LANCZOS)
    return out


def crop(img):
    """The drawing without the empty space around it (a little margin kept), so it reads at chip size."""
    x0, y0, x1, y1 = img.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox() or (0, 0, *img.size)
    m = max(x1 - x0, y1 - y0) // 30
    return img.crop((max(x0 - m, 0), max(y0 - m, 0), min(x1 + m, img.width), min(y1 + m, img.height)))


def fstring(b, p):
    n, = struct.unpack_from('<i', b, p); p += 4
    if n >= 0: return b[p:p + max(n - 1, 0)].decode('latin1'), p + n
    return b[p:p + (-n - 1) * 2].decode('utf-16le'), p - 2 * n


def pak_files(pak):
    """{path: (data offset, entry)} of a v11 .pak with an unencrypted index, and its compression methods."""
    b = open(pak, 'rb').read()
    at = b.rindex(b'\xE1\x12\x6F\x5A')
    idx, = struct.unpack_from('<q', b, at + 8)
    methods = [m for m in b[at + 44:].split(b'\0') if m]
    p = idx
    mount, p = fstring(b, p)
    p += 4 + 8  # entry count, path hash seed
    if struct.unpack_from('<i', b, p)[0]: p += 4 + 8 + 8 + 20
    else: p += 4
    p += 4
    dir_off, = struct.unpack_from('<q', b, p); p += 8 + 8 + 20
    enc_size, = struct.unpack_from('<i', b, p); enc = p + 4
    out, p = {}, dir_off
    dirs, = struct.unpack_from('<i', b, p); p += 4
    for _ in range(dirs):
        d, p = fstring(b, p)
        n, = struct.unpack_from('<i', b, p); p += 4
        for _ in range(n):
            name, p = fstring(b, p)
            loc, = struct.unpack_from('<i', b, p); p += 4
            out[mount + d + name] = loc
    return b, enc, methods, out


def pak_read(b, enc, methods, loc):
    q = enc + loc
    f, = struct.unpack_from('<I', b, q); q += 4
    block = (f & 0x3f) << 11
    if f & 0x3f == 0x3f: block, = struct.unpack_from('<I', b, q); q += 4
    def rd(small):
        nonlocal q
        v = struct.unpack_from('<I' if small else '<Q', b, q)[0]; q += 4 if small else 8; return v
    offset, usize = rd(f & (1 << 31)), rd(f & (1 << 30))
    method, blocks = (f >> 23) & 0x3f, (f >> 6) & 0xffff
    size = rd(f & (1 << 29)) if method else usize
    sizes = [size] if blocks == 1 else [rd(True) for _ in range(blocks)] if method else []
    data_at = offset + 53 + (4 + 16 * blocks if method else 0)
    if not method: return b[data_at:data_at + usize]
    assert methods[method - 1] == b'Oodle', methods
    out, left = bytearray(), usize
    for s in sizes:
        out += ooz.decompress(b[data_at:data_at + s], min(block, left)); data_at += s; left -= min(block, left)
    return bytes(out)


def locres(data):
    """{key: text} of a locres (v2/v3)."""
    p, ver = 17, data[16]
    str_off, = struct.unpack_from('<q', data, p); p += 8 + (4 if ver >= 2 else 0)
    ns_count, = struct.unpack_from('<i', data, p); p += 4
    keys = []
    for _ in range(ns_count):
        p += 4 if ver >= 2 else 0
        _, p = fstring(data, p)
        kc, = struct.unpack_from('<i', data, p); p += 4
        for _ in range(kc):
            p += 4 if ver >= 2 else 0
            key, p = fstring(data, p)
            p += 4
            i, = struct.unpack_from('<i', data, p); p += 4
            keys.append((key, i))
    p = str_off
    sc, = struct.unpack_from('<i', data, p); p += 4
    strings = []
    for _ in range(sc):
        s, p = fstring(data, p); p += 4 if ver >= 2 else 0
        strings.append(s)
    return {k: strings[i].strip() for k, i in keys}


def clean(s):
    # Rich-text styles (<StyleBold>…</>) and stray zero-width marks the game's UI hides.
    return re.sub(r'<[^>]*>', '', s).replace('\ufeff', '').strip()


def per_lang(texts, key):
    en = texts['en'].get(key)
    if not en: raise SystemExit(f'missing text {key}: has the game renamed it?')
    out = {'en': clean(en)}
    for l in LANGS[1:]:
        v = texts[l].get(key)
        if v and clean(v) != out['en']: out[l] = clean(v)
    return out


def main():
    game = sys.argv[1] if len(sys.argv) > 1 else r'C:\Program Files (x86)\Steam\steamapps\common\Assetto Corsa Rally'
    pak = os.path.join(game, 'acr', 'Content', 'Paks', 'pakchunk0-Windows.pak')
    b, enc, methods, files = pak_files(pak)
    texts = {}
    for l in LANGS:
        path = next(p for p in files if p.endswith(f'Localization/Game/{l}/Game.locres'))
        texts[l] = locres(pak_read(b, enc, methods, files[path]))
    groups, stages = {}, {}
    for g, (sk, gk, dk, cut) in GROUPS.items():
        groups[g] = {'name': per_lang(texts, gk), 'description': per_lang(texts, dk)}
        for v in VARIANTS[g]:
            lv = 'FULL' if v == 'Full' else (cut or re.sub(r'\d', '', v).upper()) + re.sub(r'\D', '', v)
            for d in ('Forward', 'Reverse'):
                stages[f'{g}{v}{d}'] = per_lang(texts, f'TRACK_{sk}_{lv}_{d.upper()}')
    cars = {c: {'livery': per_lang(texts, lk), 'description': per_lang(texts, dk)} for c, (lk, dk) in CARS.items()}
    manifest = os.path.join(game, '..', '..', 'appmanifest_3917090.acf')
    build = re.search(r'"buildid"\s+"(\d+)"', open(manifest).read()).group(1) if os.path.exists(manifest) else ''
    media = export_media(game)
    data = {'updated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'build': build,
            'languages': LANGS, 'groups': groups, 'stages': stages, 'cars': cars, 'media': media}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{OUT}: {len(stages)} stages, {len(groups)} groups, {len(cars)} cars, {len(media)} stage maps (Rally build {build or "?"})')


if __name__ == '__main__':
    main()
