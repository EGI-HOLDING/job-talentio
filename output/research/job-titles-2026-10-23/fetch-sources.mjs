import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const checkedAt = new Date().toISOString();
const requests = Array.from({ length: 4 }, (_, offset) => ({
  id: `esco-occupations-page-${offset}`,
  url: `https://ec.europa.eu/esco/api/search?type=occupation&limit=1000&offset=${offset}&full=false&viewObsolete=false&language=en&selectedVersion=v1.2.1`,
}));
const manifest = await Promise.all(requests.map(async ({ id, url }) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`${id}: ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data._embedded?.results)) throw new Error(`${id}: invalid response`);
  await fs.writeFile(path.join(root, 'sources', `${id}.json`), JSON.stringify(data, null, 2));
  return { id, url, checkedAt, count: data._embedded.results.length, total: data.total };
}));
await fs.writeFile(path.join(root, 'sources', 'download-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
