import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const pageUrl = new URL("./index.html", import.meta.url);
const names = [
  "room", "room-day-off", "room-morning-off", "room-morning-on",
  "room-dusk-off", "room-dusk-on", "room-night-off", "room-night-on",
  "idle", "walk", "read", "computer", "sleep", "tea", "snack", "stretch", "window",
  "rice-cooker", "rice",
];
const sources = {};
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

for (const name of names) {
  const bytes = await readFile(new URL("./assets/" + name + ".png", import.meta.url));
  if (!bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error(name + ".png is not a PNG image");
  }
  sources[name] = "data:image/png;base64," + bytes.toString("base64");
}

const page = await readFile(pageUrl, "utf8");
const embedded = '<script id="character-assets" type="application/json">' + JSON.stringify(sources) + "</script>";
const existing = /<script id="character-assets" type="application\/json">[\s\S]*?<\/script>/;
const entry = '<script defer src="room.js"></script>';
if (!existing.test(page) && !page.includes(entry)) {
  throw new Error("Cannot find the character assets or room script entry");
}
const updated = existing.test(page) ? page.replace(existing, () => embedded) : page.replace(entry, () => embedded + "\n" + entry);
await writeFile(pageUrl, updated);
console.log("Embedded " + names.length + " room and character images in " + fileURLToPath(pageUrl));
