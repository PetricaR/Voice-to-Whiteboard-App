/**
 * Self-contained equirectangular SVG vector world basemap, regional choropleth
 * polygons, viewport scopes, and city/country/region geocoder for the 6
 * Geospatial chart types (Choropleth, Dot, Geo Heatmap, Bubble, Flow, Connection).
 */
import type { MapScope } from '../../engine/dashboard';

export const GEO_WIDTH = 800;
export const GEO_HEIGHT = 400;

/** Projects latitude (-65..85) and longitude (-180..180) onto the 800×400 map canvas. */
export function projectGeo(lat: number, lon: number): { x: number; y: number } {
  const clampedLon = Math.max(-180, Math.min(180, lon));
  const clampedLat = Math.max(-65, Math.min(85, lat));
  const x = ((clampedLon + 180) / 360) * GEO_WIDTH;
  const y = ((85 - clampedLat) / 150) * GEO_HEIGHT;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

export const MAP_SCOPE_VIEWBOX: Record<MapScope, { x: number; y: number; w: number; h: number }> = {
  world: { x: 0, y: 0, w: 800, h: 400 },
  americas: { x: 45, y: 24, w: 300, h: 356 },
  emea: { x: 335, y: 28, w: 225, h: 330 },
  apac: { x: 495, y: 50, w: 295, h: 325 },
};

export interface GeoRegionShape {
  id: 'North America' | 'LATAM' | 'EMEA' | 'APAC';
  label: string;
  labelLat: number;
  labelLon: number;
  paths: string[];
}

function ptsToPath(coords: [number, number][]): string {
  return (
    coords
      .map(([lat, lon], idx) => {
        const { x, y } = projectGeo(lat, lon);
        return `${idx === 0 ? 'M' : 'L'}${x},${y}`;
      })
      .join(' ') + ' Z'
  );
}

export const WORLD_REGIONS: readonly GeoRegionShape[] = [
  {
    id: 'North America',
    label: 'North America',
    labelLat: 44,
    labelLon: -101,
    paths: [
      // Mainland North America (Alaska + Canada + US + Mexico)
      ptsToPath([
        [70, -165], [71, -152], [69, -136], [68, -120], [72, -96], [66, -84],
        [61, -78], [60, -64], [52, -56], [46, -61], [44, -66], [41, -70],
        [36, -75], [30, -81], [25, -80], [29, -89], [26, -97], [21, -97],
        [21, -87], [16, -88], [15, -93], [18, -103], [23, -106], [31, -114],
        [24, -110], [33, -117], [38, -123], [48, -125], [55, -133], [60, -148],
        [56, -159], [61, -166], [66, -168],
      ]),
      // Greenland
      ptsToPath([
        [82, -52], [81, -22], [74, -19], [68, -28], [60, -44], [65, -53], [73, -56], [78, -68],
      ]),
    ],
  },
  {
    id: 'LATAM',
    label: 'LATAM',
    labelLat: -14,
    labelLon: -58,
    paths: [
      // Central & South America
      ptsToPath([
        [15, -88], [11, -83], [9, -78], [12, -72], [10, -62], [6, -54],
        [1, -49], [-5, -35], [-13, -38], [-23, -42], [-33, -52], [-41, -63],
        [-52, -68], [-55, -67], [-53, -73], [-43, -74], [-30, -71], [-18, -70],
        [-12, -77], [-5, -81], [2, -79], [8, -78], [10, -85], [14, -91],
      ]),
    ],
  },
  {
    id: 'EMEA',
    label: 'EMEA',
    labelLat: 24,
    labelLon: 18,
    paths: [
      // Continental Europe + Scandinavia + Iberia
      ptsToPath([
        [71, 26], [68, 38], [60, 32], [55, 38], [46, 36], [42, 28],
        [38, 24], [38, 15], [43, 13], [44, 8], [42, 3], [36, -6],
        [37, -9], [43, -9], [44, -2], [48, -5], [51, 2], [54, 8],
        [58, 8], [62, 5], [68, 15],
      ]),
      // Great Britain & Ireland
      ptsToPath([
        [58, -5], [57, -2], [51, 1], [50, -5], [54, -5], [56, -6],
      ]),
      // Africa + Arabian Peninsula
      ptsToPath([
        [36, -6], [37, 10], [32, 15], [31, 32], [37, 36], [38, 44],
        [30, 49], [25, 56], [22, 60], [13, 45], [12, 51], [2, 45],
        [-10, 40], [-20, 35], [-26, 33], [-34, 25], [-35, 18], [-28, 15],
        [-17, 12], [-6, 12], [4, 9], [5, -4], [10, -14], [15, -17],
        [23, -16], [30, -10],
      ]),
      // Madagascar
      ptsToPath([
        [-13, 49], [-18, 50], [-25, 47], [-25, 44], [-17, 44],
      ]),
    ],
  },
  {
    id: 'APAC',
    label: 'APAC',
    labelLat: 26,
    labelLon: 106,
    paths: [
      // Eurasia East + India + China + Southeast Asia
      ptsToPath([
        [68, 38], [72, 72], [74, 106], [70, 145], [65, 175], [58, 162],
        [52, 141], [43, 132], [38, 128], [35, 120], [30, 122], [22, 114],
        [19, 108], [12, 109], [9, 105], [14, 100], [3, 102], [8, 98],
        [16, 95], [22, 90], [16, 82], [8, 77], [18, 73], [24, 68],
        [25, 60], [30, 49], [38, 44], [46, 48], [55, 42],
      ]),
      // Japan
      ptsToPath([
        [44, 142], [40, 141], [35, 140], [33, 131], [36, 136], [42, 140],
      ]),
      // Maritime Southeast Asia (Sumatra / Borneo / Java simplified)
      ptsToPath([
        [5, 96], [-5, 105], [-8, 115], [-6, 118], [4, 118], [6, 116], [1, 109],
      ]),
      // Australia
      ptsToPath([
        [-12, 131], [-12, 142], [-20, 149], [-28, 153], [-38, 147], [-35, 137],
        [-32, 125], [-34, 115], [-22, 114], [-16, 123],
      ]),
      // New Zealand
      ptsToPath([
        [-35, 173], [-41, 176], [-46, 168], [-44, 167], [-38, 174],
      ]),
    ],
  },
];

const KNOWN_COORDS: Record<string, [number, number]> = {
  // Macro regions
  'north america': [41.5, -99.0],
  americas: [22.0, -82.0],
  na: [41.5, -99.0],
  latam: [-15.8, -56.0],
  'south america': [-16.5, -58.0],
  'latin america': [-14.0, -60.0],
  emea: [44.0, 14.0],
  europe: [49.5, 12.0],
  eu: [49.5, 12.0],
  'middle east': [25.2, 48.5],
  africa: [4.5, 21.0],
  apac: [28.0, 116.0],
  asia: [32.0, 108.0],
  oceania: [-25.0, 135.0],

  // Countries
  'united states': [39.8, -98.5],
  usa: [39.8, -98.5],
  us: [39.8, -98.5],
  canada: [56.1, -106.3],
  mexico: [23.6, -102.5],
  brazil: [-14.2, -51.9],
  argentina: [-34.6, -64.0],
  chile: [-33.4, -70.6],
  colombia: [4.7, -74.1],
  'united kingdom': [53.5, -2.0],
  uk: [53.5, -2.0],
  germany: [51.2, 10.4],
  france: [46.6, 2.2],
  spain: [40.4, -3.7],
  italy: [42.5, 12.5],
  netherlands: [52.3, 4.9],
  sweden: [60.1, 18.6],
  switzerland: [46.8, 8.2],
  poland: [52.1, 19.4],
  norway: [60.5, 8.5],
  ireland: [53.3, -7.7],
  uae: [24.4, 54.4],
  israel: [31.8, 35.0],
  'south africa': [-29.0, 24.0],
  nigeria: [9.1, 8.7],
  egypt: [26.8, 30.8],
  india: [21.1, 78.9],
  china: [35.8, 104.2],
  japan: [36.2, 138.2],
  singapore: [1.35, 103.82],
  'south korea': [36.5, 127.8],
  korea: [36.5, 127.8],
  australia: [-25.3, 133.8],
  indonesia: [-2.5, 118.0],
  vietnam: [15.9, 107.8],
  taiwan: [23.7, 121.0],
  'new zealand': [-41.3, 174.8],

  // Global Cities & Data Center Hubs
  'new york': [40.71, -74.01],
  nyc: [40.71, -74.01],
  'san francisco': [37.77, -122.42],
  sf: [37.77, -122.42],
  'los angeles': [34.05, -118.24],
  chicago: [41.88, -87.63],
  seattle: [47.61, -122.33],
  austin: [30.27, -97.74],
  miami: [25.76, -80.19],
  boston: [42.36, -71.06],
  toronto: [43.65, -79.38],
  vancouver: [49.28, -123.12],
  'mexico city': [19.43, -99.13],
  'sao paulo': [-23.55, -46.63],
  'são paulo': [-23.55, -46.63],
  'buenos aires': [-34.6, -58.38],
  bogota: [4.71, -74.07],
  london: [51.51, -0.13],
  frankfurt: [50.11, 8.68],
  paris: [48.86, 2.35],
  amsterdam: [52.37, 4.9],
  dublin: [53.35, -6.26],
  madrid: [40.42, -3.7],
  milan: [45.46, 9.19],
  stockholm: [59.33, 18.07],
  zurich: [47.37, 8.54],
  warsaw: [52.23, 21.01],
  dubai: [25.2, 55.27],
  'tel aviv': [32.09, 34.78],
  johannesburg: [-26.2, 28.05],
  lagos: [6.52, 3.38],
  mumbai: [19.08, 72.88],
  bengaluru: [12.97, 77.59],
  delhi: [28.61, 77.21],
  tokyo: [35.68, 139.69],
  osaka: [34.69, 135.5],
  seoul: [37.57, 126.98],
  'hong kong': [22.32, 114.17],
  taipei: [25.03, 121.57],
  jakarta: [-6.21, 106.85],
  sydney: [-33.87, 151.21],
  melbourne: [-37.81, 144.96],
  auckland: [-36.85, 174.76],
};

/** Resolves a location string to `[lat, lon]`, using deterministic fallback if custom. */
export function resolveLocationCoords(rawName: string): [number, number] {
  const key = rawName.trim().toLowerCase();
  if (KNOWN_COORDS[key]) return KNOWN_COORDS[key];
  for (const [k, coords] of Object.entries(KNOWN_COORDS)) {
    if (k.length >= 4 && (key.includes(k) || k.includes(key))) return coords;
  }
  // Deterministic fallback distributed across populated latitudes
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u1 = ((h >>> 0) % 1000) / 1000;
  const u2 = (((h >>> 10) ^ (h >>> 20)) % 1000) / 1000;
  return [-25 + u1 * 75, -120 + u2 * 260];
}

/** Maps a region/country/city label onto one of the 4 macro choropleth territories. */
export function matchMacroRegion(raw: string): GeoRegionShape['id'] | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (/\b(north america|na|usa|us|united states|canada|new york|san francisco|chicago|miami|toronto|seattle|austin)\b/.test(t)) {
    return 'North America';
  }
  if (/\b(latam|latin|south america|brazil|argentina|chile|colombia|mexico|sao paulo|são paulo|bogota|buenos aires)\b/.test(t)) {
    return 'LATAM';
  }
  if (/\b(emea|europe|eu|uk|united kingdom|germany|france|spain|italy|netherlands|sweden|switzerland|poland|ireland|middle east|africa|uae|dubai|london|frankfurt|paris|amsterdam|madrid|lagos|johannesburg)\b/.test(t)) {
    return 'EMEA';
  }
  if (/\b(apac|asia|pacific|oceania|japan|india|china|singapore|australia|korea|indonesia|taiwan|tokyo|mumbai|sydney|seoul|hong kong|jakarta)\b/.test(t)) {
    return 'APAC';
  }
  return null;
}
