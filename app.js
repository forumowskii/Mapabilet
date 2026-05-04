import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import PhotoSwipeLightbox from 'https://unpkg.com/photoswipe@5.4.3/dist/photoswipe-lightbox.esm.js';

// --- KONFIGURACJA ---
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

let heatFilter = 'all';

// Stany Zoomu
let mapState = { x: 0, y: 0, scale: 1 };
let heatState = { x: 0, y: 0, scale: 1 };

// Taryfa 2026
const taryfa = [
    {max: 6, cena: 7.00}, {max: 12, cena: 8.00}, {max: 18, cena: 9.00},
    {max: 24, cena: 11.00}, {max: 30, cena: 12.00}, {max: 40, cena: 14.00},
    {max: 50, cena: 16.00}, {max: 60, cena: 18.00}, {max: 70, cena: 20.00},
    {max: 80, cena: 22.00}, {max: 90, cena: 24.00}, {max: 100, cena: 26.00}
];

// --- SYNCHRONIZACJA FIREBASE ---
onValue(statsRef, (s) => { earnedSoFar = s.val() || 0; updateProgressUI(); });
onValue(stationsRef, (s) => { stations = s.val() || {}; updateDatalists(); });
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
            div.innerHTML = `
                <div>
                    <b style="color:#fff">R ${t.nr || '---'}</b> | <small>${t.data}</small><br>
                    <span>${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()}</span>
                </div>
                <div style="color:var(--success); font-weight:900">+${t.zl.toFixed(2)} zł</div>
            `;
            list.prepend(div);
        });
    }
});

// --- SYSTEM ZOOM & PAN ---
function setupSVGInteractions(svgId, state, renderFn) {
    const svg = document.getElementById(svgId);
    let dragging = false;
    let lastPos = { x: 0, y: 0 };

    svg.addEventListener('wheel', e => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        state.scale *= factor;
        renderFn();
    });

    const start = (x, y) => { dragging = true; lastPos = { x: x - state.x, y: y - state.y }; };
    const move = (x, y) => { if(!dragging) return; state.x = x - lastPos.x; state.y = y - lastPos.y; renderFn(); };
    const stop = () => dragging = false;

    svg.addEventListener('mousedown', e => start(e.clientX, e.clientY));
    window.addEventListener('mousemove', e => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', stop);

    svg.addEventListener('touchstart', e => start(e.touches[0].clientX, e.touches[0].clientY), {passive: false});
    svg.addEventListener('touchmove', e => { move(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, {passive: false});
    svg.addEventListener('touchend', stop);
}

function buildAdjacency(stationsObj) {
    const adj = {};
    Object.keys(stationsObj).forEach(name => {
        if (!adj[name]) adj[name] = new Set();
        const s = stationsObj[name];
        if (s && s.parent && stationsObj[s.parent]) {
            if (!adj[s.parent]) adj[s.parent] = new Set();
            adj[name].add(s.parent);
            adj[s.parent].add(name);
        }
    });
    return adj;
}

function findPathStations(adj, from, to) {
    if (!from || !to) return null;
    if (from === to) return [from];
    if (!adj[from] || !adj[to]) return null;

    const q = [from];
    const prev = { [from]: null };
    let qi = 0;

    while (qi < q.length) {
        const cur = q[qi++];
        const neighbors = adj[cur];
        if (!neighbors) continue;

        for (const n of neighbors) {
            if (prev[n] !== undefined) continue;
            prev[n] = cur;
            if (n === to) {
                const path = [to];
                let p = cur;
                while (p !== null) {
                    path.push(p);
                    p = prev[p];
                }
                path.reverse();
                return path;
            }
            q.push(n);
        }
    }

    return null;
}

// --- RENDERING MAP ---
function renderMapElements(svgId, state, mode = 'base') {
    const svg = document.getElementById(svgId);
    svg.innerHTML = "";

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${state.x},${state.y}) scale(${state.scale})`);

    // 1. Grid (tylko w edytorze)
    if (mode === 'base' && gridActive) {
        for(let x=0; x<=400; x+=20) {
            for(let y=0; y<=600; y+=20) {
                const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 2/state.scale);
                c.setAttribute("fill", "rgba(255,255,255,0.15)");
                c.style.pointerEvents = "all";
                c.onmouseover = (e) => {
                    const tip = document.getElementById('coord-info');
                    tip.style.display = 'block'; tip.style.left = e.pageX+10+'px'; tip.style.top = e.pageY+10+'px';
                    tip.innerText = `X: ${x}, Y: ${y}`;
                };
                c.onmouseout = () => document.getElementById('coord-info').style.display = 'none';
                c.onclick = () => { document.getElementById('new-st-x').value = x; document.getElementById('new-st-y').value = y; };
                g.appendChild(c);
            }
        }
    }

    // 2. Połączenia (Heatmap logic)
    const usage = {};
    if(mode === 'heat') {
        const adj = buildAdjacency(stations);
        tripsData.forEach(t => {
            const tn = (t.network || 'skm');
            if (heatFilter !== 'all' && tn !== heatFilter) return;
            const path = findPathStations(adj, t.od, t.do);
            if (!path || path.length < 2) return;
            for (let i = 0; i < path.length - 1; i++) {
                const k = [path[i], path[i + 1]].sort().join('|');
                usage[k] = (usage[k] || 0) + 1;
            }
        });
    }

    Object.keys(stations).forEach(name => {
        const s = stations[name];
        if(s.parent && stations[s.parent]) {
            const p = stations[s.parent];

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", s.x); line.setAttribute("y1", s.y);
            line.setAttribute("x2", p.x); line.setAttribute("y2", p.y);

            if(mode === 'heat') {
                const count = usage[[name, s.parent].sort().join('|')] || 0;
                line.style.strokeWidth = 6; line.style.strokeLinecap = "round";
                line.style.stroke = count === 0 ? "#475569" : count < 5 ? "#facc15" : count < 20 ? "#f97316" : "#ef4444";
            } else {
                line.style.stroke = "#6366f1"; line.style.strokeWidth = 2; line.style.opacity = 0.4;
            }
            g.appendChild(line);
        }
    });

    // 3. Stacje i Etykiety
    Object.keys(stations).forEach(name => {
        const s = stations[name];
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", s.x); dot.setAttribute("cy", s.y); dot.setAttribute("r", 4/state.scale);
        dot.setAttribute("fill", "#fff");
        dot.style.pointerEvents = "all";
        if (mode === 'base') {
            dot.style.cursor = 'pointer';
            dot.onclick = () => window.pickStationForRoute(name);
        }
        
        let txt = null;
        if (state.scale >= 0.85) {
            txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
            txt.setAttribute("x", s.x + (8/state.scale)); txt.setAttribute("y", s.y + (4/state.scale));
            txt.setAttribute("fill", "#94a3b8"); txt.setAttribute("font-size", (10/state.scale)+"px");
            txt.textContent = name.toUpperCase();
        }
        
        g.appendChild(dot);
        if (txt) g.appendChild(txt);
    });

    svg.appendChild(g);
}

// --- LOGIKA BIZNESOWA ---
window.calculatePrice = () => {
    const f = document.getElementById('route-from').value.toLowerCase();
    const t = document.getElementById('route-to').value.toLowerCase();
    const d = parseFloat(document.getElementById('discount-select').value);
    if(!stations[f] || !stations[t]) return alert("Błąd stacji!");
    
    const dist = Math.abs(stations[f].km - stations[t].km);
    const p = taryfa.find(r => dist <= r.max) || {cena: 30};
    const final = p.cena * (1 - d);
    
    document.getElementById('trip-amount').value = final.toFixed(2);
    document.getElementById('calc-info').innerText = `Dystans: ${dist} km | Baza: ${p.cena} zł`;
};

window.addNewTrip = () => {
    const f = document.getElementById('route-from').value.toLowerCase();
    const t = document.getElementById('route-to').value.toLowerCase();
    const zl = parseFloat(document.getElementById('trip-amount').value);
    const nr = document.getElementById('regio-num').value;
    const networkEl = document.getElementById('network-select');
    const network = networkEl ? networkEl.value : 'skm';
    if(!f || !t || isNaN(zl)) return;

    push(tripsRef, {
        od: f, do: t, zl: zl, nr: nr,
        network: network,
        data: new Date().toLocaleDateString('pl-PL')
    }).then(() => set(statsRef, earnedSoFar + zl));
};

window.setHeatFilter = (v) => {
    heatFilter = v;
    renderHeat();
};

window.pickStationForRoute = (name) => {
    const fromEl = document.getElementById('route-from');
    const toEl = document.getElementById('route-to');
    if (!fromEl || !toEl) return;

    const n = (name || '').toUpperCase();
    const f = (fromEl.value || '').trim();
    const t = (toEl.value || '').trim();

    if (!f || (f && t)) {
        fromEl.value = n;
        toEl.value = '';
        return;
    }

    toEl.value = n;
};

window.saveNewStation = () => {
    const name = document.getElementById('new-st-name').value.toLowerCase().trim();
    const km = parseFloat(document.getElementById('new-st-km').value);
    const x = parseInt(document.getElementById('new-st-x').value);
    const y = parseInt(document.getElementById('new-st-y').value);
    const p = document.getElementById('new-st-parent').value.toLowerCase().trim();
    if(!name || isNaN(km)) return;
    stations[name] = { km, x, y, parent: p || null };
    set(stationsRef, stations).then(() => renderBase());
};

// --- GALERIA PHOTOSWIPE ---
window.fullView = (index) => {
    // Tutaj wpisz realne wymiary swoich zdjęć!
    const images = [
        { src: 'img/schemat1.jpg', w: 1600, h: 2200 },
        { src: 'img/schemat2.jpg', w: 2000, h: 1400 },
        { src: 'img/schemat3.jpg', w: 1500, h: 1500 }
    ];
    const lightbox = new PhotoSwipeLightbox({
        dataSource: images,
        index: index,
        pswpModule: () => import('https://unpkg.com/photoswipe@5.4.3/dist/photoswipe.esm.js')
    });
    lightbox.init();
    lightbox.loadAndOpen(index);
};

// --- UI / MENU ---
window.toggleMenu = () => {
    document.getElementById('side-menu').classList.toggle('active');
    document.getElementById('menu-overlay').classList.toggle('active');
};
window.closeMenu = () => {
    document.getElementById('side-menu').classList.remove('active');
    document.getElementById('menu-overlay').classList.remove('active');
};

function updateProgressUI() {
    const p = Math.min((earnedSoFar / 150) * 100, 100);
    document.getElementById('bar-fill').style.width = p + "%";
    document.getElementById('percentage-label').innerText = p.toFixed(1) + "%";
    document.getElementById('earned-val').innerText = earnedSoFar.toFixed(2) + " zł";
}

function updateDatalists() {
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
        g.innerHTML += `<div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:10px;"><b>${k.toUpperCase()}</b><br><small>${stations[k].km} km</small></div>`;
    });
};

// Sterowanie oknami
window.openMap = () => { document.getElementById('map-modal').classList.add('active'); renderBase(); };
window.closeMap = () => document.getElementById('map-modal').classList.remove('active');
window.openHeatmap = () => { document.getElementById('heatmap-modal').classList.add('active'); renderHeat(); };
window.closeHeatmap = () => document.getElementById('heatmap-modal').classList.remove('active');
window.openGallery = () => { window.closeMenu(); document.getElementById('gallery-modal').classList.add('active'); };
window.closeGallery = () => document.getElementById('gallery-modal').classList.remove('active');
window.openSettings = () => { window.closeMenu(); document.getElementById('settings-modal').classList.add('active'); window.filterStations(); };
window.closeSettings = () => document.getElementById('settings-modal').classList.remove('active');

window.toggleGrid = () => { gridActive = !gridActive; renderBase(); document.getElementById('grid-btn').innerText = `SIATKA: ${gridActive?'WŁ':'WYŁ'}`; };

// Init renderów
const renderBase = () => renderMapElements('svg-map', mapState, 'base');
const renderHeat = () => renderMapElements('svg-heatmap', heatState, 'heat');

setupSVGInteractions('svg-map', mapState, renderBase);
setupSVGInteractions('svg-heatmap', heatState, renderHeat);

function getSchematLinks() {
    try {
        const raw = localStorage.getItem('schematLinks');
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function setSchematLinks(list) {
    try {
        localStorage.setItem('schematLinks', JSON.stringify(list));
    } catch {}
}

function renderSchematLinks() {
    const host = document.getElementById('schemat-links');
    if (!host) return;
    host.innerHTML = '';
    const links = getSchematLinks();
    links.forEach((l, idx) => {
        const a = document.createElement('a');
        a.href = l.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.cssText = 'display:block;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#fff;text-decoration:none;font-weight:800;';
        a.textContent = (l.title || `LINK ${idx + 1}`).toUpperCase();
        host.appendChild(a);
    });
}

window.addSchematLink = () => {
    const titleEl = document.getElementById('new-schemat-title');
    const urlEl = document.getElementById('new-schemat-url');
    if (!titleEl || !urlEl) return;
    const title = (titleEl.value || '').trim();
    const url = (urlEl.value || '').trim();
    if (!title || !url) return;

    const links = getSchematLinks();
    links.unshift({ title, url });
    setSchematLinks(links.slice(0, 20));

    titleEl.value = '';
    urlEl.value = '';
    renderSchematLinks();
};

const _openGallery = window.openGallery;
window.openGallery = () => {
    _openGallery();
    renderSchematLinks();
};