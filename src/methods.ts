import { runVeloxquantJson } from './python/interpreter.js';
import type { MethodInfo, MethodsResult, VeloxQuantOptions } from './types.js';

interface RawMethodInfo {
  name: string;
  family: string;
  serve_tier: string;
  serve_tier_label: string;
  is_servable: boolean;
  coverage?: string | null;
  coverage_label?: string | null;
  is_adapted: boolean;
  blurb: string;
}

interface RawMethodsPayload {
  schema_version: number;
  default_serve_method: string;
  accounting_only: true;
  accounting_note: string;
  methods: RawMethodInfo[];
}

function normalize(raw: RawMethodInfo): MethodInfo {
  return {
    name: raw.name,
    family: raw.family,
    isServable: raw.is_servable,
    serveTierLabel: raw.serve_tier_label,
    telemetryCoverage: raw.coverage_label ?? null,
    isAdapted: raw.is_adapted,
    blurb: raw.blurb,
  };
}

/** Lists KV-cache compression methods from `veloxquant methods --json`. */
export async function listMethods(
  filter: { servableOnly?: boolean; family?: string } = {},
  opts: VeloxQuantOptions = {},
): Promise<MethodsResult> {
  const args = ['methods', '--json'];
  if (filter.servableOnly) args.push('--servable-only');
  if (filter.family) args.push('--family', filter.family);

  const raw = await runVeloxquantJson<RawMethodsPayload>(args, opts);
  return {
    schemaVersion: raw.schema_version,
    defaultServeMethod: raw.default_serve_method,
    accountingOnly: raw.accounting_only,
    accountingNote: raw.accounting_note,
    methods: raw.methods.map(normalize),
  };
}
