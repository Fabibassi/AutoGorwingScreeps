import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "neutral",
  format: "cjs",
  target: "es2019",
  sourcemap: false,
  legalComments: "none",
});

console.log("built dist/main.js");
