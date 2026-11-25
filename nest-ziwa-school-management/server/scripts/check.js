import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function jsFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(folder, entry.name);
    return entry.isDirectory() ? jsFiles(full) : entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}
const files = [...jsFiles(path.join(root, 'src')), ...jsFiles(path.join(root, 'scripts'))];
const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push({ file: path.relative(root, file), output: `${result.stdout}${result.stderr}`.trim() });
}
if (failures.length) {
  for (const failure of failures) process.stderr.write(`\n${failure.file}\n${failure.output}\n`);
  process.exitCode = 1;
} else {
  console.log(`Backend syntax check passed for ${files.length} JavaScript files.`);
  const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const validation = spawnSync(process.execPath, [prismaCli, 'validate'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgresql://build-check:build-check@127.0.0.1:5432/nest_ziwa?schema=public' },
    encoding: 'utf8'
  });
  if (validation.status !== 0) {
    process.stderr.write(`${validation.stdout}${validation.stderr}`);
    process.exitCode = validation.status || 1;
  } else {
    process.stdout.write(`${validation.stdout.trim()}\n`);
  }
}
