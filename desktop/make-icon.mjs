// Rasterizes the web app's icon for the installers (electron-builder derives .ico/.icns from it)
import sharp from "sharp";
import { mkdirSync } from "node:fs";

mkdirSync("build", { recursive: true });
await sharp("../public/asset/AppIcon.svg", { density: 1152 }).resize(1024, 1024).png().toFile("build/icon.png");
