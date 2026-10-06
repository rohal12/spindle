// Preloaded by bunfig.toml: lets `bun run` import the markup grammar.
import { bunPeggyPlugin } from './peggy';

declare const Bun: { plugin(plugin: typeof bunPeggyPlugin): void };

Bun.plugin(bunPeggyPlugin);
