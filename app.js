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

// Referencje
const statsRef = ref(db, 'stats/oszczednosci');
const tripsRef = ref(db, 'stats/przejazdy');
const stationsRef = ref(db, 'stats/stacje_siec');

let earnedSoFar = 0;
let stations = {};
let trips = [];

// --- TARYFA POMORSKA 2026 (Ceny brutto) ---
const taryfa = [
    {max: 6, cena: 7.00}, {max: 12, cena: 8.00}, {max: 18, cena: 9.00},
    {max: 24, cena: 11.00}, {max: 30, cena: 12.00}, {max: 40, cena: 14.00},
    {max: 50, cena: 16.00}, {max: 60, cena: 18.00}, {max: 70, cena: 20.00},
    {max: 80, cena: 22.00}, {max: 90, cena: 24.00}, {max: 100, cena: 26.00},
    {max: 120, cena: 30.00}, {max: 140, cena: 32.00}, {max: 160, cena: 34.00}
];

// --- FUNKCJA NORMALIZACJI TEKSTU (Dla błędów) ---
// Usuwa polskie znaki, spacje, zamienia u->ó itp.
const normalizeText = (text) => {
    if (!text) return "";
    return text.toLowerCase()
        .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
        .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
        .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
        .replace(/u/g, 'o') // traktujemy 'u' jak 'ó' dla błędów ort.
        .replace(/\s+/g, '') // usuwamy spacje
        .trim();
};

// Funkcja szukająca najlepszego dopasowania stacji
const findBestStation = (input) => {
    const normalizedInput = normalizeText(input);
    if (!normalizedInput) return null;

    let bestMatch = null;
    let highestScore = 0;

    for (let key in stations) {
        const normalizedKey = normalizeText(key);
        
        // 1. Dokładne dopasowanie po normalizacji
        if (normalizedKey === normalizedInput) return key;

        // 2. Prosty algorytm podobieństwa (czy jeden zawiera drugi)
        if (normalizedKey.includes(normalizedInput) || normalizedInput.includes(normalizedKey)) {
            return key; 
        }
    }
    return null;
};

// --- SYNCHRONIZACJA Z BAZĄ ---

onValue(stationsRef, (s) => {
    stations = s.exists() ? s.val() : {
        "gdańsk główny": { km: 0, x: 200, y: 350, parent: null },
        "tczew": { km: 32, x: 200, y: 550, parent: "gdańsk główny" }
    };
    renderDataList();
});

onValue(statsRef, (s) => {
    earnedSoFar = s.val() || 0;
    updateUI();
});

onValue(tripsRef, (s) => {
    trips = [];
    const list = document.getElementById('history-list');
    list.innerHTML = "";
    if(s.exists()){
        s.forEach(child => {
            const t = child.val();
            trips.push(t);
            list.innerHTML = `
                <div class="history-item">
                    <span><b>${t.od.toUpperCase()} ➔ ${t.do}</b><br>
                    <small>${t.km} km | Ulga ${t.ulga}% | ${t.data || ''}</small></span>
                    <span style="color:#4ade80; font-weight:bold;">+${parseFloat(t.zl).toFixed(2)} zł</span>
                </div>
            ` + list.innerHTML;
        });
    }
});

// --- OBSŁUGA PRZYCISKÓW ---

window.calculatePrice = function() {
    const rawFrom = document.getElementById('route-from').value;
    const rawTo = document.getElementById('route-to').value;
    const disc = parseFloat(document.getElementById('discount-select').value);
    
    const fromKey = findBestStation(rawFrom);
    const toKey = findBestStation(rawTo);
    
    if(!fromKey || !toKey) {
        document.getElementById('calc-info').innerText = "❌ Nie znaleziono stacji (sprawdź listę)";
        document.getElementById('calc-info').style.color = "#f87171";
        return;
    }

    // Wyświetlamy poprawioną nazwę w polu, żeby użytkownik widział, że system go zrozumiał
    document.getElementById('route-from').value = fromKey.charAt(0).toUpperCase() + fromKey.slice(1);
    document.getElementById('route-to').value = toKey.charAt(0).toUpperCase() + toKey.slice(1);

    const dist = Math.abs(stations[fromKey].km - stations[toKey].km);
    const row = taryfa.find(r => dist <= r.max) || {cena: 40.00};
    const final = row.cena * (1 - disc);
    
    document.getElementById('trip-amount').value = final.toFixed(2);
    document.getElementById('calc-info').innerText = `✅ Trasę rozpoznano: ${dist} km. Cena bazowa: ${row.cena.toFixed(2)} zł`;
    document.getElementById('calc-info').style.color = "#4ade80";
};

window.addNewTrip = function() {
    const od = document.getElementById('route-from').value;
    const d = document.getElementById('route-to').value;
    const zl = parseFloat(document.getElementById('trip-amount').value);
    const discProc = (parseFloat(document.getElementById('discount-select').value) * 100).toFixed(0);
    
    if(!od || !d || isNaN(zl)) return alert("Najpierw oblicz cenę!");

    const fromKey = findBestStation(od);
    const toKey = findBestStation(d);
    const dist = Math.abs(stations[fromKey].km - stations[toKey].km);

    const newTrip = {
        od: fromKey,
        do: toKey,
        zl: zl,
        km: dist,
        ulga: discProc,
        data: new Date().toLocaleDateString('pl-PL')
    };

    push(tripsRef, newTrip).then(() => {
        set(statsRef, earnedSoFar + zl);
        // Czyścimy formularz
        document.getElementById('route-from').value = "";
        document.getElementById('route-to').value = "";
        document.getElementById('trip-amount').value = "";
        document.getElementById('calc-info').innerText = "Zapisano pomyślnie!";
    });
};

// --- MAPA I EDYTOR SIECI ---

window.saveNewStation = function() {
    const name = document.getElementById('new-st-name').value.toLowerCase().trim();
    const km = parseInt(document.getElementById('new-st-km').value);
    const parent = document.getElementById('new-st-parent').value.toLowerCase().trim();
    const x = parseInt(document.getElementById('new-st-x').value);
    const y = parseInt(document.getElementById('new-st-y').value);

    if(!name || isNaN(km) || isNaN(x) || isNaN(y)) return alert("Wypełnij dane punktu!");
    
    stations[name] = { 
        km: km, 
        x: x, 
        y: y, 
        parent: parent || null 
    };

    set(stationsRef, stations).then(() => {
        alert(`Stacja ${name} dodana do systemu.`);
        renderMap();
    });
};

function renderMap() {
    const svg = document.getElementById('svg-map');
    if(!svg) return;
    svg.innerHTML = "";
    
    // 1. Rysowanie linii (połączeń)
    for(let key in stations) {
        const s = stations[key];
        if(s.parent && stations[s.parent]) {
            const p = stations[s.parent];
            
            // Liczenie natężenia na tym konkretnym odcinku
            const count = trips.filter(t => 
                (t.od === key && t.do === s.parent) || (t.do === key && t.od === s.parent)
            ).length;

            let color = "#334155"; // Domyślny szary
            let width = 3;

            if(count > 0) { color = "#f97316"; width = 4; }
            if(count >= 5) { color = "#ef4444"; width = 6; }
            if(count >= 20) { color = "#7f1d1d"; width = 10; }

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", s.x); line.setAttribute("y1", s.y);
            line.setAttribute("x2", p.x); line.setAttribute("y2", p.y);
            line.setAttribute("stroke", color);
            line.setAttribute("stroke-width", width);
            line.setAttribute("stroke-linecap", "round");
            svg.appendChild(line);
        }
    }

    // 2. Rysowanie punktów i nazw
    for(let key in stations) {
        const s = stations[key];
        
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", s.x); circle.setAttribute("cy", s.y);
        circle.setAttribute("r", "5");
        circle.setAttribute("fill", "#fff");
        svg.appendChild(circle);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", s.x + 10);
        text.setAttribute("y", s.y + 5);
        text.setAttribute("fill", "#cbd5e1");
        text.setAttribute("font-size", "11px");
        text.textContent = `${key.charAt(0).toUpperCase() + key.slice(1)} (${s.km}km)`;
        svg.appendChild(text);
    }
}

// --- POMOCNICZE UI ---

function updateUI() {
    const goal = 150;
    const progress = (earnedSoFar / goal) * 100;
    const bar = document.getElementById('bar-fill');
    if(bar) {
        bar.style.width = Math.min(progress, 100) + "%";
        if(progress >= 100) bar.style.background = "#22c55e";
    }
    document.getElementById('percentage-label').innerText = progress.toFixed(1) + "%";
    document.getElementById('earned-val').innerText = earnedSoFar.toFixed(2) + " zł";
}

function renderDataList() {
    const dl = document.getElementById('stations-list');
    if(!dl) return;
    dl.innerHTML = "";
    Object.keys(stations).forEach(k => {
        const opt = document.createElement('option');
        opt.value = k.charAt(0).toUpperCase() + k.slice(1);
        dl.appendChild(opt);
    });
}

window.openMap = () => { 
    document.getElementById('map-modal').classList.add('active'); 
    setTimeout(renderMap, 100); // Mały delay na renderowanie SVG
};
window.closeMap = () => document.getElementById('map-modal').classList.remove('active');

window.openStationList = () => {
    const grid = document.getElementById('full-station-grid');
    grid.innerHTML = "";
    Object.keys(stations).sort().forEach(k => {
        grid.innerHTML += `
            <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; border-bottom: 2px solid #6366f1;">
                <b style="color:#fff;">${k.toUpperCase()}</b><br>
                <small style="color:#94a3b8;">${stations[k].km} km od Punktu 0</small>
            </div>`;
    });
    document.getElementById('list-modal').classList.add('active');
};
window.closeStationList = () => document.getElementById('list-modal').classList.remove('active');