// Consolidated smoke suite: import → waveform → volume line → envelope →
// playhead typing → autosave/resume.
// Run: node tests/e2e/fixtures.mjs && npm run dev (elsewhere) && node tests/e2e/smoke.mjs
import { chromium } from "playwright";

const fx = new URL("./fixtures/", import.meta.url).pathname;
const APP = process.env.APP_URL ?? "http://localhost:5173";
let fails = 0;
const check = (n, c, e = "") => { console.log(`${c ? "PASS" : "FAIL"}: ${n}${e ? ` (${e})` : ""}`); if (!c) fails++; };

let browser;
try { browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] }); }
catch { browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] }); }
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e)));

await page.goto(APP);
await page.setInputFiles('input[accept="audio/*"]', fx + "mod-tone.wav");
await page.waitForSelector(".block .wave");
check("import shows one lane with a waveform", (await page.locator(".lane-head").count()) === 1);

// waveform painted
const painted = await page.evaluate(() => {
  const c = document.querySelector(".block .wave");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let on = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) on++;
  return on / (d.length / 4);
});
check("waveform painted", painted > 0.05 && painted < 0.95, `${(painted * 100).toFixed(1)}%`);

// volume line drag (whole track)
const line = await page.locator(".block .vol-line").boundingBox();
await page.mouse.move(line.x + line.width / 2, line.y + 7);
await page.mouse.down();
await page.mouse.move(line.x + line.width / 2, line.y + 7 + 28, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(250);
check("volume line drag sets gain 0.5", (await page.locator('label:has-text("Vol") input').inputValue()) === "0.5");
await page.keyboard.press("Control+z");
await page.waitForTimeout(150);

// envelope: dblclick adds points; drag one down
const block = await page.locator(".block").boundingBox();
await page.mouse.dblclick(block.x + block.width * 0.3, block.y + block.height * 0.5);
await page.waitForSelector(".vol-env");
await page.mouse.dblclick(block.x + block.width * 0.6, block.y + block.height * 0.8);
await page.waitForTimeout(150);
check("envelope points added", (await page.locator(".env-pt").count()) === 2);

// playhead typing
await page.click(".ph-time");
await page.locator(".ph-time-input").fill("0:02");
await page.locator(".ph-time-input").press("Enter");
check("typed playhead time seeks", (await page.textContent(".clock")).startsWith("0:02.0"));

// autosave + resume
await page.waitForTimeout(1200);
await page.reload();
await page.waitForSelector(".resume-banner", { timeout: 10000 });
await page.click('button:has-text("Resume")');
await page.waitForSelector(".block .wave", { timeout: 20000 });
check("autosave resumes with the arrangement", (await page.locator(".env-pt").count()) === 2);

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL SMOKE CHECKS PASSED");
process.exit(fails ? 1 : 0);
