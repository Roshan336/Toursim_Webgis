/**
 * Tourism category metadata, colors, Calcite icons, and cartographic SVG symbols.
 * ArcGIS Online-style circular badges: white fill, colored border, category glyph.
 * Synced with poi_categories table in database/init.sql.
 */

export const CATEGORY_COLORS = {
  heritage:    "#795548",
  temple:      "#6D4C41",
  attraction:  "#C2185B",
  hotel:       "#29B6F6",
  restaurant:  "#E65100",
  park:        "#00897B",
  adventure:   "#8E44AD",
  shopping:    "#16A085",
};

export const CALCITE_ICONS = {
  heritage:    "star",
  temple:      "book",
  attraction:  "tour",
  hotel:       "home",
  restaurant:  "heart",
  park:        "tree",
  adventure:   "compass",
  shopping:    "label",
};

/** Map legacy / DB icon names to icons that exist in Calcite 5.1.1 */
export const CALCITE_ICON_ALIASES = {
  "fork-spoon": "heart",
  forkSpoon: "heart",
  hiking: "compass",
  landmark: "star",
  castle: "home",
  monument: "star",
  "bookmark-catalog": "book",
  nature: "tree",
  activity: "compass",
  utensils: "heart",
  food: "heart",
};

export function resolveCalciteIcon(icon, categoryCode = "") {
  const normalized = icon && CALCITE_ICON_ALIASES[icon] ? CALCITE_ICON_ALIASES[icon] : icon;
  if (normalized) return normalized;
  return CALCITE_ICONS[categoryCode] || "tour";
}

export const CATEGORY_LABELS = {
  heritage:    "Heritage Sites",
  temple:      "Temples",
  attraction:  "Attractions",
  hotel:       "Hotels",
  restaurant:  "Restaurants",
  park:        "Parks",
  adventure:   "Adventure",
  shopping:    "Shopping",
};

export const CATEGORY_CODES = Object.keys(CATEGORY_COLORS);

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** ArcGIS-style circular badge: white circle, colored border, centered pictogram */
function circleBadgeSvg(strokeColor, glyphPaths, id = "s") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
    <defs>
      <filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.22"/>
      </filter>
    </defs>
    <circle cx="20" cy="20" r="17" fill="#ffffff" stroke="${strokeColor}" stroke-width="2.5" filter="url(#${id})"/>
    <g fill="${strokeColor}" transform="translate(20,20)">
      ${glyphPaths}
    </g>
  </svg>`;
}

const GLYPHS = {
  heritage: `
    <path d="M-8 5h16v2H-8z"/>
    <path d="M-6 5V-2l6-7 6 7v7H-6z"/>
    <rect x="-4" y="-1" width="2" height="6"/>
    <rect x="2" y="-1" width="2" height="6"/>`,
  temple: `
    <path d="M-7 5h14v2H-7z"/>
    <path d="M-5 5V0h10v5"/>
    <path d="M0-8v4M-2.5-6h5"/>
    <rect x="-2" y="1" width="4" height="4"/>`,
  attraction: `
    <path d="M-9 4h18v2H-9z"/>
    <path d="M-7 4V-4h4v8h-4z"/>
    <path d="M3 4V-4h4v8H3z"/>
    <path d="M-7-4h14v2H-7z"/>
    <path d="M0-9v5"/>`,
  hotel: `
    <path d="M-9 4h18v2H-9z"/>
    <rect x="-8" y="-1" width="5" height="5" rx="1"/>
    <rect x="-1" y="1" width="9" height="3" rx="1"/>
    <circle cx="-5.5" cy="0" r="1.8"/>`,
  restaurant: `
    <path d="M-5-7v5c0 1.5 1 2.5 1 4v5h-2v-5c0-1.5-1-2.5-1-4v-5z"/>
    <path d="M-7-7h4v3H-7z"/>
    <path d="M4-7v14"/>
    <path d="M2-5c0-2 2-2 2-4v-3"/>`,
  park: `
    <circle cx="0" cy="-3" r="5"/>
    <rect x="-1.5" y="1" width="3" height="5"/>`,
  adventure: `
    <path d="M0-8L-8 6h16L0-8z"/>
    <path d="M-3 2h6v2H-3z"/>`,
  shopping: `
    <path d="M-7 3h14l-1.5 8H-5.5L-7 3z"/>
    <path d="M-4-3h2l1 3H-5l1-3z"/>
    <path d="M2-3h2l1 3H3l-1-3z"/>`,
};

export function getCategoryIconUrl(category, colorHex) {
  const code = GLYPHS[category] ? category : "attraction";
  const color = colorHex || CATEGORY_COLORS[code] || CATEGORY_COLORS.attraction;
  return svgDataUrl(circleBadgeSvg(color, GLYPHS[code], `sh-${code}`));
}

export const CATEGORY_ICON_URLS = Object.fromEntries(
  CATEGORY_CODES.map((code) => [code, getCategoryIconUrl(code)])
);

export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : [100, 100, 200];
}

export function getCategorySymbol(category, size = 32, colorHex) {
  const url = getCategoryIconUrl(category, colorHex);
  return {
    type: "picture-marker",
    url,
    width: size,
    height: size,
    yoffset: 0,
  };
}

export function getCategoryBadgeHtml(category) {
  const color = CATEGORY_COLORS[category] || "#6b7280";
  const label = CATEGORY_LABELS[category] || category;
  return `<span class="category-badge cat-badge-${category}" style="background:${color}">${label}</span>`;
}

export function mergeApiCategories(apiRows) {
  if (!apiRows?.length) return null;
  const merged = { ...CATEGORY_LABELS };
  const colors = { ...CATEGORY_COLORS };
  const icons = { ...CALCITE_ICONS };
  apiRows.forEach((row) => {
    if (row.code) {
      merged[row.code] = row.label || merged[row.code];
      if (row.color_hex) colors[row.code] = row.color_hex;
      if (row.icon) icons[row.code] = resolveCalciteIcon(row.icon, row.code);
    }
  });
  return { labels: merged, colors, icons };
}
