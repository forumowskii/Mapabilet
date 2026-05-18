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
const schematyRef = ref(db, 'stats/schematy');

let earnedSoFar = 0;
let stations = {};
let tripsData = [];
let galleryData = [];
let gridActive = false;

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
onValue(stationsRef, (s) => { 
    stations = s.val() || {}; 
    updateDatalists(); 
    document.getElementById('station-count-badge').innerText = `STACJE: ${Object.keys(stations).length}`;
});
onValue(schematyRef, (s) => {
    galleryData = [];
    const list = document.getElementById('gallery-list');
    list.innerHTML = "";
    if(s.exists()) {
        s.forEach(child => {
            const item = child.val();
            galleryData.push(item);
            const idx = galleryData.length - 1;
            const div = document.createElement('div');
            div.style.marginBottom = "20px";
            div.innerHTML = `
                <div style="font-weight:600; margin-bottom:5px; color:var(--accent); display:flex; justify-content:space-between; align-items:center;">
                    <span>${item.title || 'Bez tytułu'}</span>
                    <button onclick="window.processSchemeWithAI(event, '${item.src}')" style="width:auto; padding:5px 10px; font-size:10px; background:var(--warning); color:#000;">ANALIZUJ AI</button>
                </div>
                <img src="${item.src}" class="schemat-thumb" onclick="window.fullView(${idx})" alt="${item.title}">
            `;
            list.appendChild(div);
        });
    } else {
        list.innerHTML = '<p style="text-align:center; opacity:0.5;">Brak schematów w bazie. Dodaj pierwszy powyżej!</p>';
    }
});
onValue(tripsRef, (s) => {
    const list = document.getElementById('history-list');
    const tableBody = document.getElementById('full-history-table-body');
    list.innerHTML = "";
    tableBody.innerHTML = "";
    tripsData = [];
    if(s.exists()) {
        s.forEach(child => {
            const t = child.val();
            tripsData.push(t);
        });

        // 1. Pełna tabela (wszystkie)
        tripsData.slice().reverse().forEach(t => {
            const row = `
                <tr>
                    <td>${t.data}</td>
                    <td>R ${t.nr || '---'}</td>
                    <td>${t.od.toUpperCase()}</td>
                    <td>${t.do.toUpperCase()}</td>
                    <td style="color:var(--success); font-weight:900">${t.zl.toFixed(2)} zł</td>
                </tr>
            `;
            tableBody.innerHTML += row;
        });

        // 2. Główna lista (tylko 3 ostatnie)
        tripsData.slice(-3).reverse().forEach(t => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div>
                    <b style="color:#fff">R ${t.nr || '---'}</b> | <small>${t.data}</small><br>
                    <span>${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()}</span>
                </div>
                <div style="color:var(--success); font-weight:900">+${t.zl.toFixed(2)} zł</div>
            `;
            list.appendChild(div);
        });
    }
});

// --- SYSTEM ZOOM & PAN ---
function setupSVGInteractions(svgId, state, renderFn) {
    const svg = document.getElementById(svgId);
    let dragging = false;
    let lastPos = { x: 0, y: 0 };
    let initialDist = 0;
    let initialScale = 1;

    svg.addEventListener('wheel', e => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        state.scale *= factor;
        renderFn();
    });

    const getDist = (touches) => Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);

    const start = (x, y, touches) => {
        dragging = true;
        if (touches && touches.length === 2) {
            initialDist = getDist(touches);
            initialScale = state.scale;
        } else {
            lastPos = { x: x - state.x, y: y - state.y };
        }
    };

    const move = (x, y, touches) => {
        if (!dragging) return;
        if (touches && touches.length === 2) {
            const currentDist = getDist(touches);
            state.scale = initialScale * (currentDist / initialDist);
            renderFn();
        } else if (touches && touches.length === 1) {
            state.x = touches[0].clientX - lastPos.x;
            state.y = touches[0].clientY - lastPos.y;
            renderFn();
        } else {
            state.x = x - lastPos.x;
            state.y = y - lastPos.y;
            renderFn();
        }
    };

    const stop = () => dragging = false;

    svg.addEventListener('mousedown', e => start(e.clientX, e.clientY));
    window.addEventListener('mousemove', e => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', stop);

    svg.addEventListener('touchstart', e => {
        if (e.touches.length === 2) {
            start(0, 0, e.touches);
        } else {
            start(e.touches[0].clientX, e.touches[0].clientY, e.touches);
        }
        e.preventDefault();
    }, {passive: false});

    svg.addEventListener('touchmove', e => {
        if (e.touches.length === 2) {
            move(0, 0, e.touches);
        } else {
            move(e.touches[0].clientX, e.touches[0].clientY, e.touches);
        }
        e.preventDefault();
    }, {passive: false});
    
    svg.addEventListener('touchend', stop);
}

// --- RENDERING MAP ---
function findPath(start, end) {
    if (!stations[start] || !stations[end]) return [];
    const getAncestors = (name) => {
        const path = [name];
        let curr = stations[name];
        while (curr && curr.parent && stations[curr.parent]) {
            path.push(curr.parent);
            curr = stations[curr.parent];
        }
        return path;
    };
    const pathA = getAncestors(start);
    const pathB = getAncestors(end);
    let lca = null;
    for (const s of pathA) { if (pathB.includes(s)) { lca = s; break; } }
    if (!lca) return [];
    const segments = [];
    for (let i = 0; i < pathA.indexOf(lca); i++) segments.push([pathA[i], pathA[i+1]]);
    const toEnd = pathB.slice(0, pathB.indexOf(lca) + 1).reverse();
    for (let i = 0; i < toEnd.length - 1; i++) segments.push([toEnd[i], toEnd[i+1]]);
    return segments;
}

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
        tripsData.forEach(t => {
            const pathSegments = findPath(t.od, t.do);
            pathSegments.forEach(seg => {
                const k = seg.sort().join('|');
                usage[k] = (usage[k] || 0) + 1;
            });
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
    const stationNames = Object.keys(stations);
    stationNames.forEach((name, index) => {
        const s = stations[name];
        
        // Optymalizacja etykiet: przy dużym oddaleniu (scale < 0.8) pokazuj tylko co drugą stację
        // Przy jeszcze większym (scale < 0.4) tylko co czwartą
        let showLabel = true;
        if (state.scale < 0.4) {
            if (index % 4 !== 0) showLabel = false;
        } else if (state.scale < 0.8) {
            if (index % 2 !== 0) showLabel = false;
        }

        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", s.x); dot.setAttribute("cy", s.y); dot.setAttribute("r", 4/state.scale);
        dot.setAttribute("fill", "#fff");
        g.appendChild(dot);

        if (showLabel) {
            const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
            txt.setAttribute("x", s.x + (8/state.scale)); txt.setAttribute("y", s.y + (4/state.scale));
            txt.setAttribute("fill", "#94a3b8"); txt.setAttribute("font-size", (10/state.scale)+"px");
            txt.textContent = name.toUpperCase();
            g.appendChild(txt);
        }
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
    if(!f || !t || isNaN(zl)) return;

    push(tripsRef, {
        od: f, do: t, zl: zl, nr: nr,
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
    set(stationsRef, stations).then(() => renderBase());
};

window.addNewGalleryItem = () => {
    const title = document.getElementById('new-gallery-title').value;
    const src = document.getElementById('new-gallery-src').value;
    if(!title || !src) return alert("Podaj tytuł i link!");
    
    push(schematyRef, { 
        title: title, 
        src: src,
        w: 1600, // Domyślne wymiary
        h: 2000 
    }).then(() => {
        document.getElementById('new-gallery-title').value = "";
        document.getElementById('new-gallery-src').value = "";
    });
};

window.processSchemeWithAI = async (e, imageUrl) => {
    const btn = e.target;
    const originalText = btn.innerText;
    btn.innerText = "Analizowanie...";
    btn.disabled = true;

    const prompt = `Przeanalizuj przesłany schemat linii kolejowych. Zidentyfikuj wszystkie kropki/węzły (stacje) oraz ich podpisy. Przypisz im współrzędne w układzie kartezjańskim dopasowanym do siatki SVG o wymiarach Width: 400, Height: 600. Zwróć czysty obiekt JSON pasujący do struktury aplikacji: {"nazwa_stacji": {"km": wartość_numeryczna, "x": liczba, "y": liczba, "parent": "nazwa_sąsiedniej_stacji_w_linii_lub_null"}}. Nie dodawaj żadnego tekstu poza JSONem.`;

    try {
        // Uwaga: Poniższy kod to szablon integracji z Google Gemini Vision API.
        // Wymaga klucza API. Możesz go uzyskać na https://aistudio.google.com/
        const API_KEY = "TWÓJ_KLUCZ_GEMINI_API"; 
        
        if (API_KEY === "TWÓJ_KLUCZ_GEMINI_API") {
            console.log("PROMPT AI:", prompt);
            alert("Funkcja AI przygotowana! Aby zadziałała, wpisz swój klucz Gemini API w app.js (linia ok. 278). Prompt został wypisany w konsoli.");
            btn.innerText = originalText;
            btn.disabled = false;
            return;
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        { inline_data: { mime_type: "image/jpeg", data: await fetch(imageUrl).then(r => r.blob()).then(b => new Promise(res => {
                            const reader = new FileReader();
                            reader.onloadend = () => res(reader.result.split(',')[1]);
                            reader.readAsDataURL(b);
                        })) }}
                    ]
                }]
            })
        });

        const data = await response.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        const cleanJson = textResponse.replace(/```json|```/g, "").trim();
        const aiStations = JSON.parse(cleanJson);

        // Połącz nowo wykryte stacje z istniejącymi
        stations = { ...stations, ...aiStations };
        set(stationsRef, stations).then(() => {
            alert("AI pomyślnie przeanalizowało schemat i dodało stacje do mapy!");
            renderBase();
        });

    } catch (e) {
        console.error("Błąd AI:", e);
        alert("Błąd podczas analizy AI. Sprawdź konsolę (możliwy błąd CORS lub brak klucza).");
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
};

// --- GALERIA PHOTOSWIPE ---
window.fullView = (index) => {
    const images = galleryData.map(img => ({
        src: img.src,
        w: img.w || 1600,
        h: img.h || 2000,
        title: img.title
    }));
    
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
window.openFullHistory = () => { window.closeMenu(); document.getElementById('history-modal').classList.add('active'); };
window.closeFullHistory = () => document.getElementById('history-modal').classList.remove('active');

window.handleSearch = (e, type) => {
    const q = e.target.value.toLowerCase();
    const resultsDiv = document.getElementById(`results-${type}`);
    resultsDiv.innerHTML = "";
    if (!q) { resultsDiv.classList.remove('active'); return; }

    const matches = Object.keys(stations).filter(n => n.includes(q)).sort();
    if (matches.length > 0) {
        resultsDiv.classList.add('active');
        matches.forEach(name => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerText = name.toUpperCase();
            div.onclick = () => {
                document.getElementById(`route-${type}`).value = name.toUpperCase();
                resultsDiv.classList.remove('active');
            };
            resultsDiv.appendChild(div);
        });
    } else {
        resultsDiv.classList.remove('active');
    }
};

let ticketTimerInterval = null;

window.openTariff = () => {
    window.closeMenu();
    document.getElementById('tariff-modal').classList.add('active');
    
    // Ustaw domyślną datę na teraz
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('ticket-start-time').value = now.toISOString().slice(0, 16);
    window.startTicketCountdown();
};

window.closeTariff = () => {
    document.getElementById('tariff-modal').classList.remove('active');
    if (ticketTimerInterval) clearInterval(ticketTimerInterval);
};

window.startTicketCountdown = () => {
    if (ticketTimerInterval) clearInterval(ticketTimerInterval);
    
    const startTimeStr = document.getElementById('ticket-start-time').value;
    if (!startTimeStr) return;
    
    const startTime = new Date(startTimeStr);
    const durationMinutes = 20; // Domyślnie 20 min
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
    
    // Formatowanie daty i godziny dla wyświetlacza "Ważny do"
    const options = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    document.getElementById('ticket-end-time-display').innerText = endTime.toLocaleString('pl-PL', options);
    
    ticketTimerInterval = setInterval(() => {
        const now = new Date();
        const diff = endTime - now;
        
        if (diff <= 0) {
            document.getElementById('ticket-countdown').innerText = "0";
            document.getElementById('ticket-countdown').style.color = "var(--danger)";
            clearInterval(ticketTimerInterval);
            return;
        }
        
        const minutesLeft = Math.ceil(diff / 60000);
        document.getElementById('ticket-countdown').innerText = minutesLeft;
        document.getElementById('ticket-countdown').style.color = "white";
    }, 1000);
};

window.updateQRCode = () => {
    const data = document.getElementById('custom-qr-data').value || "AlbatrosovaTicket2026";
    const qrImg = document.getElementById('ticket-qr-img');
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(data)}`;
};

window.adjustTicketTime = (offset) => {
    // Prosta funkcja do zmiany ceny lub czasu (na potrzeby wizualne)
    const priceElem = document.getElementById('ticket-price-val');
    let currentPrice = parseFloat(priceElem.innerText.replace(',', '.'));
    currentPrice = Math.max(0, currentPrice + (offset / 10));
    priceElem.innerText = currentPrice.toFixed(2).replace('.', ',');
};

window.toggleCityDropdown = (e) => {
    if (e) e.stopPropagation();
    document.getElementById('city-dropdown').classList.toggle('active');
};

// Zamknij dropdown przy kliknięciu poza nim
window.addEventListener('click', () => {
    const dd = document.getElementById('city-dropdown');
    if (dd && dd.classList.contains('active')) dd.classList.remove('active');
});

window.openCity = (city) => {
    if (city === 'gdansk') {
        window.open('https://www.twitch.tv', '_blank');
    }
    document.getElementById('city-dropdown').classList.remove('active');
};

window.toggleGrid = () => { gridActive = !gridActive; renderBase(); document.getElementById('grid-btn').innerText = `SIATKA: ${gridActive?'WŁ':'WYŁ'}`; };

// Init renderów
const renderBase = () => renderMapElements('svg-map', mapState, 'base');
const renderHeat = () => {
    renderMapElements('svg-heatmap', heatState, 'heat');
    updateHotRoutesUI();
};

function updateHotRoutesUI() {
    const usage = {};
    tripsData.forEach(t => {
        const pathSegments = findPath(t.od, t.do);
        pathSegments.forEach(seg => {
            const k = seg.sort().join(' ➔ ');
            usage[k] = (usage[k] || 0) + 1;
        });
    });

    const sorted = Object.entries(usage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const list = document.getElementById('hot-routes-list');
    list.innerHTML = sorted.length ? "" : '<p style="text-align:center; opacity:0.5; font-size:12px;">Brak danych o przejazdach.</p>';
    
    sorted.forEach(([route, count]) => {
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:10px 15px; border-radius:12px; border-left:3px solid var(--warning);";
        div.innerHTML = `
            <span style="font-size:13px; font-weight:600; text-transform:uppercase;">${route}</span>
            <span style="background:var(--warning); color:#000; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:900;">${count}x</span>
        `;
        list.appendChild(div);
    });
}

setupSVGInteractions('svg-map', mapState, renderBase);
setupSVGInteractions('svg-heatmap', heatState, renderHeat);