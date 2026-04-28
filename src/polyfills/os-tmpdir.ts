/**
 * formidable@1.x вызывает os.tmpDir(); в Node 22 корректно os.tmpdir().
 * Через require('os') получаем изменяемый экспорт (не замороженный ESM namespace).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const os = require('os') as typeof import('node:os') & { tmpDir?: () => string };

if (typeof os.tmpDir !== 'function' && typeof os.tmpdir === 'function') {
  os.tmpDir = os.tmpdir.bind(os);
}
