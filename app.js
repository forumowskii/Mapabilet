import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// --- KONFIGURACJA FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyCqWomuAPeflvawobPGRlNIqE-7H1cU4bs",
    authDomain: "biliet.firebaseapp.com",
    databaseURL: "https://biliet-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "biliet",
    storageBucket: "biliet.firebasestorage.app",
    messagingSenderId: "739842092527",
    appId: "1:739842092527:web:0d8989e6a09b1d78ebda1a"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Referencje do bazy
const statsRef = ref(db, 'stats/oszczednosci');
const tripsRef = ref(db, 'stats/przejazdy');
const stationsRef = ref(db, 'stats/stacje_siec');

// Stan aplikacji
let earnedSoFar = 0;
let stations = {};
let tripsData = [];
let gridActive = false;

// Taryfa z obrazka (Taryfa Pomorska 2026)
const taryfaPomorska = [
    {max: 6, cena: 7.00}, {max: 12, cena: 8.00}, {max: 18, cena: 9.00},
    {max: 24, cena: 11.00}, {max: 30, cena: 12.00}, {max: 40, cena: 14.00},
    {max: 50, cena: 16.00}, {max: 60, cena: 18.00}, {max: 70, cena: 20.00},
    {max: 80, cena: 22.00}, {max: 90, cena: 24.00}, {max: 100, cena: 26.00},
    {max: 120, cena: 30.00}, {max: 140, cena: 32.00}, {max: 160, cena: 34.00},
    {max: 180, cena: 36.00}, {max: 200, cena: 38.00}, {max: 220, cena: 39.00},
    {max: 300, cena: 40.00}, {max: 400, cena: 41.00}, {max: 500, cena: 42.00}
];

// --- SYNCHRONIZACJA DANYCH ---
onValue(statsRef, (s) => {
    earnedSoFar = s.val() || 0;
    updateStatsUI();
});

onValue(stationsRef, (s) => {
    stations = s.val() || {};
    updateStationDatalist();
});

onValue(tripsRef, (s) => {
    const list = document.getElementById('history-list');
    list.innerHTML = "";
    tripsData = [];
    if(s.exists()){
        s.forEach(child => {
            const t = child.val();
            tripsData.push(t);
            // Wyświetlanie historii BEZ możliwości usuwania
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div>
                    <b>${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()}</b><br>
                    <small style="opacity:0.5">${t.km} km | ${t.data}</small>
                </div>
                <div style="color:var(--success); font-weight:800">+${t.zl.toFixed(2)} zł</div>
            `;
            list.prepend(div);
        });
    }
});

// --- MAPA I SIATKA (GRID) ---
const svgMap = document.getElementById('svg-map');
const coordTooltip = document.getElementById('coord-info');

window.toggleGrid = () => {
    gridActive = !gridActive;
    document.getElementById('grid-btn').innerText = `SIATKA: ${gridActive ? 'WŁ' : 'WYŁ'}`;
    renderMap();
};

function renderMap() {
    svgMap.innerHTML = "";
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

    // 1. Rysowanie siatki (co 20 jednostek)
    if (gridActive) {
        for (let x = 0; x <= 400; x += 20) {
            for (let y = 0; y <= 600; y += 20) {
                const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("r", "1.5");
                dot.setAttribute("fill", "rgba(255,255,255,0.15)");
                dot.style.pointerEvents = "all";
                
                // Hover na punkt siatki
                dot.onmouseover = (e) => {
                    coordTooltip.style.display = "block";
                    coordTooltip.style.left = (e.pageX + 10) + "px";
                    coordTooltip.style.top = (e.pageY + 10) + "px";
                    coordTooltip.innerText = `X: ${x}, Y: ${y}`;
                };
                dot.onmouseout = () => coordTooltip.style.display = "none";
                dot.onclick = () => {
                    document.getElementById('new-st-x').value = x;
                    document.getElementById('new-st-y').value = y;
                };
                g.appendChild(dot);
            }
        }
    }

    // 2. Rysowanie połączeń
    for (let k in stations) {
        const s = stations[k];
        if (s.parent && stations[s.parent]) {
            const p = stations[s.parent];
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", s.x); line.setAttribute("y1", s.y);
            line.setAttribute("x2", p.x); line.setAttribute("y2", p.y);
            line.classList.add('map-link');
            g.appendChild(line);
        }
    }

    // 3. Rysowanie stacji
    for (let k in stations) {
        const s = stations[k];
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", s.x); circle.setAttribute("cy", s.y); circle.setAttribute("r", "4");
        circle.setAttribute("fill", "#fff");
        
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", s.x + 7); label.setAttribute("y", s.y + 4);
        label.setAttribute("fill", "#94a3b8"); label.setAttribute("font-size", "10px");
        label.textContent = k.toUpperCase();

        g.appendChild(circle); g.appendChild(label);
    }
    svgMap.appendChild(g);
}

// --- MAPA NATĘŻENIA (HEATMAPA) ---
window.openHeatmap = () => {
    document.getElementById('heatmap-modal').classList.add('active');
    const svgHeat = document.getElementById('svg-heatmap');
    svgHeat.innerHTML = "";
    
    // Liczenie ile razy dany odcinek był pokonany
    const edgeUsage = {};
    tripsData.forEach(t => {
        const route = [t.od, t.do].sort().join('-');
        edgeUsage[route] = (edgeUsage[route] || 0) + 1;
    });

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

    // Rysowanie tras z kolorem natężenia
    for (let k in stations) {
        const s = stations[k];
        if (s.parent && stations[s.parent]) {
            const p = stations[s.parent];
            const routeKey = [k, s.parent].sort().join('-');
            const count = edgeUsage[routeKey] || 0;

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", s.x); line.setAttribute("y1", s.y);
            line.setAttribute("x2", p.x); line.setAttribute("y2", p.y);
            line.classList.add('heatmap-link');

            // Kolorystyka jak na screenie
            if (count === 0) line.style.stroke = "#475569";
            else if (count < 5) line.style.stroke = "#facc15";
            else if (count < 20) line.style.stroke = "#f97316";
            else line.style.stroke = "#ef4444";

            g.appendChild(line);
        }
    }
    svgHeat.appendChild(g);
};

// --- LOGIKA BIZNESOWA ---
window.calculatePrice = () => {
    const from = document.getElementById('route-from').value.toLowerCase();
    const to = document.getElementById('route-to').value.toLowerCase();
    const disc = parseFloat(document.getElementById('discount-select').value);

    if (!stations[from] || !stations[to]) return alert("Błąd: Stacja nie istnieje w bazie!");

    const distance = Math.abs(stations[from].km - stations[to].km);
    const priceRow = taryfaPomorska.find(r => distance <= r.max) || {cena: 42};
    const finalPrice = priceRow.cena * (1 - disc);

    document.getElementById('trip-amount').value = finalPrice.toFixed(2);
    document.getElementById('calc-info').innerText = `Dystans: ${distance} km | Cena bazowa: ${priceRow.cena} zł`;
};

window.addNewTrip = () => {
    const f = document.getElementById('route-from').value.toLowerCase();
    const t = document.getElementById('route-to').value.toLowerCase();
    const zl = parseFloat(document.getElementById('trip-amount').value);

    if (!f || !t || isNaN(zl)) return;

    const dist = Math.abs(stations[f].km - stations[t].km);

    push(tripsRef, {
        od: f, do: t, zl: zl, km: dist,
        data: new Date().toLocaleDateString('pl-PL')
    }).then(() => {
        set(statsRef, earnedSoFar + zl);
        document.getElementById('route-from').value = "";
        document.getElementById('route-to').value = "";
        document.getElementById('trip-amount').value = "";
    });
};

// --- ZARZĄDZANIE BAZĄ ---
window.filterStations = () => {
    const q = document.getElementById('station-search').value.toLowerCase();
    const grid = document.getElementById('full-station-grid');
    grid.innerHTML = "";
    
    Object.keys(stations).filter(name => name.includes(q)).sort().forEach(k => {
        grid.innerHTML += `
            <div class="station-card">
                <b>${k.toUpperCase()}</b><br>
                <small>${stations[k].km} km | X:${stations[k].x} Y:${stations[k].y}</small>
            </div>`;
    });
};

window.saveNewStation = () => {
    const name = document.getElementById('new-st-name').value.toLowerCase().trim();
    const km = parseFloat(document.getElementById('new-st-km').value);
    const x = parseInt(document.getElementById('new-st-x').value);
    const y = parseInt(document.getElementById('new-st-y').value);
    const parent = document.getElementById('new-st-parent').value.toLowerCase().trim();

    if (!name || isNaN(km)) return alert("Wypełnij nazwę i KM!");

    stations[name] = { km, x, y, parent: parent || null };
    set(stationsRef, stations).then(() => {
        alert("Dodano stację!");
        renderMap();
    });
};

// --- POMOCNICZE UI ---
function updateStatsUI() {
    const p = Math.min((earnedSoFar / 150) * 100, 100);
    document.getElementById('bar-fill').style.width = p + "%";
    document.getElementById('percentage-label').innerText = p.toFixed(1) + "%";
    document.getElementById('earned-val').innerText = earnedSoFar.toFixed(2) + " zł";
}

function updateStationDatalist() {
    const dl = document.getElementById('stations-list');
    dl.innerHTML = "";
    Object.keys(stations).sort().forEach(k => {
        const opt = document.createElement('option');
        opt.value = k.toUpperCase();
        dl.appendChild(opt);
    });
}

window.openMap = () => { document.getElementById('map-modal').classList.add('active'); renderMap(); };
window.closeMap = () => document.getElementById('map-modal').classList.remove('active');
window.closeHeatmap = () => document.getElementById('heatmap-modal').classList.remove('active');
window.openStationList = () => { document.getElementById('list-modal').classList.add('active'); window.filterStations(); };
window.closeStationList = () => document.getElementById('list-modal').classList.remove('active');