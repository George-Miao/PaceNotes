for (const name of ["GOOGLE_MAPS_API_KEY", "GOOGLE_MAP_ID"]) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

await import("./server/index.mjs");
