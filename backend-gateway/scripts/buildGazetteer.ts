/**
 * One-off: harvest the market names AGMARKNET reports for our states,
 * geocode each once, and write a static gazetteer.
 *
 * Nominatim allows one request per second, so a few hundred markets take
 * several minutes. That is fine as a build step and unacceptable in a request.
 *
 *   npx ts-node scripts/buildGazetteer.ts
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

// Single .env at the repo root, two levels up from scripts/.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const KEY = (process.env.DATA_GOV_IN_API_KEY || '').trim();
const RESOURCE = (process.env.DATA_GOV_MANDI_RESOURCE || '').trim();
// One state first — six states is 84 API calls before geocoding even starts,
// and data.gov.in will throttle you partway through. Widen once it works.
const STATES = ['Uttar Pradesh'];
const OUT = path.resolve(__dirname, '../src/data/mandiGazetteer.json');

interface Entry {
  market: string;
  district: string;
  state: string;
  lat: number;
  lon: number;
  precision: 'market' | 'district';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function agmarkDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

async function harvest(): Promise<Map<string, { market: string; district: string; state: string }>> {
  const found = new Map<string, { market: string; district: string; state: string }>();

  for (const state of STATES) {
    // Sweep the last 14 days so markets that report weekly are included.
    for (let back = 1; back <= 14; back += 1) {
      const day = new Date();
      day.setDate(day.getDate() - back);

      try {
        const { data } = await axios.get(`https://api.data.gov.in/resource/${RESOURCE}`, {
          params: {
            'api-key': KEY,
            format: 'json',
            limit: 1000,
            'filters[Arrival_Date]': agmarkDate(day),
            'filters[State]': state,
          },
          timeout: 30000,
          validateStatus: (s) => s < 500,
        });

        const records: any[] = (typeof data === 'object' && data) ? (data as any).records ?? [] : [];
        for (const r of records) {
          const market = String(r.Market ?? '').trim();
          const dist = String(r.District ?? '').trim();
          if (!market) continue;
          const key = `${market.toLowerCase()}|${state.toLowerCase()}`;
          if (!found.has(key)) found.set(key, { market, district: dist, state });
        }
      } catch { /* skip this day */ }

      await sleep(600);
    }
    console.log(`${state}: ${found.size} unique markets so far`);
  }
  return found;
}

async function geocode(market: string, district: string, state: string): Promise<Entry | null> {
  const attempts: Array<{ q: string; precision: 'market' | 'district' }> = [
    { q: `${market}, ${district}, ${state}, India`, precision: 'market' },
    { q: `${district}, ${state}, India`, precision: 'district' },
  ];

  for (const a of attempts) {
    try {
      const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: a.q, format: 'jsonv2', limit: 1, countrycodes: 'in' },
        headers: { 'User-Agent': process.env.NOMINATIM_USER_AGENT || 'AgriSaarthi/1.0' },
        timeout: 15000,
      });
      const hit = Array.isArray(data) ? data[0] : null;
      if (hit && Number.isFinite(Number(hit.lat))) {
        return { market, district, state, lat: Number(hit.lat), lon: Number(hit.lon), precision: a.precision };
      }
    } catch { /* next attempt */ }
    await sleep(1100);
  }
  return null;
}

async function main() {
  if (!KEY || !RESOURCE) {
    console.error('Missing config in the root .env:');
    console.error(`  DATA_GOV_IN_API_KEY     ${KEY ? 'ok' : 'MISSING'}`);
    console.error(`  DATA_GOV_MANDI_RESOURCE ${RESOURCE ? 'ok' : 'MISSING'}`);
    process.exit(1);
  }
  const markets = await harvest();
  console.log(`\nGeocoding ${markets.size} markets — roughly ${Math.ceil(markets.size * 1.2 / 60)} minutes\n`);

  const entries: Entry[] = [];
  let i = 0;
  for (const meta of markets.values()) {
    const e = await geocode(meta.market, meta.district, meta.state);
    if (e) entries.push(e);
    i += 1;
    if (i % 20 === 0) console.log(`  ${i}/${markets.size} — ${entries.length} located`);
    await sleep(1100);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(entries, null, 1));

  const exact = entries.filter((e) => e.precision === 'market').length;
  console.log(`\n✓ ${OUT}`);
  console.log(`  ${entries.length} markets · ${exact} exact · ${entries.length - exact} district centre`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });