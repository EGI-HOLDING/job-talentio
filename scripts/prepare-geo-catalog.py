"""Build the reviewed import snapshot; never executed by application startup.

Inputs are downloaded source snapshots, not SQL executed against the database.
"""
import hashlib
import json
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'output/research/geo-2026-10-23/raw'
DEST = ROOT / 'apps/api/prisma/data/geo'
DEST.mkdir(parents=True, exist_ok=True)


def key(text):
    return re.sub(r'[^a-z0-9а-яё]', '', unicodedata.normalize('NFKD', text).lower())


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', text).lower()).strip('-')


with zipfile.ZipFile(RAW / 'soato.xlsx') as workbook:
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    strings = [''.join(cell.itertext()) for cell in ET.fromstring(workbook.read('xl/sharedStrings.xml')).findall('s:si', ns)]
    soato = []
    for row in ET.fromstring(workbook.read('xl/worksheets/sheet1.xml')).findall('.//s:row', ns):
        record = {}
        for cell in row.findall('s:c', ns):
            value = cell.find('s:v', ns)
            text = '' if value is None else value.text or ''
            record[re.sub('[0-9]', '', cell.get('r'))] = strings[int(text)] if cell.get('t') == 's' and text else text
        soato.append(record)
before_path = ROOT / 'output/research/geo-2026-10-23/before.json'
before = json.loads(before_path.read_text(encoding='utf8'))
old_provinces = {p['id']: p for p in before['provinces']}
province_rows = [r for r in soato if len(r.get('A', '')) == 4]
provinces = []
cities = []
matched = set()
for row in province_rows:
    code = row['A']
    names = {key(row.get(c, '')) for c in ['B', 'D', 'F']}
    matches = [p for p in before['provinces'] if names.intersection({key(p.get(c) or '') for c in ['name', 'nameUz', 'nameRu']})]
    if len(matches) != 1:
        raise ValueError(('Province needs review', row, matches))
    old = matches[0]
    provinces.append(dict(country='UZ', sourceCode='uz:soato:' + code, name=old['name'], nameUz=row['B'], nameRu=row['F'], slug=old['slug'], type=old['type']))

for row in soato:
    code = row.get('A', '')
    # SOATO: regional cities = xxx4xx; district cities = xxx...501..549.
    regional = len(code) == 7 and code[4] == '4' and not code.endswith('00')
    district_city = len(code) == 10 and code[7:9] == '50' and not code.endswith('00')
    if not (regional or district_city or code == '1726'):
        continue
    province = next(p for p in provinces if p['sourceCode'] == 'uz:soato:' + code[:4])
    native = row['B'].removesuffix(' shahri')
    ru = row['F'].removeprefix('город ')
    variants = {key(row.get(c, '')) for c in ['B', 'D', 'F']} | {key(native), key(ru)}
    matches = [c for c in before['cities'] if old_provinces[c['provinceId']]['slug'] == province['slug'] and variants.intersection({key(c.get(f) or '') for f in ['name', 'nameUz', 'nameRu', 'nameId', 'slug']})]
    if len(matches) > 1:
        raise ValueError(('Ambiguous legacy city', native, matches))
    old = matches[0] if matches else None
    if old:
        matched.add(old['slug'])
    aliases = [row.get('D'), native, ru]
    if old:
        aliases += [old.get(f) for f in ['name', 'nameUz', 'nameRu', 'nameId', 'slug']]
    cities.append(dict(country='UZ', provinceCode=province['sourceCode'], sourceCode='uz:soato:' + code, name=old['name'] if old else native, nameUz=native, nameRu=ru, slug=old['slug'] if old else 'uz-' + slug(native) + '-' + code, kind='CITY', legacySlug=old['slug'] if old else None, aliases=sorted(set(a for a in aliases if a))))

sql = (RAW / 'wilayah.sql').read_text(encoding='utf8')
for code, name in re.findall(r"\('([0-9.]+)','((?:\\.|[^'])*)'\)", sql):
    name = name.replace("\\'", "'")
    if re.fullmatch(r'\d{2}', code):
        provinces.append(dict(country='ID', sourceCode='id:kemendagri:' + code, name=name, nameId=name, slug='id-' + slug(name), type='REGION'))
    elif re.fullmatch(r'\d{2}\.\d{2}', code):
        cities.append(dict(country='ID', provinceCode='id:kemendagri:' + code[:2], sourceCode='id:kemendagri:' + code, name=name, nameId=name, slug='id-' + slug(name) + '-' + code.replace('.', '-'), kind='REGENCY' if name.startswith('Kabupaten ') else 'CITY', aliases=[name]))

counts = {country: {'provinces': sum(p['country'] == country for p in provinces), 'cities': sum(c['country'] == country for c in cities)} for country in ['ID', 'UZ']}
if counts['ID'] != {'provinces': 38, 'cities': 514} or counts['UZ']['provinces'] != 14 or counts['UZ']['cities'] < 115:
    raise ValueError(('Unexpected coverage', counts))
if len({c['sourceCode'] for c in cities}) != len(cities):
    raise ValueError('Duplicate source identity')
countries = [dict(name='Indonesia', nameId='Indonesia', nameUz='Indoneziya', nameRu='Индонезия', slug='indonesia', iso2='ID', iso3='IDN', phoneCode='+62', currencyCode='IDR'), dict(name='Uzbekistan', nameId='Uzbekistan', nameUz='O‘zbekiston', nameRu='Узбекистан', slug='uzbekistan', iso2='UZ', iso3='UZB', phoneCode='+998', currencyCode='UZS')]
snapshot = dict(version='2026-10-23', countries=countries, provinces=provinces, cities=cities)
(DEST / 'id-uz.json').write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
sources = dict(version=snapshot['version'], coverage=counts, sources=[dict(country='ID', url='https://github.com/cahyadsn/wilayah/blob/be9d3e301c962b46e1a5ef2275424cfa0b53a7ef/db/wilayah.sql', version='be9d3e301c962b46e1a5ef2275424cfa0b53a7ef', note='Repository README cites Kepmendagri 300.2.2-2430/2025; SQL header cites 300.2.2-2138/2025. Import preserves that provenance discrepancy.', license='MIT', sha256=hashlib.sha256((RAW / 'wilayah.sql').read_bytes()).hexdigest()), dict(country='UZ', url='https://stat.uz/images/soato-20_04_2022.xlsx', version='SOATO 2022-04-20', note='Official published snapshot, not a claim of all territorial changes through 2026. Only city classifications imported; districts and settlements excluded.', sha256=hashlib.sha256((RAW / 'soato.xlsx').read_bytes()).hexdigest())])
(DEST / 'sources.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
(DEST / 'INDONESIA-LICENSE.txt').write_text((RAW / 'indonesia-LICENSE.txt').read_text(encoding='utf8'), encoding='utf8')
print(json.dumps({'coverage': counts, 'reusedLegacyCities': len(matched), 'unmatchedLegacy': [{'name': c['name'], 'slug': c['slug'], 'usage': c['_count']} for c in before['cities'] if c['slug'] not in matched]}, ensure_ascii=False))
