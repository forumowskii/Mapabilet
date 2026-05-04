import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import PhotoSwipeLightbox from 'https://unpkg.com/photoswipe@5.4.3/dist/photoswipe-lightbox.esm.js';

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

const statsRef = ref(db, 'stats/oszczednosci');
const tripsRef = ref(db, 'stats/przejazdy');
const stationsRef = ref(db, 'stats/stacje_siec');

// --- ZMIENNE STANU ---
let earnedSoFar = 0;
let stations = {};
let tripsData = [];
let gridActive = false;
let currentType = 'regio'; // Domyślny przewoźnik

// Stany Zoomu dla map
let mapState = { x: 0, y: 0, scale: 1 };
let heatState = { x: 0, y: 0, scale: 1 };

// Taryfa 2026 (Przykładowa dla Regio)
const taryfa = [
    {max: 6, cena: 7.00}, {max: 12, cena: 8.50}, {max: 18, cena: 10.00},
    {max: 24, cena: 12.50}, {max: 30, cena: 14.00}, {max: 40, cena: 16.50},
    {max: 50, cena: 19.00}, {max: 60, cena: 21.00}, {max: 80, cena: 25.00},
    {max: 100, cena: 30.00}
];

// Kolory Przewoźników
const typeColors = {
    regio: '#ef4444',
    ic: '#3b82f6',
    skm: '#fde047'
};

// --- SYNCHRONIZACJA Z BAZĄ ---
onValue(statsRef, (s) => { 
    earnedSoFar = s.val() || 0; 
    updateProgressUI(); 
});

onValue(stationsRef, (s) => { 
    stations = s.val() || {}; 
    updateDatalists(); 
    if(document.getElementById('map-modal').classList.contains('active')) renderBase();
});

onValue(tripsRef, (s) => {
    const list = document.getElementById('history-list');
    list.innerHTML = "";
    tripsData = [];
    if(s.exists()) {
        s.forEach(child => {
            const t = child.val();
            tripsData.push(t);
            const div = document.createElement('div');
            div.className = 'history-item';
            div.style.borderLeftColor = typeColors[t.typ || 'regio'];
            div.innerHTML = `
                <div>
                    <b style="color:#fff">${t.typ?.toUpperCase() || 'REGIO'} ${t.nr || ''}</b><br>
                    <small>${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()}</small>
                </div>
                <div style="color:var(--success); font-weight:900">+${t.zl.toFixed(2)} zł</div>
            `;
            list.prepend(div);
        });
    }
});

// --- LOGIKA PRZEWOŹNIKÓW ---
window.setType = (type) => {
    currentType = type;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${type}`).classList.add('active');
    document.getElementById('stop-info').innerText = `Wybrano tryb: ${type.toUpperCase()}`;
};

window.checkStops = () => {
    const from = document.getElementById('route-from').value.toLowerCase();
    const to = document.getElementById('route-to').value.toLowerCase();
    const infoBox = document.getElementById('stop-info');

    if(!stations[from] || !stations[to]) {
        infoBox.innerText = "❌ Wybierz poprawne stacje z listy!";
        return;
    }

    // Filtrowanie stacji "po drodze" na podstawie typu
    const allStacje = Object.keys(stations);
    const poDrodze = allStacje.filter(sName => {
        const s = stations[sName];
        const withinKm = (s.km >= Math.min(stations[from].km, stations[to].km)) && 
                         (s.km <= Math.max(stations[from].km, stations[to].km));
        
        if(!withinKm) return false;
        if(currentType === 'ic') return s.type === 'ic';
        if(currentType === 'regio') return s.type === 'ic' || s.type === 'regio';
        return true; // SKM widzi wszystko
    });

    infoBox.innerHTML = `📍 Staje na: <span style="color:#fff">${poDrodze.length}</span> stacjach (Tryb ${currentType.toUpperCase()})`;
};

// --- KALKULACJE ---
window.calculatePrice = () => {
    const f = document.getElementById('route-from').value.toLowerCase();
    const t = document.getElementById('route-to').value.toLowerCase();
    const disc = parseFloat(document.getElementById('discount-select').value);
    
    if(!stations[f] || !stations[t]) return alert("Nie znaleziono stacji!");
    
    const km = Math.abs(stations[f].km - stations[t].km);
    let bazowa = (taryfa.find(r => km <= r.max) || {cena: 35}).cena;
    
    // Modyfikator ceny zależny od typu
    if(currentType === 'ic') bazowa *= 1.5;
    if(currentType === 'skm') bazowa *= 0.8;

    const final = bazowa * (1 - disc);
    document.getElementById('trip-amount').value = final.toFixed(2);
    document.getElementById('stop-info').innerText = `Dystans: ${km} km | Taryfa: ${currentType.toUpperCase()}`;
};

window.addNewTrip = () => {
    const od = document.getElementById('route-from').value.toLowerCase();
    const _do = document.getElementById('route-to').value.toLowerCase();
    const zl = parseFloat(document.getElementById('trip-amount').value);
    const nr = document.getElementById('regio-num').value;

    if(!od || !_do || isNaN(zl)) return alert("Uzupełnij dane!");

    push(tripsRef, {
        od, do: _do, zl, nr, typ: currentType,
        data: new Date().toLocaleDateString('pl-PL')
    }).then(() => {
        set(statsRef, earnedSoFar + zl);
        document.getElementById('trip-amount').value = "";
    });
};

// --- EDYTOR SIECI ---
window.saveNewStation = () => {
    const name = document.getElementById('new-st-name').value.toLowerCase().trim();
    const type = document.getElementById('new-st-type').value;
    const km = parseFloat(document.getElementById('new-st-km').value);
    const x = parseInt(document.getElementById('new-st-x').value);
    const y = parseInt(document.getElementById('new-st-y').value);
    const parent = document.getElementById('new-st-parent').value.toLowerCase().trim();

    if(!name || isNaN(km) || isNaN(x)) return alert("Brak danych!");

    // Obsługa wielu punktów dla jednej stacji (węzły)
    const stationId = parent ? `${name}_${Date.now()}` : name;

    stations[stationId] = { name, type, km, x, y, parent: parent || null };
    set(stationsRef, stations);
};

// --- SYSTEM MAPY (SVG) ---
function renderMapElements(svgId, state, mode = 'base') {
    const svg = document.getElementById(svgId);
    if(!svg) return;
    svg.innerHTML = "";
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${state.x},${state.y}) scale(${state.scale})`);

    // Gęsta siatka (Grid)
    if (mode === 'base' && gridActive) {
        const step = state.scale > 2 ? 10 : 25; // Gęstnieje przy zoomie
        for(let x=0; x<=400; x+=step) {
            for(let y=0; y<=600; y+=step) {
                const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 1.5/state.scale);
                c.setAttribute("fill", "rgba(255,255,255,0.1)");
                c.style.pointerEvents = "all";
                c.onclick = () => {
                    document.getElementById('new-st-x').value = x;
                    document.getElementById('new-st-y').value = y;
                };
                c.onmouseenter = (e) => {
                    const tip = document.getElementById('coord-info');
                    tip.style.display = 'block'; tip.style.left = e.pageX + 10 + 'px'; tip.style.top = e.pageY + 10 + 'px';
                    tip.innerText = `X:${x} Y:${y}`;
                };
                c.onmouseleave = () => document.getElementById('coord-info').style.display = 'none';
                g.appendChild(c);
            }
        }
    }

    // Rysowanie Linii
    Object.keys(stations).forEach(id => {
        const s = stations[id];
        if(s.parent && stations[s.parent]) {
            const p = stations[s.parent];
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", s.x); line.setAttribute("y1", s.y);
            line.setAttribute("x2", p.x); line.setAttribute("y2", p.y);
            
            // Kolor zależny od typu stacji/linii
            line.setAttribute("stroke", typeColors[s.type] || '#475569');
            line.setAttribute("stroke-width", mode === 'heat' ? 5/state.scale : 2/state.scale);
            line.setAttribute("stroke-linecap", "round");
            g.appendChild(line);
        }
    });

    // Rysowanie Kropek Stacji
    Object.keys(stations).forEach(id => {
        const s = stations[id];
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", s.x); circle.setAttribute("cy", s.y);
        circle.setAttribute("r", 4/state.scale);
        circle.setAttribute("fill", s.type === 'ic' ? '#fff' : '#94a3b8');
        
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
        txt.setAttribute("x", s.x + 6/state.scale); txt.setAttribute("y", s.y + 4/state.scale);
        txt.setAttribute("fill", "#fff"); txt.setAttribute("font-size", (10/state.scale) + "px");
        txt.setAttribute("font-weight", "bold");
        txt.textContent = s.name.toUpperCase();
        
        g.appendChild(circle);
        if(state.scale > 1.5) g.appendChild(txt);
    });

    svg.appendChild(g);
}

// --- INTERAKCJE SVG (Zoom & Pan) ---
function setupSVG(svgId, state, renderFn) {
    const svg = document.getElementById(svgId);
    let isDragging = false;
    let startPos = { x: 0, y: 0 };

    svg.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        state.scale *= delta;
        state.scale = Math.max(0.5, Math.min(10, state.scale));
        renderFn();
    });

    svg.addEventListener('mousedown', e => {
        isDragging = true;
        startPos = { x: e.clientX - state.x, y: e.clientY - state.y };
    });

    window.addEventListener('mousemove', e => {
        if(!isDragging) return;
        state.x = e.clientX - startPos.x;
        state.y = e.clientY - startPos.y;
        renderFn();
    });

    window.addEventListener('mouseup', () => isDragging = false);

    // Touch Support
    svg.addEventListener('touchstart', e => {
        if(e.touches.length === 1) {
            isDragging = true;
            startPos = { x: e.touches[0].clientX - state.x, y: e.touches[0].clientY - state.y };
        }
    });
    svg.addEventListener('touchmove', e => {
        if(!isDragging) return;
        state.x = e.touches[0].clientX - startPos.x;
        state.y = e.touches[0].clientY - startPos.y;
        renderFn();
    });
    svg.addEventListener('touchend', () => isDragging = false);
}

// --- GALERIA (PhotoSwipe) ---
window.fullView = (index) => {
    const images = [
        { src: 'img/schemat1.jpg', w: 2500, h: 3500 }, // Wymiary dostosuj do plików!
        { src: 'img/schemat2.jpg', w: 1800, h: 1200 }
    ];
    const lightbox = new PhotoSwipeLightbox({
        dataSource: images,
        pswpModule: () => import('https://unpkg.com/photoswipe@5.4.3/dist/photoswipe.esm.js')
    });
    lightbox.init();
    lightbox.loadAndOpen(index);
};

// --- UI HELPERS ---
function updateProgressUI() {
    const percent = Math.min((earnedSoFar / 150) * 100, 100);
    document.getElementById('bar-fill').style.width = percent + "%";
    document.getElementById('percentage-label').innerText = percent.toFixed(1) + "%";
    document.getElementById('earned-val').innerText = earnedSoFar.toFixed(2) + " zł";
}

function updateDatalists() {
    const list = document.getElementById('stations-list');
    list.innerHTML = "";
    const uniqueNames = [...new Set(Object.values(stations).map(s => s.name))];
    uniqueNames.sort().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name.toUpperCase();
        list.appendChild(opt);
    });
}

// Okna Modali
window.toggleMenu = () => {
    document.getElementById('side-menu').classList.toggle('active');
    document.getElementById('menu-overlay').classList.toggle('active');
};
window.closeMenu = () => {
    document.getElementById('side-menu').classList.remove('active');
    document.getElementById('menu-overlay').classList.remove('active');
};

window.openMap = () => { document.getElementById('map-modal').classList.add('active'); renderBase(); };
window.closeMap = () => document.getElementById('map-modal').classList.remove('active');
window.openHeatmap = () => { document.getElementById('heatmap-modal').classList.add('active'); renderHeat(); };
window.closeHeatmap = () => document.getElementById('heatmap-modal').classList.remove('active');
window.openGallery = () => { window.closeMenu(); document.getElementById('gallery-modal').classList.add('active'); };
window.closeGallery = () => document.getElementById('gallery-modal').classList.remove('active');
window.openSettings = () => { window.closeMenu(); document.getElementById('settings-modal').classList.add('active'); window.filterStations(); };
window.closeSettings = () => document.getElementById('settings-modal').classList.remove('active');

window.toggleGrid = () => {
    gridActive = !gridActive;
    document.getElementById('grid-btn').innerText = `GRID: ${gridActive ? 'ON' : 'OFF'}`;
    renderBase();
};

window.filterStations = () => {
    const q = document.getElementById('station-search').value.toLowerCase();
    const grid = document.getElementById('full-station-grid');
    grid.innerHTML = "";
    Object.keys(stations).forEach(id => {
        const s = stations[id];
        if(s.name.includes(q)) {
            grid.innerHTML += `
                <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:12px; border-bottom: 2px solid ${typeColors[s.type]}">
                    <small style="opacity:0.5">${id}</small><br>
                    <b>${s.name.toUpperCase()}</b><br>
                    <small>${s.km} km | X:${s.x} Y:${s.y}</small>
                </div>`;
        }
    });
};

// Inicjalizacja
const renderBase = () => renderMapElements('svg-map', mapState, 'base');
const renderHeat = () => renderMapElements('svg-heatmap', heatState, 'heat');

setupSVG('svg-map', mapState, renderBase);
setupSVG('svg-heatmap', heatState, renderHeat);