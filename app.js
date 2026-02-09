const ARCGIS_API_KEY = "AAPTxy8BH1VEsoebNVZXo8HurDEIHHdyMjKCgGdJ--1yg6lBQh92lc6NHY4HVUUMjJCcalfFmxLqiBADCvRZtoiL3taCXyCr4-LD0vQXYk1o7FBlvbYggsXsDRd9PPCibbNvqWceIhZCvz7E2mHB4BYwMnZtmxtu0n_5tOmMDKuXRRZKKczfsqXY04asSbfjpaTP5Oph-SgL2DlaT_A3vgNpe2WrXNS4A6vFI3KriuPm7Z8.AT1_okgpKrcY"; // do NOT commit real keys to public repos
const form = document.getElementById("searchForm");
const input = document.getElementById("addressInput");
const statusEl = document.getElementById("status");
const btnLocate = document.getElementById("btnLocate");

(async function () {
  const BASE = import.meta.env.BASE_URL;
  // 1) Fetch CSV text
  const sitesText = await (await fetch(`${BASE}data/sites.csv`)).text();
  const shText = await (await fetch(`${BASE}data/settlement_houses.csv`)).text();

  // 2) Parse CSV
  const sites = parseCsv(sitesText);
  const settlementHouses = parseCsv(shText);

  // 3) Build a lookup for org-level info keyed by Settlement House name
const shByName = new Map(
  settlementHouses
    .map((r) => {
      const name = (r["Settlement House"] || "").trim();
      if (!name) return null;

      return [
        name.toLowerCase(),
        {
          settlementHouse: name,
          mainAddress: [
            (r["Main Address"] || "").trim(),
            (r["City"] || "").trim(),
            (r["State"] || "").trim(),
            (r["Zipcode"] || "").trim(),
          ]
            .filter(Boolean)
            .join(", "),
          website: (r["Website"] || "").trim(),
          description: (r["Description"] || "").trim(),
        },
      ];
    })
    .filter(Boolean)
);

  // 4) Demo location (Lower East Side-ish)
  let user = { lat: 40.7153, lon: -73.9843 }; // default demo location

  // 5) Compute distance to each SITE
  const rankedSites = sites
    .map((r) => {
      const lat = toNumber(r["Latitude"]);
      const lon = toNumber(r["Longitude"]);
      const street = (r["Address"] || "").trim();
      const city = (r["City"] || "").trim();
      const state = (r["State"] || "").trim();
      const zip = (r["Zipcode"] || "").trim();

const fullAddress = [street, city, state, zip]
  .filter(Boolean)
  .join(", ");

return {
  settlementHouse: (r["Settlement House"] || "").trim(),
  title: cleanText((r["Title"] || "").trim(),
  address: fullAddress,
  distanceMiles: haversineMiles(user.lat, user.lon, lat, lon),
};
    })
    .filter((x) => x.settlementHouse && Number.isFinite(x.distanceMiles))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

 // 6) ---- ADDRESS SEARCH ----
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;

  try {
    setStatus("Searching address…");
    const loc = await geocodeArcGIS(q);

    const updatedTopOrgs = computeTopOrgsForUser(loc, sites, shByName);
    renderCards(updatedTopOrgs);
    setStatus(`Showing results near: ${q}`);
  } catch (err) {
    console.error(err);
    setStatus("Could not find that address. Try adding NYC, NY and a ZIP code.");
  }
});

// ---- USE MY LOCATION BUTTON ----
btnLocate.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("Geolocation is not supported in this browser.");
    return;
  }

  setStatus("Requesting your location…");

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const loc = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
      };

      const updatedTopOrgs = computeTopOrgsForUser(loc, sites, shByName);
      renderCards(updatedTopOrgs);
      setStatus("Showing results near your current location.");
    },
    (err) => {
      console.error(err);
      setStatus("Could not access your location. Check browser permissions and try again.");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// START EMPTY ON LOAD. **Can Add text below search bar here//
document.getElementById("cards").innerHTML = "";
setStatus("");


})();



function renderCards(orgs) {
  const container = document.getElementById("cards");

  container.innerHTML = orgs.map((o) => {
    const miles = o.distanceMiles.toFixed(1);

    const sentence =
      o.distanceMiles < 1
        ? `You are within ${miles} miles of a ${o.settlementHouse} program site.`
        : `You are about ${miles} miles from a ${o.settlementHouse} program site.`;

    return `
      <article class="card">
        <h3>${escapeHtml(o.settlementHouse)}</h3>

        <p class="meta">${escapeHtml(sentence)}</p>

        ${o.description ? `<p class="meta">${escapeHtml(o.description)}</p>` : ""}

        ${o.mainAddress ? `<p class="meta"><strong>Main address:</strong> ${escapeHtml(o.mainAddress)}</p>` : ""}

        ${o.website ? `
          <div class="links">
            <a href="${escapeAttr(o.website)}" target="_blank" rel="noopener noreferrer">
              Visit website
            </a>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
}

async function geocodeArcGIS(singleLine) {
  const base =
    "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";

  async function runQuery(query) {
    const url =
      `${base}?f=json` +
      `&singleLine=${encodeURIComponent(query)}` +
      `&maxLocations=1` +
      `&outFields=*` +
      `&countryCode=USA` +
      `&token=${encodeURIComponent(ARCGIS_API_KEY)}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geocode request failed: ${res.status}`);

    const data = await res.json();
    return data?.candidates?.[0] || null;
  }

  // 1️⃣ Try NYC first (soft bias)
  let candidate = await runQuery(`${singleLine}, New York, NY`);

  // 2️⃣ If no result, try NY statewide
  if (!candidate) {
    candidate = await runQuery(`${singleLine}, NY`);
  }

  // 3️⃣ If still no result, try raw input
  if (!candidate) {
    candidate = await runQuery(singleLine);
  }

  if (!candidate?.location) {
    throw new Error("No candidates returned");
  }

  return {
    lon: candidate.location.x,
    lat: candidate.location.y,
  };
}


function computeTopOrgsForUser(user, sites, shByName) {
  const rankedSites = sites
    .map((r) => {
      const lat = toNumber(r["Latitude"]);
      const lon = toNumber(r["Longitude"]);

      return {
        settlementHouse: (r["Settlement House"] || "").trim(),
        distanceMiles: haversineMiles(user.lat, user.lon, lat, lon),
      };
    })
    .filter((x) => x.settlementHouse && Number.isFinite(x.distanceMiles))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  const seen = new Set();
  const topOrgs = [];

  for (const s of rankedSites) {
    const key = s.settlementHouse.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const org = shByName.get(key) || {};
    topOrgs.push({
      settlementHouse: s.settlementHouse,
      distanceMiles: s.distanceMiles,
      website: org.website || "",
      mainAddress: org.mainAddress || "",
      description: org.description || "",
    });

    if (topOrgs.length === 3) break;
  }

  return topOrgs;
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

// ---------- helpers ----------

function toNumber(x) {
  const n = Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R_km = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = R_km * c;
  return km * 0.621371;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// CSV parser (commas + quoted fields)
function parseCsv(csvText) {
  const lines = csvText.replace(/\r/g, "").split("\n").filter(Boolean);
  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function cleanTest(str) {
    return (str || "")
    .replace(\,Äôs/g, "'s")
    .replace(/[']/g, "'")
    .trim();
}
