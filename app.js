import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import PhotoSwipeLightbox from 'https://unpkg.com/photoswipe@5.4.3/dist/photoswipe-lightbox.esm.js';

// --- KONFIGURACJA ---
// --- LOGOWANIE DO TAJNEJ KONSOLI ---
const originalLog = console.log;
const originalError = console.error;
const secretConsole = () => document.getElementById('secret-console');

console.log = (...args) => {
    originalLog(...args);
    const consoleElem = secretConsole();
    if (consoleElem) {
        const line = document.createElement('div');
        line.innerText = `[LOG] ${args.join(' ')}`;
        consoleElem.appendChild(line);
        consoleElem.scrollTop = consoleElem.scrollHeight;
    }
};

console.error = (...args) => {
    originalError(...args);
    const consoleElem = secretConsole();
    if (consoleElem) {
        const line = document.createElement('div');
        line.style.color = '#ff5555';
        line.innerText = `[ERR] ${args.join(' ')}`;
        consoleElem.appendChild(line);
        consoleElem.scrollTop = consoleElem.scrollHeight;
    }
};

// Logowanie początkowe
console.log("System RegioPomorskie zainicjowany...");

import { firebaseConfig } from './firebase-secrets.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const statsRef = ref(db, 'stats/oszczednosci');
const tripsRef = ref(db, 'stats/przejazdy');
const stationsRef = ref(db, 'stats/stacje_siec');
const schematyRef = ref(db, 'stats/schematy');
const ticketRef = ref(db, 'stats/bilet_miesieczny');
const configRef = ref(db, 'stats/config');

let earnedSoFar = 0;
let stations = {};
let tripsData = [];
let galleryData = [];
let gridActive = false;
let busClicks = 0;
let isAdminUnlocked = false;
let storedPassword = null;

// Stany Zoomu (Domyślnie wyśrodkowane na system komunikacyjny)
let mapState = { x: 50, y: 50, scale: 0.8 };
let heatState = { x: 50, y: 50, scale: 0.8 };

// Taryfa 2026
const taryfa = [
    {max: 6, cena: 7.00}, {max: 12, cena: 8.00}, {max: 18, cena: 9.00},
    {max: 24, cena: 11.00}, {max: 30, cena: 12.00}, {max: 40, cena: 14.00},
    {max: 50, cena: 16.00}, {max: 60, cena: 18.00}, {max: 70, cena: 20.00},
    {max: 80, cena: 22.00}, {max: 90, cena: 24.00}, {max: 100, cena: 26.00}
];

// --- SYNCHRONIZACJA FIREBASE ---
onValue(statsRef, (s) => { earnedSoFar = s.val() || 0; updateProgressUI(); });
onValue(configRef, (s) => { 
    if (s.exists()) {
        storedPassword = s.val().password;
    }
});
onValue(stationsRef, (s) => { 
    let rawStations = s.val() || {}; 
    
    // Normalizacja kluczy na małe litery i obsługa tablicy
    stations = {};
    const adminStationsList = document.getElementById('admin-stations-list');
    if (adminStationsList) adminStationsList.innerHTML = "";

    if (Array.isArray(rawStations)) {
        rawStations.forEach((val, idx) => { 
            if(val) {
                const key = idx.toString();
                stations[key] = val; 
                if (adminStationsList) appendAdminStationItem(adminStationsList, key, val);
            }
        });
    } else {
        Object.keys(rawStations).forEach(key => {
            const normalizedKey = key.toLowerCase().trim();
            stations[normalizedKey] = rawStations[key];
            if (adminStationsList) appendAdminStationItem(adminStationsList, key, rawStations[key]);
        });
    }

    updateDatalists(); 
    
    const count = Object.keys(stations).length;
    const badge = document.getElementById('station-count-badge');
    if (badge) {
        badge.innerText = `STACJE: ${count}`;
    }
});

function appendAdminStationItem(container, key, data) {
    const div = document.createElement('div');
    div.style.cssText = "display:flex; flex-direction:column; gap:5px; background:rgba(255,255,255,0.05); padding:10px; border-radius:10px; font-size:12px; border-left: 3px solid #fbbf24;";
    div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <b style="color:#fbbf24">${key.toUpperCase()}</b>
            <div style="display:flex; gap:5px;">
                <button onclick="window.editStationName('${key}')" style="width:auto; padding:3px 8px; background:#475569; font-size:9px;">EDYTUJ</button>
                <button onclick="window.deleteStation('${key}')" style="width:auto; padding:3px 8px; background:var(--danger); font-size:9px;">USUŃ</button>
            </div>
        </div>
        <div style="opacity:0.7">KM: ${data.km} | Parent: ${data.parent || 'BRAK'} | X: ${data.x}, Y: ${data.y}</div>
    `;
    container.appendChild(div);
}

window.editStationName = (key) => {
    const oldData = stations[key.toLowerCase().trim()];
    const newName = prompt("Wpisz nową nazwę dla stacji (klucz):", key);
    const newKm = prompt("Wpisz kilometry (KM):", oldData.km);
    const newParent = prompt("Wpisz nazwę stacji nadrzędnej (parent):", oldData.parent || "");

    if (newName) {
        const normalizedNewName = newName.toLowerCase().trim();
        const updatedData = {
            ...oldData,
            km: parseFloat(newKm) || 0,
            parent: newParent ? newParent.toLowerCase().trim() : null
        };

        // 1. Zapisz nowe dane stacji
        set(ref(db, `stats/stacje_siec/${normalizedNewName}`), updatedData).then(() => {
            // 2. Jeśli nazwa się zmieniła, usuń starą stację i zaktualizuj dzieci
            if (normalizedNewName !== key.toLowerCase().trim()) {
                remove(ref(db, `stats/stacje_siec/${key}`));
                
                // Aktualizacja wszystkich stacji, które miały tę stację jako parent
                Object.keys(stations).forEach(sKey => {
                    if (stations[sKey].parent === key.toLowerCase().trim()) {
                        set(ref(db, `stats/stacje_siec/${sKey}/parent`), normalizedNewName);
                    }
                });
            }
            alert("Dane stacji zaktualizowane! ✅");
        });
    }
};

window.deleteStation = (key) => {
    if (confirm(`Czy na pewno chcesz trwale usunąć stację ${key.toUpperCase()}?`)) {
        remove(ref(db, `stats/stacje_siec/${key}`)).then(() => alert("Stacja usunięta."));
    }
};
onValue(schematyRef, (s) => {
    galleryData = [];
    const list = document.getElementById('gallery-list');
    const adminList = document.getElementById('admin-gallery-list');
    
    list.innerHTML = "";
    if (adminList) adminList.innerHTML = "";

    if(s.exists()) {
        s.forEach(child => {
            const item = child.val();
            const key = child.key;
            galleryData.push({ ...item, key: key });
            const idx = galleryData.length - 1;
            
            // 1. Widok dla użytkownika
            const div = document.createElement('div');
            div.className = 'gallery-item';
            if (item.src) {
                div.innerHTML = `
                    <div style="font-weight:600; margin-bottom:10px; color:var(--accent); display:flex; justify-content:space-between; align-items:center;">
                        <span>${item.title || 'Bez tytułu'}</span>
                    </div>
                    <img src="${item.src}" class="schemat-thumb" onclick="window.fullView(${idx})" alt="${item.title}">
                `;
            } else {
                div.className = 'text-note-item';
                const isLink = item.title.trim().startsWith('http://') || item.title.trim().startsWith('https://');
                if (isLink) {
                    const linkUrl = item.title.trim();
                    div.innerHTML = `
                        <div onclick="window.open('${linkUrl}', '_blank')" style="cursor: pointer; width: 100%;">
                            <i class="fa-solid fa-link" style="margin-right: 10px; color: var(--accent);"></i>
                            <b>${item.title}</b>
                        </div>
                    `;
                } else {
                    div.innerHTML = `<b>${item.title}</b>`;
                }
            }
            list.appendChild(div);

            // 2. Widok dla admina (do usuwania)
            if (adminList) {
                const adminDiv = document.createElement('div');
                adminDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px; border-radius:10px; font-size:12px;";
                adminDiv.innerHTML = `
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px;">${item.title}</span>
                    <button onclick="window.deleteGalleryItem('${key}')" style="width:auto; padding:5px 10px; background:var(--danger); font-size:10px;">USUŃ</button>
                `;
                adminList.appendChild(adminDiv);
            }
        });
    } else {
        list.innerHTML = '<p style="text-align:center; opacity:0.5;">Brak schematów w bazie.</p>';
        if (adminList) adminList.innerHTML = '<p style="text-align:center; opacity:0.5; font-size:11px;">Baza pusta.</p>';
    }
});
onValue(tripsRef, (s) => {
    tripsData = [];
    const list = document.getElementById('history-list');
    const tableBody = document.getElementById('full-history-table-body');
    const adminTripsList = document.getElementById('admin-trips-list');
    
    if (list) list.innerHTML = "";
    if (tableBody) tableBody.innerHTML = "";
    if (adminTripsList) adminTripsList.innerHTML = "";

    if(s.exists()) {
        s.forEach(child => {
            const t = child.val();
            const key = child.key;
            tripsData.push({ ...t, key: key });
        });

        // 1. Pełna tabela (wszystkie)
        tripsData.slice().reverse().forEach(t => {
            if (tableBody) {
                const row = `
                    <tr>
                        <td>${t.data}</td>
                        <td>${t.nr || '---'}</td>
                        <td>${t.od.toUpperCase()}</td>
                        <td>${t.do.toUpperCase()}</td>
                        <td style="color:var(--success); font-weight:900">${t.zl.toFixed(2)} zł</td>
                    </tr>
                `;
                tableBody.innerHTML += row;
            }
        });

        // 2. Główna lista (tylko 3 ostatnie)
        tripsData.slice(-3).reverse().forEach(t => {
            if (list) {
                const div = document.createElement('div');
                div.className = 'history-item';
                div.innerHTML = `
                    <div>
                        <b style="color:#fff">${t.nr || '---'}</b> | <small>${t.data}</small><br>
                        <span>${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()}</span>
                    </div>
                    <div style="color:var(--success); font-weight:900">+${t.zl.toFixed(2)} zł</div>
                `;
                list.appendChild(div);
            }
        });

        // 3. Widok administratora (wszystkie przejazdy do edycji/usuwania)
        if (adminTripsList) {
            tripsData.slice().reverse().forEach(t => {
                const div = document.createElement('div');
                div.style.cssText = "display:flex; flex-direction:column; gap:5px; background:rgba(255,255,255,0.05); padding:10px; border-radius:10px; font-size:11px; border-left: 3px solid #f87171;";
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <b>${t.data} | ${t.nr || 'BRAK NR'}</b>
                        <div style="display:flex; gap:5px;">
                            <button onclick="window.editTrip('${t.key}')" style="width:auto; padding:3px 8px; background:#475569; font-size:9px;">EDYTUJ</button>
                            <button onclick="window.deleteTrip('${t.key}', ${t.zl})" style="width:auto; padding:3px 8px; background:var(--danger); font-size:9px;">USUŃ</button>
                        </div>
                    </div>
                    <div>${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()} | <span style="color:var(--success)">${t.zl.toFixed(2)} zł</span></div>
                `;
                adminTripsList.appendChild(div);
            });
        }
    }
    updateHotRoutesUI();
});

window.deleteTrip = (key, amount) => {
    if (confirm("Czy na pewno chcesz usunąć ten przejazd? Spowoduje to również odjęcie kwoty od łącznego zysku.")) {
        remove(ref(db, `stats/przejazdy/${key}`)).then(() => {
            set(statsRef, earnedSoFar - amount);
            alert("Przejazd usunięty. ✅");
        });
    }
};

window.editTrip = (key) => {
    const trip = tripsData.find(t => t.key === key);
    if (!trip) return;

    const newNr = prompt("Numer pociągu:", trip.nr || "");
    const newData = prompt("Data (DD.MM.RRRR):", trip.data);
    const newOd = prompt("Stacja początkowa:", trip.od.toUpperCase());
    const newDo = prompt("Stacja końcowa:", trip.do.toUpperCase());
    const newZl = prompt("Cena (zł):", trip.zl);

    if (newData && newOd && newDo && newZl) {
        const oldZl = parseFloat(trip.zl);
        const updatedZl = parseFloat(newZl);
        
        const updatedTrip = {
            ...trip,
            nr: newNr,
            data: newData,
            od: newOd.toLowerCase().trim(),
            do: newDo.toLowerCase().trim(),
            zl: updatedZl
        };
        delete updatedTrip.key; // Usuwamy klucz pomocniczy przed zapisem

        set(ref(db, `stats/przejazdy/${key}`), updatedTrip).then(() => {
            // Aktualizacja łącznego zysku
            if (oldZl !== updatedZl) {
                set(statsRef, earnedSoFar - oldZl + updatedZl);
            }
            alert("Przejazd zaktualizowany! ✅");
        });
    }
};

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

const getHeatColor = (count) => {
    if (count === 0) return "#475569";
    if (count < 5) return "#facc15"; // Żółty
    if (count < 20) return "#f97316"; // Pomarańczowy
    return "#ef4444"; // Czerwony
};

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
            const od = t.od.toLowerCase().trim();
            const d = t.do.toLowerCase().trim();
            const pathSegments = findPath(od, d);
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
                line.style.stroke = getHeatColor(count);
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
    const f = document.getElementById('route-from').value.toLowerCase().trim();
    const t = document.getElementById('route-to').value.toLowerCase().trim();
    const d = parseFloat(document.getElementById('discount-select').value);
    
    if(!f || !t) return alert("Wpisz lub wybierz stację początkową i końcową!");
    if(!stations[f] || !stations[t]) return alert("Błąd: Jedna z wpisanych stacji nie istnieje w bazie!");
    
    const dist = Math.abs(stations[f].km - stations[t].km);
    const p = taryfa.find(r => dist <= r.max) || {cena: 30};
    const final = p.cena * (1 - d);
    
    document.getElementById('trip-amount').value = final.toFixed(2);
    document.getElementById('calc-info').innerText = `Dystans: ${dist} km | Baza: ${p.cena} zł`;
};

window.addNewTrip = () => {
    const f = document.getElementById('route-from').value.toLowerCase().trim();
    const t = document.getElementById('route-to').value.toLowerCase().trim();
    const zl = parseFloat(document.getElementById('trip-amount').value);
    const nr = document.getElementById('regio-num').value;
    if(!f || !t || isNaN(zl)) return alert("Uzupełnij dane przejazdu!");

    if(!stations[f] || !stations[t]) return alert("Błąd: Jedna z wpisanych stacji nie istnieje w bazie!");

    push(tripsRef, {
        od: f, do: t, zl: zl, nr: nr,
        data: new Date().toLocaleDateString('pl-PL')
    }).then(() => {
        set(statsRef, earnedSoFar + zl);
        // Resetowanie pól po dodaniu
        document.getElementById('route-from').value = "";
        document.getElementById('route-to').value = "";
        document.getElementById('trip-amount').value = "";
        document.getElementById('regio-num').value = "";
    });
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

window.deleteGalleryItem = (key) => {
    if (confirm("Czy na pewno chcesz usunąć ten element z galerii?")) {
        const itemRef = ref(db, `stats/schematy/${key}`);
        remove(itemRef).then(() => {
            console.log(`Usunięto element: ${key}`);
        }).catch(e => {
            console.error("Błąd podczas usuwania:", e);
            alert("Błąd podczas usuwania elementu.");
        });
    }
};

window.addNewGalleryItem = () => {
    const title = document.getElementById('new-gallery-title').value;
    const src = document.getElementById('new-gallery-src').value;
    if(!title) return alert("Podaj chociaż tytuł lub tekst!");
    
    const newItem = { 
        title: title, 
        src: src || null,
        w: 1600,
        h: 2000 
    };
    
    push(schematyRef, newItem).then(() => {
        document.getElementById('new-gallery-title').value = "";
        document.getElementById('new-gallery-src').value = "";
        window.toggleGalleryEditor(); // Zamknij po dodaniu
    });
};

window.toggleGalleryEditor = () => {
    const panel = document.getElementById('gallery-editor-panel');
    const btn = document.getElementById('gallery-edit-btn');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        btn.innerText = "❌ ANULUJ";
        btn.style.background = "var(--danger)";
    } else {
        panel.style.display = 'none';
        btn.innerText = "🛠️ EDYTOR";
        btn.style.background = "var(--accent)";
    }
};

// --- SEKRETNY PANEL ---
window.handleBusClick = () => {
    if (isAdminUnlocked) {
        window.openSecretPanel();
        return;
    }
    
    busClicks++;
    if (busClicks === 10) {
        busClicks = 0;
        isAdminUnlocked = true;
        document.getElementById('admin-bus-trigger').classList.add('admin-active');
        window.openSecretPanel();
    }
};

window.openSecretPanel = () => {
    window.closeAllModals();
    document.getElementById('secret-modal').classList.add('active');
    
    const statusText = document.getElementById('secret-status-text');
    if (!storedPassword) {
        statusText.innerText = "Witaj w Panelu Tajnym! Wymyśl hasło, aby je zapisać:";
        document.querySelector('#secret-login-view button').innerText = "USTAW HASŁO";
    } else {
        statusText.innerText = "Wpisz hasło, aby wejść:";
        document.querySelector('#secret-login-view button').innerText = "ZALOGUJ";
    }

    // Załaduj aktualne dane biletu do pól edycji
    onValue(ticketRef, (s) => {
        if (s.exists()) {
            const data = s.val();
            document.getElementById('ticket-start-time').value = data.startTime || "";
            document.getElementById('custom-qr-data').value = data.qrData || "";
            document.getElementById('ticket-num-input').value = data.num || "ALV 000067";
            document.getElementById('ticket-phone-input').value = data.phone || "603865798";
            document.getElementById('ticket-emit-input').value = data.emit || "POLREGIO";
            document.getElementById('ticket-price-input').value = data.price || "153,00";
        }
    }, { onlyOnce: true });
};

window.checkSecretPassword = () => {
    const input = document.getElementById('secret-password-input');
    const pass = input.value;
    if (!pass) return alert("Wpisz hasło!");

    if (!storedPassword) {
        // Ustawianie hasła po raz pierwszy
        set(configRef, { password: pass }).then(() => {
            alert("Hasło zostało ustawione i zapisane w chmurze! ✅");
            window.showSecretContent();
        });
    } else {
        // Logowanie
        if (pass === storedPassword) {
            window.showSecretContent();
        } else {
            alert("Błędne hasło! ❌");
        }
    }
    input.value = "";
};

window.showSecretContent = () => {
    document.getElementById('secret-login-view').style.display = 'none';
    document.getElementById('secret-content-view').style.display = 'flex';
    
    // Załaduj statystyki
    const stationsCount = Object.keys(stations).length;
    const tripsCount = tripsData.length;
    const totalEarned = earnedSoFar.toFixed(2);
    document.getElementById('adv-stats-text').innerHTML = `
        🚀 Aktywne stacje: <b>${stationsCount}</b><br>
        📅 Wszystkie przejazdy: <b>${tripsCount}</b><br>
        💎 Łączny zysk: <b>${totalEarned} zł</b><br>
        🛰️ System: <b>RegioPomorskie PRO 2.0</b>
    `;
};

// BAJERY
window.toggleRainbowMode = (e) => {
    document.body.classList.toggle('rainbow-active');
    alert("Tęczowy tryb mapy aktywowany! 🌈");
};

window.simulateMillions = () => {
    set(statsRef, 1000000.00).then(() => {
        alert("Właśnie stałeś się milionerem! 💰💰💰");
    });
};

window.boostAnimations = () => {
    document.documentElement.style.setProperty('--transition-speed', '0.1s');
    alert("Prędkość animacji zwiększona! 🚀");
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
window.copyToClipboard = (text, element) => {
    navigator.clipboard.writeText(text).then(() => {
        const toast = document.getElementById('copy-toast');
        if (toast) {
            toast.classList.add('active');
            setTimeout(() => {
                toast.classList.remove('active');
            }, 2000);
        }
    }).catch(err => {
        console.error('Błąd kopiowania:', err);
    });
};

window.toggleMenu = () => {
    document.getElementById('side-menu').classList.toggle('active');
    document.getElementById('menu-overlay').classList.toggle('active');
};
window.closeMenu = () => {
    document.getElementById('side-menu').classList.remove('active');
    document.getElementById('menu-overlay').classList.remove('active');
};

window.setActiveMenuItem = (id) => {
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    const activeItem = document.getElementById(id);
    if (activeItem) activeItem.classList.add('active');
};

window.closeAllModals = () => {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    window.setActiveMenuItem('menu-home');
    window.closeMenu();
};

function updateProgressUI() {
    const p = Math.min((earnedSoFar / 150) * 100, 100);
    document.getElementById('bar-fill').style.width = p + "%";
    document.getElementById('percentage-label').innerText = p.toFixed(1) + "%";
    document.getElementById('earned-val').innerText = earnedSoFar.toFixed(2) + " zł";
}

function updateDatalists() {
    const dl = document.getElementById('stations-list');
    if (!dl) return;
    
    dl.innerHTML = "";
    
    Object.keys(stations).sort().forEach(k => {
        const opt = document.createElement('option');
        opt.value = k.toUpperCase();
        dl.appendChild(opt);
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
window.openMap = () => { 
    window.closeAllModals();
    document.getElementById('map-modal').classList.add('active'); 
    window.setActiveMenuItem('menu-map');
    renderBase(); 
};
window.closeMap = () => document.getElementById('map-modal').classList.remove('active');

window.openHeatmap = () => { 
    window.closeAllModals();
    document.getElementById('heatmap-modal').classList.add('active'); 
    window.setActiveMenuItem('menu-heatmap');
    renderHeat(); 
};
window.closeHeatmap = () => document.getElementById('heatmap-modal').classList.remove('active');

window.openGallery = () => { 
    window.closeAllModals();
    document.getElementById('gallery-modal').classList.add('active'); 
    window.setActiveMenuItem('menu-gallery');
};
window.closeGallery = () => document.getElementById('gallery-modal').classList.remove('active');

window.openSettings = () => { 
    window.closeAllModals();
    document.getElementById('settings-modal').classList.add('active'); 
    window.setActiveMenuItem('menu-settings');
    window.filterStations(); 
};
window.closeSettings = () => document.getElementById('settings-modal').classList.remove('active');

window.openFullHistory = () => { 
    window.closeAllModals();
    document.getElementById('history-modal').classList.add('active'); 
    window.setActiveMenuItem('menu-history');
};
window.closeFullHistory = () => document.getElementById('history-modal').classList.remove('active');

// Funkcja handleSearch została usunięta, ponieważ pola wyszukiwania zostały zastąpione polami wyboru (select).

let ticketTimerInterval = null;

window.openTariff = () => {
    window.closeAllModals();
    document.getElementById('tariff-modal').classList.add('active');
    window.setActiveMenuItem('menu-tariff');
    
    // Pobierz dane z Firebase i zaktualizuj widok
    onValue(ticketRef, (s) => {
        if (s.exists()) {
            const data = s.val();
            const start = new Date(data.startTime);
            const end = new Date(start);
            end.setMonth(end.getMonth() + 1);

            const opt = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
            document.getElementById('ticket-start-display').innerText = start.toLocaleString('pl-PL', opt);
            document.getElementById('ticket-end-display').innerText = end.toLocaleString('pl-PL', opt);
            
            // Aktualizacja pozostałych danych
            document.getElementById('ticket-num-display').innerText = data.num || 'ALV 000067';
            document.getElementById('ticket-phone-display').innerText = data.phone || '603865798';
            document.getElementById('ticket-emit-display').innerText = data.emit || 'POLREGIO';
            document.getElementById('ticket-price-display').innerText = `${data.price || '153,00'} zł`;

            if (data.qrData) {
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data.qrData)}`;
                document.getElementById('ticket-qr-img').src = qrUrl;
            }

            // Uruchom odliczanie na żywo w nagłówku
            window.updateLiveTicketTimer(end);
        }
    }, { onlyOnce: true });
};

let liveTimerInterval = null;
window.updateLiveTicketTimer = (endTime) => {
    if (liveTimerInterval) clearInterval(liveTimerInterval);
    
    const timerElem = document.getElementById('ticket-timer-top');
    
    liveTimerInterval = setInterval(() => {
        const now = new Date();
        const diff = endTime - now;
        
        if (diff <= 0) {
            timerElem.innerText = "Bilet wygasł";
            clearInterval(liveTimerInterval);
            return;
        }
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        if (days > 0) {
            timerElem.innerText = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        } else {
            timerElem.innerText = `${hours}h ${minutes}m ${seconds}s`;
        }
    }, 1000);
};

window.toggleQRView = async () => {
    const overlay = document.getElementById('qr-overlay');
    const isActive = overlay.classList.toggle('active');

    if (isActive) {
        // Próba rozjaśnienia ekranu (Wake Lock API zapobiega wygaszaniu, 
        // a symulacja jasności odbywa się przez białe tło pod kodem QR)
        try {
            if ('wakeLock' in navigator) {
                window.wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) {
            console.log("WakeLock nieobsługiwany");
        }
    } else {
        if (window.wakeLock) {
            window.wakeLock.release();
            window.wakeLock = null;
        }
    }
};

window.saveTicketData = () => {
    const startTime = document.getElementById('ticket-start-time').value;
    const qrData = document.getElementById('custom-qr-data').value;
    const num = document.getElementById('ticket-num-input').value;
    const phone = document.getElementById('ticket-phone-input').value;
    const emit = document.getElementById('ticket-emit-input').value;
    const price = document.getElementById('ticket-price-input').value;
    
    if (!startTime) return alert("Wybierz datę aktywacji!");

    set(ticketRef, {
        startTime: startTime,
        qrData: qrData,
        num: num,
        phone: phone,
        emit: emit,
        price: price,
        updatedAt: new Date().toISOString()
    }).then(() => {
        alert("Dane biletu zapisane w chmurze! ✅");
    }).catch(e => {
        console.error("Błąd zapisu biletu:", e);
        alert("Błąd podczas zapisu danych.");
    });
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
    // Bilet miesięczny - dodajemy dokładnie 1 miesiąc
    const endTime = new Date(startTime);
    endTime.setMonth(endTime.getMonth() + 1);
    
    // Formatowanie daty i godziny dla wyświetlacza "Ważny do"
    const options = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    document.getElementById('ticket-end-time-display').innerText = endTime.toLocaleString('pl-PL', options);
    
    const countdownElem = document.getElementById('ticket-countdown');
    const unitElem = document.getElementById('ticket-countdown-unit');

    ticketTimerInterval = setInterval(() => {
        const now = new Date();
        const diff = endTime - now;
        
        if (diff <= 0) {
            countdownElem.innerText = "0";
            unitElem.innerText = "dni";
            countdownElem.style.color = "var(--danger)";
            clearInterval(ticketTimerInterval);
            return;
        }
        
        const daysLeft = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hoursLeft = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutesLeft = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        if (daysLeft > 0) {
            countdownElem.innerText = daysLeft;
            unitElem.innerText = "dni";
        } else if (hoursLeft > 0) {
            countdownElem.innerText = hoursLeft;
            unitElem.innerText = "godzin";
        } else {
            countdownElem.innerText = minutesLeft;
            unitElem.innerText = "minut";
        }
        
        countdownElem.style.color = "white";
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
        alert("⚠️ UWAGA: TYMCZASOWO NIEDOSTĘPNE");
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
        const od = t.od.toLowerCase().trim();
        const d = t.do.toLowerCase().trim();
        if (od && d) {
            const k = [od, d].sort().join(' ➔ ');
            usage[k] = (usage[k] || 0) + 1;
        }
    });

    const sorted = Object.entries(usage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const list = document.getElementById('hot-routes-list');
    if (!list) return;
    list.innerHTML = sorted.length ? "" : '<p style="text-align:center; opacity:0.5; font-size:12px;">Brak danych o przejazdach.</p>';
    
    sorted.forEach(([route, count]) => {
        const color = getHeatColor(count);
        const div = document.createElement('div');
        div.style.cssText = `display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:10px 15px; border-radius:12px; border-left:4px solid ${color};`;
        div.innerHTML = `
            <span style="font-size:13px; font-weight:600; text-transform:uppercase; color:${color};">${route}</span>
            <span style="background:${color}; color:#000; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:900;">${count}x</span>
        `;
        list.appendChild(div);
    });
}

setupSVGInteractions('svg-map', mapState, renderBase);
setupSVGInteractions('svg-heatmap', heatState, renderHeat);