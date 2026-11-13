// Screenshots both views: `node harness/shots.ts [fixture] [outDir]`.
import { bootGame, openViews } from "./harness.ts";

const [fixture = "sample-game", outDir = "shots"] = process.argv.slice(2);
const game = await bootGame(fixture);
const { browser, control, display } = await openViews(game.url);
// The wallpaper fades in.
await display.waitForTimeout(2000);
await control.screenshot({ path: `${outDir}/control.png` });
await display.screenshot({ path: `${outDir}/display.png` });
await browser.close();
await game.close();
console.log(`Saved ${outDir}/control.png and ${outDir}/display.png`);
