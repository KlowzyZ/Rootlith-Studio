// Synthetic records use the real schema and writer; never a historical private binary.
import { template } from '../../packages/core/templates';
import { storeSchema, storageKeys } from '../../packages/core/storage';
import { emptyRecords, validateRecords } from '../../packages/core/native-contract';
export function syntheticRecords() {
  const workflow = { ...template('local'), id: 'validation-playbook', name: 'Synthetic validation playbook' };
  const date = '2026-11-09T00:00:00.000Z';
  const store = storeSchema.parse({
    version: 1, workflows: [workflow],
    reports: [{ id: 'validation-evidence', workflow: workflow.name, version: '1.0.0', date, demo: true,
      limitations: ['Synthetic evidence; no diagnostic executed'], steps: [{ nodeId: 'interfaces', label: 'Synthetic adapters', status: 'passed', duration: 1, output: { detail: 'Synthetic evidence preserved' } }] }],
    cases: [{ id: 'validation-case', name: 'Synthetic preservation case', note: 'Keep this note through upgrade and uninstall.', workflowIds: [workflow.id], runIds: ['validation-evidence'], created: date, updated: date, archived: false }],
    favoriteRuns: ['validation-evidence'],
  });
  return validateRecords({ ...emptyRecords(), [storageKeys.primary]: JSON.stringify(store),
    [storageKeys.backup]: JSON.stringify(store),
    [storageKeys.draft]: JSON.stringify({ version: 1, date, workflow: { ...workflow, name: 'Synthetic recovered draft' } }),
    [storageKeys.quarantine]: 'Synthetic raw recovery: preserve these bytes',
  });
}
