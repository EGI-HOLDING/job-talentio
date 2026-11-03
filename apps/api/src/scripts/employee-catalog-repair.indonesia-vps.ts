/** Never invoked by startup or Dockerfile. The operator must explicitly run
 * this in the Indonesia container with the target marker and a backup. */
import { runCatalogRepair } from './employee-catalog-repair.local';
void runCatalogRepair('INDONESIA_VPS').catch(e=>{console.error(e.message);process.exitCode=1});
