import { execSync } from 'child_process';
import { resolve } from 'path';

export default function globalSetup() {
  const root = resolve(import.meta.dirname!, '../..');
  execSync('npm run preview', { cwd: root, stdio: 'inherit' });
}
