import { getSystemInfo } from '../system.js';
import { check } from './format.js';

export async function runDoctor(): Promise<number> {
  const info = await getSystemInfo();

  console.log('VeloxQuant SDK doctor\n');
  console.log(`${check(info.platform === 'darwin')} Platform: ${info.platform}`);
  console.log(`${check(info.isAppleSilicon)} Apple Silicon: ${info.isAppleSilicon ? (info.chip ?? 'detected') : 'not detected'}`);
  console.log(`${check(info.veloxquantInstalled)} veloxquant-mlx installed: ${info.veloxquantVersion ?? 'not found'}`);
  console.log(`  Python interpreter: ${info.pythonInterpreter}`);

  const allOk = info.platform === 'darwin' && info.isAppleSilicon && info.veloxquantInstalled;

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
