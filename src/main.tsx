// Browser entry point of the story format: boot once the DOM is ready.
import { boot } from './index';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
