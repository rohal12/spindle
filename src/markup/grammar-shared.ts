/**
 * What the grammar (spindle.peggy) imports from the rest of Spindle, so that
 * it holds no second copy: the generated parser imports this module's
 * default export as `shared` (see scripts/peggy.ts).
 */
import { SIGIL_SCOPES, withSelectors } from './tokens';

export default { SIGIL_SCOPES, withSelectors };
