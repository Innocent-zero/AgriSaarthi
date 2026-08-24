/**
 * Bridge to the compiled C++ net-profit optimiser.
 * Spawns the binary, streams JSON over stdin/stdout, enforces a hard timeout
 * and surfaces engine errors as typed rejections.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface MandiCandidate {
  id?: string;
  name: string;
  district?: string;
  lat?: number;
  lon?: number;
  distanceKm?: number;
  pricePerQuintal: number;
  handlingFee?: number;
  loadingChargePerQuintal?: number;
  commissionPct?: number;
}

export interface MandiEngineInput {
  origin: { lat: number; lon: number };
  volumeQuintals: number;
  crop?: string;
  localPricePerQuintal?: number;
  vehicle?: {
    kmpl?: number;
    fuelPricePerLitre?: number;
    capacityQuintals?: number;
    hireChargePerTrip?: number;
    roadFactor?: number;
    avgSpeedKmph?: number;
  };
  mandis: MandiCandidate[];
}

export interface MandiEngineRow {
  rank: number;
  id: string;
  name: string;
  district: string;
  pricePerQuintal: number;
  distanceKm: number;
  trips: number;
  grossRevenue: number;
  fuelCost: number;
  hireCost: number;
  commission: number;
  handlingCost: number;
  totalDeductions: number;
  netProfit: number;
  netPerQuintal: number;
  roundTripHours: number;
  viable: boolean;
  verdict: string;
}

export interface MandiEngineOutput {
  success: boolean;
  engine: string;
  version: string;
  crop: string;
  volumeQuintals: number;
  origin: { lat: number; lon: number };
  assumptions: Record<string, number>;
  results: MandiEngineRow[];
  best: { id: string; name: string; netProfit: number; netPerQuintal: number; distanceKm: number };
  spreadVsWorst: number;
  localBaseline: {
    pricePerQuintal: number;
    netProfit: number;
    upliftIfTravel: number;
    travelRecommended: boolean;
  } | null;
  evaluatedCount: number;
  error?: string;
}

export class MandiEngineError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'MandiEngineError';
  }
}

function resolveBinary(): string {
  const configured = process.env.MANDI_ENGINE_BIN;
  const candidates = [
    configured,
    path.resolve(process.cwd(), '../mandi-engine/build/mandi_router'),
    path.resolve(process.cwd(), 'mandi-engine/build/mandi_router'),
    '/opt/render/project/src/mandi-engine/build/mandi_router',
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    const abs = path.isAbsolute(c) ? c : path.resolve(process.cwd(), c);
    if (fs.existsSync(abs)) return abs;
  }
  throw new MandiEngineError(
    `mandi_router binary not found. Run "make engine". Searched: ${candidates.join(', ')}`,
    'ENGINE_MISSING',
  );
}

export function runMandiEngine(input: MandiEngineInput): Promise<MandiEngineOutput> {
  return new Promise((resolve, reject) => {
    let binary: string;
    try {
      binary = resolveBinary();
    } catch (err) {
      reject(err);
      return;
    }

    const timeoutMs = Number(process.env.MANDI_ENGINE_TIMEOUT_MS || 5000);
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new MandiEngineError(`Engine timed out after ${timeoutMs} ms`, 'ENGINE_TIMEOUT'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new MandiEngineError(`Failed to spawn engine: ${err.message}`, 'ENGINE_SPAWN_FAILED'));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new MandiEngineError(
          `Engine produced no output (exit ${code}). stderr: ${stderr.trim() || 'none'}`,
          'ENGINE_NO_OUTPUT',
        ));
        return;
      }

      let parsed: MandiEngineOutput;
      try {
        parsed = JSON.parse(trimmed) as MandiEngineOutput;
      } catch {
        reject(new MandiEngineError(`Engine returned malformed JSON: ${trimmed.slice(0, 240)}`, 'ENGINE_BAD_JSON'));
        return;
      }

      if (!parsed.success) {
        reject(new MandiEngineError(parsed.error || 'Engine reported failure', 'ENGINE_REJECTED_INPUT'));
        return;
      }
      resolve(parsed);
    });

    child.stdin.on('error', () => { /* handled by close/error paths */ });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

export async function engineHealth(): Promise<{ available: boolean; path?: string; error?: string }> {
  try {
    const p = resolveBinary();
    return { available: true, path: p };
  } catch (err) {
    return { available: false, error: (err as Error).message };
  }
}