import { getSystemInfo } from '../system.js';
import { check } from './format.js';

export interface DoctorArgs {
  json?: boolean;
}

export async function runDoctor(args: DoctorArgs = {}): Promise<number> {
  const info = await getSystemInfo();

  const platformOk = info.platform === 'darwin';
  const pythonOk = info.pythonInterpreter.length > 0;
  const allOk = platformOk && info.isAppleSilicon && pythonOk && info.veloxquantInstalled;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ready: allOk,
          platform: { ok: platformOk, value: info.platform },
          appleSilicon: { ok: info.isAppleSilicon, chip: info.chip },
          python: { ok: pythonOk, interpreter: info.pythonInterpreter },
          veloxquantMlx: { ok: info.veloxquantInstalled, version: info.veloxquantVersion },
        },
        null,
        2,
      ),
    );
    return allOk ? 0 : 1;
  }

  console.log('VeloxQuant SDK doctor\n');
  console.log(`${check(platformOk)} Platform: ${info.platform}`);
  console.log(`${check(info.isAppleSilicon)} Apple Silicon: ${info.isAppleSilicon ? (info.chip ?? 'detected') : 'not detected'}`);
  console.log(`${check(pythonOk)} Python available: ${info.pythonInterpreter}`);
  console.log(`${check(info.veloxquantInstalled)} veloxquant-mlx installed: ${info.veloxquantVersion ?? 'not found'}`);

  console.log();
  if (allOk) {
    console.log('System ready 🚀');
    return 0;
  }

  console.log('Not ready. Fix the ✗ items above.');
  if (!info.veloxquantInstalled) {
    console.log(`  Install veloxquant-mlx: ${info.pythonInterpreter} -m pip install veloxquant-mlx`);
    console.log('  Or set VELOXQUANT_PYTHON to an interpreter that has it installed.');
  }
  if (!info.isAppleSilicon) {
    console.log('  VeloxQuant-MLX requires Apple Silicon (M1 or later) — MLX has no other backend.');
  }
  return 1;
}
