import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

const statsRef = ref(db, 'stats/oszczednosci');
const tripsRef = ref(db, 'stats/przejazdy');
const stationsRef = ref(db, 'stats/stacje_siec');

let earnedSoFar = 0;
let stations = {};
let tripsData = [];
let gridActive = false;

// Zoom state dla obu map
let mapState = { x: 0, y: 0, scale: 1 };
let heatState = { x: 0, y: 0, scale: 1 };

const taryfa = [
    {max: 6, cena: 7.00}, {max: 12, cena: 8.00}, {max: 18, cena: 9.00},
    {max: 24, cena: 11.00}, {max: 30, cena: 12.00}, {max: 40, cena: 14.00},
    {max: 50, cena: 16.00}, {max: 60, cena: 18.00}, {max: 70, cena: 20.00},
    {max: 80, cena: 22.00}, {max: 90, cena: 24.00}, {max: 100, cena: 26.00},
    {max: 120, cena: 30.00}, {max: 140, cena: 32.00}, {max: 160, cena: 34.00}
];

// --- SYNCHRONIZACJA ---
onValue(statsRef, (s) => { earnedSoFar = s.val() || 0; updateUI(); });
onValue(stationsRef, (s) => { stations = s.val() || {}; updateStationList(); });
onValue(tripsRef, (s) => {
    const container = document.getElementById('history-list');
    container.innerHTML = "";
    tripsData = [];
    if(s.exists()){
        s.forEach(child => {
            const t = child.val();
            tripsData.push(t);
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
                <div>
                    <b style="color:#fff">REGIO ${t.nr || '??'}</b> | <small>${t.data}</small><br>
                    <span>${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()}</span>
                </div>
                <div style="text-align:right; color:var(--success); font-weight:800">+${t.zl.toFixed(2)} zł</div>
            `;
            container.prepend(item);
        });
    }
});

// --- ZOOM & PAN LOGIC ---
function setupInteraction(svgId, stateObj, renderFn) {
    const svg = document.getElementById(svgId);
    let isPanning = false;
    let startPos = { x: 0, y: 0 };

    svg.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        stateObj.scale *= delta;
        renderFn();
    });

    const start = (x, y) => { isPanning = true; startPos = { x: x - stateObj.x, y: y - stateObj.y }; };
    const move = (x, y) => { if(!isPanning) return; stateObj.x = x - startPos.x; stateObj.y = y - startPos.y; renderFn(); };
    const end = () => { isPanning = false; };

    svg.addEventListener('mousedown', e => start(e.clientX, e.clientY));
    window.addEventListener('mousemove', e => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', end);

    svg.addEventListener('touchstart', e => start(e.touches[0].clientX, e.touches[0].clientY));
    svg.addEventListener('touchmove', e => { move(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); });
    svg.addEventListener('touchend', end);
}

// --- RENDERING MAPY ---
function renderBaseLayer(svg, state, isHeatmap = false) {
    svg.innerHTML = "";
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${state.x}, ${state.y}) scale(${state.scale})`);

    // Siatka (tylko na głównej mapie)
    if (!isHeatmap && gridActive) {
        for (let x = 0; x <= 400; x += 20) {
            for (let y = 0; y <= 600; y += 20) {
                const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("r", 1.5 / state.scale);
                dot.setAttribute("fill", "rgba(255,255,255,0.1)");
                dot.style.pointerEvents = "all";
                dot.onmouseover = (e) => {
                    const tooltip = document.getElementById('coord-info');
                    tooltip.style.display = "block"; tooltip.style.left = e.pageX + 10 + "px"; tooltip.style.top = e.pageY + 10 + "px";
                    tooltip.innerText = `X: ${x}, Y: ${y}`;
                };
                dot.onmouseout = () => document.getElementById('coord-info').style.display = "none";
                dot.onclick = () => { document.getElementById('new-st-x').value = x; document.getElementById('new-st-y').value = y; };
                g.appendChild(dot);
            }
        }
    }

    // Linie
    const edgeUsage = {};
    if(isHeatmap) tripsData.forEach(t => { const r = [t.od, t.do].sort().join('-'); edgeUsage[r] = (edgeUsage[r] || 0) + 1; });

    for (let k in stations) {
        const s = stations[k];
        if (s.parent && stations[s.parent]) {
            const p = stations[s.parent];
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", s.x); line.setAttribute("y1", s.y);
            line.setAttribute("x2", p.x); line.setAttribute("y2", p.y);
            
            if(isHeatmap) {
                const count = edgeUsage[[k, s.parent].sort().join('-')] || 0;
                line.classList.add('heatmap-link');
                line.style.stroke = count === 0 ? "#475569" : count < 5 ? "#facc15" : count < 20 ? "#f97316" : "#ef4444";
            } else {
                line.classList.add('map-link');
            }
            g.appendChild(line);
        }
    }

    // Punkty i Nazwy
    for (let k in stations) {
        const s = stations[k];
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("cx", s.x); c.setAttribute("cy", s.y); c.setAttribute("r", 4 / state.scale);
        c.setAttribute("fill", "#fff");
        
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", s.x + (10 / state.scale)); t.setAttribute("y", s.y + (4 / state.scale));
        t.setAttribute("fill", "#94a3b8"); t.setAttribute("font-size", (10 / state.scale) + "px");
        t.textContent = k.toUpperCase();
        
        g.appendChild(c); g.appendChild(t);
    }
    svg.appendChild(g);
}

// --- OBSŁUGA FORMULARZA ---
window.calculatePrice = () => {
    const f = document.getElementById('route-from').value.toLowerCase();
    const t = document.getElementById('route-to').value.toLowerCase();
    const disc = parseFloat(document.getElementById('discount-select').value);
    if(!stations[f] || !stations[t]) return alert("Nie ma stacji!");
    
    const dist = Math.abs(stations[f].km - stations[t].km);
    const row = taryfa.find(r => dist <= r.max) || {cena: 40};
    const final = row.cena * (1 - disc);
    document.getElementById('trip-amount').value = final.toFixed(2);
    document.getElementById('calc-info').innerText = `${dist} km | Bazowa: ${row.cena} zł`;
};

window.addNewTrip = () => {
    const f = document.getElementById('route-from').value.toLowerCase();
    const t = document.getElementById('route-to').value.toLowerCase();
    const zl = parseFloat(document.getElementById('trip-amount').value);
    const nr = document.getElementById('regio-num').value;
    if(!f || !t || isNaN(zl)) return;

    push(tripsRef, {
        od: f, do: t, zl: zl, nr: nr,
        km: Math.abs(stations[f].km - stations[t].km),
        data: new Date().toLocaleDateString('pl-PL')
    }).then(() => set(statsRef, earnedSoFar + zl));
};

window.saveNewStation = () => {
    const name = document.getElementById('new-st-name').value.toLowerCase().trim();
    const km = parseFloat(document.getElementById('new-st-km').value);
    const x = parseInt(document.getElementById('new-st-x').value);
    const y = parseInt(document.getElementById('new-st-y').value);
    const p = document.getElementById('new-st-parent').value.toLowerCase().trim();
    if(!name || isNaN(km)) return;
    stations[name] = { km, x, y, parent: p || null };
    set(stationsRef, stations).then(() => renderMap());
};

// --- UI HELPERS ---
function updateUI() {
    const p = Math.min((earnedSoFar / 150) * 100, 100);
    document.getElementById('bar-fill').style.width = p + "%";
    document.getElementById('percentage-label').innerText = p.toFixed(1) + "%";
    document.getElementById('earned-val').innerText = earnedSoFar.toFixed(2) + " zł";
}

function updateStationList() {
    const dl = document.getElementById('stations-list');
    dl.innerHTML = "";
    Object.keys(stations).sort().forEach(k => {
        const o = document.createElement('option'); o.value = k.toUpperCase(); dl.appendChild(o);
    });
}

window.filterStations = () => {
    const q = document.getElementById('station-search').value.toLowerCase();
    const g = document.getElementById('full-station-grid');
    g.innerHTML = "";
    Object.keys(stations).filter(n => n.includes(q)).sort().forEach(k => {
        g.innerHTML += `<div class="station-card"><b>${k.toUpperCase()}</b><br>${stations[k].km} km</div>`;
    });
};

// Mapy
window.renderMap = () => renderBaseLayer(document.getElementById('svg-map'), mapState, false);
window.renderHeatmap = () => renderBaseLayer(document.getElementById('svg-heatmap'), heatState, true);
window.toggleGrid = () => { gridActive = !gridActive; window.renderMap(); };

window.openMap = () => { document.getElementById('map-modal').classList.add('active'); window.renderMap(); };
window.openHeatmap = () => { document.getElementById('heatmap-modal').classList.add('active'); window.renderHeatmap(); };
window.closeMap = () => document.getElementById('map-modal').classList.remove('active');
window.closeHeatmap = () => document.getElementById('heatmap-modal').classList.remove('active');
window.openStationList = () => { document.getElementById('list-modal').classList.add('active'); window.filterStations(); };
window.closeStationList = () => document.getElementById('list-modal').classList.remove('active');

// Inicjalizacja interakcji
setupInteraction('svg-map', mapState, window.renderMap);
setupInteraction('svg-heatmap', heatState, window.renderHeatmap);