import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

let earnedSoFar = 0;
let stations = {};
let tripsData = [];

// --- TARYFA POMORSKA 2026 ---
const taryfa = [
    {max: 6, cena: 7.00}, {max: 12, cena: 8.00}, {max: 18, cena: 9.00},
    {max: 24, cena: 11.00}, {max: 30, cena: 12.00}, {max: 40, cena: 14.00},
    {max: 50, cena: 16.00}, {max: 60, cena: 18.00}, {max: 70, cena: 20.00},
    {max: 80, cena: 22.00}, {max: 90, cena: 24.00}, {max: 100, cena: 26.00},
    {max: 120, cena: 30.00}, {max: 140, cena: 32.00}, {max: 160, cena: 34.00}
];

// --- SYSTEM ROZPOZNAWANIA BŁĘDÓW (Fuzzy Matching) ---
const normalize = (text) => {
    if (!text) return "";
    return text.toLowerCase()
        .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
        .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
        .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
        .replace(/u/g, 'o') // u traktujemy jak ó dla błędów ortograficznych
        .replace(/\s+/g, '') // usuwamy spacje
        .trim();
};

const findBestStation = (input) => {
    const ni = normalize(input);
    if (!ni) return null;
    
    // Szukamy stacji, której znormalizowana nazwa pasuje do wpisanej
    return Object.keys(stations).find(key => {
        const nk = normalize(key);
        return nk === ni || nk.includes(ni) || ni.includes(nk);
    });
};

// --- SYNCHRONIZACJA DANYCH ---

onValue(stationsRef, (snapshot) => {
    if (snapshot.exists()) {
        stations = snapshot.val();
        renderDataList();
    }
});

onValue(statsRef, (snapshot) => {
    earnedSoFar = snapshot.val() || 0;
    updateUI();
});

onValue(tripsRef, (snapshot) => {
    const list = document.getElementById('history-list');
    list.innerHTML = "";
    tripsData = [];
    
    if (snapshot.exists()) {
        snapshot.forEach(child => {
            const data = child.val();
            const id = child.key;
            tripsData.push({ ...data, id });
            createSwipeItem(list, data, id);
        });
    } else {
        list.innerHTML = "<p style='text-align:center; opacity:0.5;'>Brak przejazdów w historii</p>";
    }
});

// --- LOGIKA SWIPE (Przesunięcie by usunąć) ---
function createSwipeItem(container, data, id) {
    const wrapper = document.createElement('div');
    wrapper.className = 'swipe-container';
    
    wrapper.innerHTML = `
        <div class="delete-btn" onclick="window.confirmDelete('${id}', ${data.zl})">🗑️</div>
        <div class="history-item" id="item-${id}">
            <div style="display:flex; flex-direction:column;">
                <span style="font-weight:800; font-size:14px;">${data.od.toUpperCase()} ➔ ${data.do.toUpperCase()}</span>
                <small style="opacity:0.6; font-size:11px;">${data.km} km | ${data.data || 'Brak daty'}</small>
            </div>
            <div style="text-align:right;">
                <span style="color:#4ade80; font-weight:800;">+${parseFloat(data.zl).toFixed(2)}</span>
            </div>
        </div>
    `;

    const item = wrapper.querySelector('.history-item');
    let startX = 0;
    let currentX = 0;

    // Obsługa dotyku
    item.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        item.style.transition = 'none';
    });

    item.addEventListener('touchmove', e => {
        currentX = e.touches[0].clientX - startX;
        // Reagujemy tylko na przesunięcie w lewo (by odsłonić śmietnik po prawej)
        if (currentX < 0) {
            const move = Math.max(currentX, -80);
            item.style.transform = `translateX(${move}px)`;
        }
    });

    item.addEventListener('touchend', e => {
        item.style.transition = 'transform 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)';
        if (currentX < -40) {
            item.style.transform = 'translateX(-80px)';
        } else {
            item.style.transform = 'translateX(0)';
        }
    });

    container.prepend(wrapper);
}

window.confirmDelete = (id, amount) => {
    if (confirm("Czy na pewno chcesz usunąć ten wpis z historii?")) {
        remove(ref(db, `stats/przejazdy/${id}`)).then(() => {
            set(statsRef, earnedSoFar - amount);
        });
    } else {
        const item = document.getElementById(`item-${id}`);
        if(item) item.style.transform = 'translateX(0)';
    }
};

// --- OBSŁUGA FORMULARZA ---

window.calculatePrice = function() {
    const rawFrom = document.getElementById('route-from').value;
    const rawTo = document.getElementById('route-to').value;
    const discount = parseFloat(document.getElementById('discount-select').value);
    
    const fromKey = findBestStation(rawFrom);
    const toKey = findBestStation(rawTo);
    
    if (!fromKey || !toKey) {
        alert("Nie rozpoznano stacji! Sprawdź czy nie ma błędu.");
        return;
    }

    // Korekta nazw w polach na poprawne
    document.getElementById('route-from').value = fromKey.toUpperCase();
    document.getElementById('route-to').value = toKey.toUpperCase();

    const dist = Math.abs(stations[fromKey].km - stations[toKey].km);
    const priceRow = taryfa.find(r => dist <= r.max) || { cena: 40.00 };
    const finalPrice = priceRow.cena * (1 - discount);
    
    document.getElementById('trip-amount').value = finalPrice.toFixed(2);
    document.getElementById('calc-info').innerText = `Rozpoznano trasę: ${dist} km. Cena bazowa: ${priceRow.cena.toFixed(2)} zł`;
};

window.addNewTrip = function() {
    const from = document.getElementById('route-from').value;
    const to = document.getElementById('route-to').value;
    const zl = parseFloat(document.getElementById('trip-amount').value);
    
    if (!from || !to || isNaN(zl)) {
        alert("Najpierw oblicz cenę przejazdu!");
        return;
    }

    const fromKey = findBestStation(from);
    const toKey = findBestStation(to);
    const dist = Math.abs(stations[fromKey].km - stations[toKey].km);

    const trip = {
        od: fromKey,
        do: toKey,
        zl: zl,
        km: dist,
        data: new Date().toLocaleDateString('pl-PL')
    };

    push(tripsRef, trip).then(() => {
        set(statsRef, earnedSoFar + zl);
        // Reset formularza
        document.getElementById('route-from').value = "";
        document.getElementById('route-to').value = "";
        document.getElementById('trip-amount').value = "";
        document.getElementById('calc-info').innerText = "✅ Przejazd zapisany!";
    });
};

// --- ZARZĄDZANIE STACJAMI ---

window.saveNewStation = function() {
    const name = document.getElementById('new-st-name').value.toLowerCase().trim();
    const km = parseInt(document.getElementById('new-st-km').value);
    const parent = document.getElementById('new-st-parent').value.toLowerCase().trim();
    const x = parseInt(document.getElementById('new-st-x').value);
    const y = parseInt(document.getElementById('new-st-y').value);

    if (!name || isNaN(km)) return alert("Podaj nazwę i kilometraż!");

    stations[name] = { km, x: x || 200, y: y || 300, parent: parent || null };
    set(stationsRef, stations).then(() => {
        alert("Stacja dodana do Twojej listy!");
        renderMap();
    });
};

window.syncAllStationsToServer = function() {
    if (confirm("UWAGA: To nadpisze listę stacji u wszystkich użytkowników Twoimi danymi. Kontynuować?")) {
        set(stationsRef, stations).then(() => {
            alert("Baza stacji została zaktualizowana na serwerze!");
        });
    }
};

// --- MAPA I UI ---

function renderMap() {
    const svg = document.getElementById('svg-map');
    if (!svg) return;
    svg.innerHTML = "";

    // Linie połączeń
    for (let key in stations) {
        const s = stations[key];
        if (s.parent && stations[s.parent]) {
            const p = stations[s.parent];
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", s.x); line.setAttribute("y1", s.y);
            line.setAttribute("x2", p.x); line.setAttribute("y2", p.y);
            line.setAttribute("stroke", "rgba(129, 138, 248, 0.5)");
            line.setAttribute("stroke-width", "3");
            svg.appendChild(line);
        }
    }

    // Punkty stacji
    for (let key in stations) {
        const s = stations[key];
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", s.x); circle.setAttribute("cy", s.y);
        circle.setAttribute("r", "5"); circle.setAttribute("fill", "#fff");
        
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", s.x + 8); text.setAttribute("y", s.y + 4);
        text.setAttribute("fill", "#94a3b8"); text.setAttribute("font-size", "10px");
        text.textContent = key.charAt(0).toUpperCase() + key.slice(1);

        g.appendChild(circle);
        g.appendChild(text);
        svg.appendChild(g);
    }
}

function updateUI() {
    const goal = 150;
    const progress = (earnedSoFar / goal) * 100;
    const fill = document.getElementById('bar-fill');
    if(fill) fill.style.width = Math.min(progress, 100) + "%";
    
    document.getElementById('percentage-label').innerText = progress.toFixed(1) + "%";
    document.getElementById('earned-val').innerText = earnedSoFar.toFixed(2) + " zł";
}

function renderDataList() {
    const dl = document.getElementById('stations-list');
    if (!dl) return;
    dl.innerHTML = "";
    Object.keys(stations).sort().forEach(k => {
        const opt = document.createElement('option');
        opt.value = k.toUpperCase();
        dl.appendChild(opt);
    });
}

// Globalne funkcje okien
window.openMap = () => { document.getElementById('map-modal').classList.add('active'); renderMap(); };
window.closeMap = () => document.getElementById('map-modal').classList.remove('active');
window.openStationList = () => {
    const grid = document.getElementById('full-station-grid');
    grid.innerHTML = "";
    Object.keys(stations).sort().forEach(k => {
        grid.innerHTML += `<div class="station-card"><b>${k.toUpperCase()}</b><br><small>${stations[k].km} km</small></div>`;
    });
    document.getElementById('list-modal').classList.add('active');
};
window.closeStationList = () => document.getElementById('list-modal').classList.remove('active');