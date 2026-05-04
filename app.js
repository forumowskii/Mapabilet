import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

// Refs
const statsRef = ref(db, 'stats/oszczednosci');
const tripsRef = ref(db, 'stats/przejazdy');
const stationsRef = ref(db, 'stats/stacje_siec');

let earnedSoFar = 0;
let stations = {};
let tripsData = [];

// Mapa state
let viewbox = { x: 0, y: 0, w: 400, h: 600 };
let isDragging = false;
let lastPos = { x: 0, y: 0 };

// --- TARYFA POMORSKA 2026 ---
const taryfa = [
    {max: 6, cena: 7.00}, {max: 12, cena: 8.00}, {max: 18, cena: 9.00},
    {max: 24, cena: 11.00}, {max: 30, cena: 12.00}, {max: 40, cena: 14.00},
    {max: 50, cena: 16.00}, {max: 60, cena: 18.00}, {max: 70, cena: 20.00},
    {max: 80, cena: 22.00}, {max: 90, cena: 24.00}, {max: 100, cena: 26.00},
    {max: 120, cena: 30.00}, {max: 140, cena: 32.00}, {max: 160, cena: 34.00}
];

// --- NORMALIZACJA (Fuzzy Search) ---
const normalize = (t) => {
    if(!t) return "";
    return t.toLowerCase().trim()
        .replace(/[ąàáâãäå]/g,"a").replace(/[ćç]/g,"c").replace(/[ęèéêë]/g,"e")
        .replace(/[ł]/g,"l").replace(/[ńñ]/g,"n").replace(/[óòôõöu]/g,"o")
        .replace(/[ś]/g,"s").replace(/[źż]/g,"z").replace(/\s+/g,"");
};

const findBestMatch = (input) => {
    const ni = normalize(input);
    if(!ni) return null;
    return Object.keys(stations).find(k => {
        const nk = normalize(k);
        return nk === ni || nk.includes(ni) || ni.includes(nk);
    });
};

// --- SYNCHRONIZACJA Z BAZĄ ---
onValue(stationsRef, (s) => {
    if(s.exists()) {
        stations = s.val();
        renderDataList();
    }
});

onValue(statsRef, (s) => {
    earnedSoFar = s.val() || 0;
    updateUI();
});

onValue(tripsRef, (s) => {
    const list = document.getElementById('history-list');
    list.innerHTML = "";
    tripsData = [];
    if(s.exists()){
        s.forEach(child => {
            const t = child.val();
            const id = child.key;
            tripsData.push({...t, id});
            addSwipeItem(list, t, id);
        });
    }
});

// --- OBSŁUGA SWIPE ---
function addSwipeItem(container, data, id) {
    const wrap = document.createElement('div');
    wrap.className = 'swipe-container';
    wrap.innerHTML = `
        <div class="delete-btn" onclick="window.requestDelete('${id}', ${data.zl})">🗑️</div>
        <div class="history-item" id="item-${id}">
            <div>
                <b style="color:#fff">${data.od.toUpperCase()} ➔ ${data.do.toUpperCase()}</b><br>
                <small style="opacity:0.6">${data.km} km | ${data.data || ''}</small>
            </div>
            <div style="text-align:right">
                <span style="color:#4ade80; font-weight:800">+${parseFloat(data.zl).toFixed(2)} zł</span>
            </div>
        </div>
    `;

    const item = wrap.querySelector('.history-item');
    let startX = 0;

    item.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        item.style.transition = 'none';
    }, {passive: true});

    item.addEventListener('touchmove', e => {
        let diff = e.touches[0].clientX - startX;
        if(diff < 0) item.style.transform = `translateX(${Math.max(diff, -80)}px)`;
    }, {passive: true});

    item.addEventListener('touchend', e => {
        item.style.transition = 'transform 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)';
        let diff = e.changedTouches[0].clientX - startX;
        item.style.transform = diff < -40 ? 'translateX(-80px)' : 'translateX(0)';
    });

    container.prepend(wrap);
}

window.requestDelete = (id, amount) => {
    if(confirm("Usunąć ten przejazd?")) {
        remove(ref(db, `stats/przejazdy/${id}`)).then(() => {
            set(statsRef, earnedSoFar - amount);
        });
    } else {
        document.getElementById(`item-${id}`).style.transform = 'translateX(0)';
    }
};

// --- OBLICZENIA (TYLKO KM) ---
window.calculatePrice = () => {
    const fName = findBestMatch(document.getElementById('route-from').value);
    const tName = findBestMatch(document.getElementById('route-to').value);
    const disc = parseFloat(document.getElementById('discount-select').value);

    if(!fName || !tName) return alert("Nie rozpoznano stacji!");

    const dist = Math.abs(stations[fName].km - stations[tName].km);
    const row = taryfa.find(r => dist <= r.max) || {cena: 40};
    const final = row.cena * (1 - disc);

    document.getElementById('trip-amount').value = final.toFixed(2);
    document.getElementById('route-from').value = fName.toUpperCase();
    document.getElementById('route-to').value = tName.toUpperCase();
    document.getElementById('calc-info').innerText = `Dystans: ${dist} km | Cena bazowa: ${row.cena} zł`;
};

window.addNewTrip = () => {
    const f = document.getElementById('route-from').value;
    const t = document.getElementById('route-to').value;
    const zl = parseFloat(document.getElementById('trip-amount').value);
    if(!f || !t || isNaN(zl)) return alert("Oblicz cenę!");

    const dist = Math.abs(stations[f.toLowerCase()].km - stations[t.toLowerCase()].km);

    push(tripsRef, {
        od: f.toLowerCase(), do: t.toLowerCase(), zl: zl, km: dist,
        data: new Date().toLocaleDateString('pl-PL')
    }).then(() => {
        set(statsRef, earnedSoFar + zl);
        document.getElementById('route-from').value = "";
        document.getElementById('route-to').value = "";
        document.getElementById('trip-amount').value = "";
    });
};

// --- MAPA PAN & ZOOM ---
const svg = document.getElementById('svg-map');

const handleStart = (x, y) => { isDragging = true; lastPos = { x, y }; };
const handleMove = (x, y) => {
    if(!isDragging) return;
    const dx = (x - lastPos.x) * (viewbox.w / svg.clientWidth);
    const dy = (y - lastPos.y) * (viewbox.h / svg.clientHeight);
    viewbox.x -= dx; viewbox.y -= dy;
    svg.setAttribute('viewBox', `${viewbox.x} ${viewbox.y} ${viewbox.w} ${viewbox.h}`);
    lastPos = { x, y };
};

svg.addEventListener('mousedown', e => handleStart(e.clientX, e.clientY));
window.addEventListener('mousemove', e => handleMove(e.clientX, e.clientY));
window.addEventListener('mouseup', () => isDragging = false);

svg.addEventListener('touchstart', e => handleStart(e.touches[0].clientX, e.touches[0].clientY), {passive:false});
svg.addEventListener('touchmove', e => {
    handleMove(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
}, {passive:false});

function renderMap() {
    svg.innerHTML = "";
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    
    // Rysuj linie
    for(let k in stations) {
        const s = stations[k];
        if(s.parent && stations[s.parent]) {
            const p = stations[s.parent];
            const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
            l.setAttribute("x1", s.x); l.setAttribute("y1", s.y);
            l.setAttribute("x2", p.x); l.setAttribute("y2", p.y);
            l.classList.add('map-link');
            
            // Neonowy efekt jeśli trasa była użyta
            const used = tripsData.some(t => (t.od === k && t.do === s.parent) || (t.do === k && t.od === s.parent));
            if(used) { l.style.stroke = "#4ade80"; l.style.opacity = "1"; l.style.strokeWidth = "4"; }
            g.appendChild(l);
        }
    }

    // Rysuj kropki
    for(let k in stations) {
        const s = stations[k];
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("cx", s.x); c.setAttribute("cy", s.y); c.setAttribute("r", "5");
        c.setAttribute("fill", "#fff");
        c.setAttribute("stroke", "#6366f1");
        
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", s.x + 10); t.setAttribute("y", s.y + 4);
        t.setAttribute("fill", "#94a3b8"); t.setAttribute("font-size", "11px");
        t.textContent = k.toUpperCase();
        
        g.appendChild(c); g.appendChild(t);
    }
    svg.appendChild(g);
}

// --- RESZTA UI ---
window.saveNewStation = () => {
    const name = document.getElementById('new-st-name').value.toLowerCase().trim();
    const km = parseInt(document.getElementById('new-st-km').value);
    const x = parseInt(document.getElementById('new-st-x').value);
    const y = parseInt(document.getElementById('new-st-y').value);
    const parent = document.getElementById('new-st-parent').value.toLowerCase().trim();

    if(!name || isNaN(km)) return;
    stations[name] = { km, x, y, parent: parent || null };
    set(stationsRef, stations);
};

window.syncAllStationsToServer = () => { if(confirm("Nadpisać bazę?")) set(stationsRef, stations); };

function updateUI() {
    const p = (earnedSoFar / 150) * 100;
    document.getElementById('bar-fill').style.width = Math.min(p, 100) + "%";
    document.getElementById('percentage-label').innerText = p.toFixed(1) + "%";
    document.getElementById('earned-val').innerText = earnedSoFar.toFixed(2) + " zł";
}

function renderDataList() {
    const dl = document.getElementById('stations-list');
    dl.innerHTML = "";
    Object.keys(stations).forEach(k => {
        const o = document.createElement('option');
        o.value = k.toUpperCase();
        dl.appendChild(o);
    });
}

window.openMap = () => { document.getElementById('map-modal').classList.add('active'); renderMap(); };
window.closeMap = () => document.getElementById('map-modal').classList.remove('active');
window.openStationList = () => {
    const grid = document.getElementById('full-station-grid');
    grid.innerHTML = "";
    Object.keys(stations).sort().forEach(k => {
        grid.innerHTML += `<div class="station-card"><b>${k.toUpperCase()}</b><br>${stations[k].km} km</div>`;
    });
    document.getElementById('list-modal').classList.add('active');
};
window.closeStationList = () => document.getElementById('list-modal').classList.remove('active');