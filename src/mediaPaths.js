import path from 'node:path';

export function validMediaName(name) {
  // Baileys writes flat names. Reject ADS, drives, UNC, dot segments, encoded
  // separators, reserved Windows devices and trailing dots/spaces on every OS.
  return typeof name === 'string' && name.length <= 255 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)
    && !name.includes('..') && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}
export function containedPath(root, file, pathApi = path) {
  const base = pathApi.resolve(root);
  const absolute = pathApi.resolve(base, file);
  const relative = pathApi.relative(base, absolute);
  if (!relative || relative === '..' || relative.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(relative)) {
    throw Object.assign(new Error('Lokasi lampiran tidak diizinkan.'), { status: 403 });
  }
  return absolute;
}
