import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// KONFIGURACJA (Twoja)
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

// REFERENCJE
const statsRef = ref(db, 'stats/oszczednosci');
const tripsRef = ref(db, 'stats/przejazdy');
const stationsRef = ref(db, 'stats/stacje');

let earnedSoFar = 0;
const ticketPrice = 150;
let stationsData = {}; // Pobierane z Firebase
let tripsData = []; // Historia z bazy

// BAZOWE STACJE (Jeśli baza jest pusta, to się wgrają)
const defaultStations = {
    "tczew": 0, "pszczółki": 15, "gdańsk główny": 35, "gdańsk wrzeszcz": 40,
    "gdańsk oliwa": 43, "sopot": 47, "gdynia główna": 56, "rumia": 66, "reda": 70, "wejherowo": 79
};

// 1. POBIERANIE STACJI Z FIREBASE
onValue(stationsRef, (snapshot) => {
    if (snapshot.exists()) {
        stationsData = snapshot.val();
    } else {
        stationsData = defaultStations;
        set(stationsRef, defaultStations); // Inicjalizacja pierwszej bazy
    }
    updateDatalist();
});

// 2. POBIERANIE HISTORII I ZYSKU
onValue(statsRef, (snapshot) => {
    earnedSoFar = snapshot.val() || 0;
    updateProgressUI();
});

onValue(tripsRef, (snapshot) => {
    const list = document.getElementById('history-list');
    list.innerHTML = "";
    tripsData = [];

    if (snapshot.exists()) {
        snapshot.forEach((childSnapshot) => {
            const trip = childSnapshot.val();
            tripsData.push(trip);
            
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div>
                    <strong>${trip.od.toUpperCase()} ➔ ${trip.do.toUpperCase()}</strong><br>
                    <small style="opacity:0.7;">Pociąg: ${trip.nr} | Zniżka: ${trip.ulga}%</small>
                </div>
                <div style="font-weight: bold; color: #4ade80;">+${parseFloat(trip.kwota).toFixed(2)} zł</div>
            `;
            list.prepend(div); // Najnowsze na górze
        });
    } else {
        list.innerHTML = "<div style='opacity:0.5; text-align:center;'>Brak przejazdów w bazie</div>";
    }
});

// -- FUNKCJE UI --

function updateProgressUI() {
    const rawPercent = (earnedSoFar / ticketPrice) * 100;
    const bar = document.getElementById('bar-fill');
    if (bar) {
        bar.style.width = Math.min(rawPercent, 100) + "%";
        if (rawPercent >= 100) bar.style.background = "linear-gradient(90deg, #22c55e, #10b981)";
    }
    document.getElementById('percentage-label').innerText = rawPercent.toFixed(1) + "%";
    document.getElementById('earned-val').innerText = earnedSoFar.toFixed(2) + " zł";
}

function updateDatalist() {
    const datalist = document.getElementById('stations-list');
    datalist.innerHTML = "";
    for (let st in stationsData) {
        const option = document.createElement('option');
        // Z dużej litery dla estetyki
        option.value = st.charAt(0).toUpperCase() + st.slice(1);
        datalist.appendChild(option);
    }
}

// -- TARYFA I OBLICZENIA --

// Cennik z tabeli 2026
function getBasePrice(km) {
    if (km <= 6) return 7.00;
    if (km <= 12) return 8.00;
    if (km <= 18) return 9.00;
    if (km <= 24) return 11.00;
    if (km <= 30) return 12.00;
    if (km <= 40) return 14.00;
    if (km <= 50) return 16.00;
    if (km <= 60) return 18.00;
    if (km <= 70) return 20.00;
    return 22.00;
}

window.calculatePrice = function() {
    const from = document.getElementById('route-from').value.toLowerCase().trim();
    const to = document.getElementById('route-to').value.toLowerCase().trim();
    const discount = parseFloat(document.getElementById('discount-select').value);
    const msg = document.getElementById('calc-msg');

    if (!stationsData[from] || !stationsData[to]) {
        msg.innerText = "❌ Przynajmniej jedna stacja jest nieznana. Zobacz opcję '+ Dodaj do Taryfy'.";
        msg.style.color = "#f87171";
        return;
    }

    const distance = Math.abs(stationsData[to] - stationsData[from]);
    const basePrice = getBasePrice(distance);
    
    // Obliczanie zniżki (jak w tabeli PKP)
    let finalPrice = basePrice * (1 - discount);
    
    // Formatowanie
    document.getElementById('trip-amount').value = finalPrice.toFixed(2);
    msg.innerText = `Dystans: ~${distance} km. Cena brutto: ${finalPrice.toFixed(2)} zł`;
    msg.style.color = "#4ade80";
};

// -- DODAWANIE DO BAZY --

window.addNewTripFull = function() {
    const from = document.getElementById('route-from').value.trim();
    const to = document.getElementById('route-to').value.trim();
    const nr = document.getElementById('train-nr').value.trim() || "Regio/SKM";
    const kwota = parseFloat(document.getElementById('trip-amount').value);
    const ulgaRaw = document.getElementById('discount-select').value;
    const ulgaProc = (parseFloat(ulgaRaw) * 100).toFixed(0);

    if (!from || !to || isNaN(kwota)) {
        alert("Wypełnij pola OD, DO oraz oblicz Kwotę!");
        return;
    }

    // Dodajemy przejazd do kolekcji w Firebase
    const newTrip = {
        od: from.toLowerCase(),
        do: to.toLowerCase(),
        nr: nr,
        kwota: kwota,
        ulga: ulgaProc,
        data: new Date().toISOString()
    };

    push(tripsRef, newTrip).then(() => {
        // Aktualizujemy łączną sumę
        set(statsRef, earnedSoFar + kwota);
        
        // Czyszczenie
        document.getElementById('route-from').value = "";
        document.getElementById('route-to').value = "";
        document.getElementById('trip-amount').value = "";
        document.getElementById('calc-msg').innerText = "✅ Przejazd zapisany w chmurze!";
    });
};

window.promptAddStation = function() {
    const name = prompt("Podaj nazwę nowej stacji (np. Malbork):");
    if (!name) return;
    const km = prompt(`Podaj odległość stacji ${name} od 'punktu zero' (np. od Tczewa w km). Zobacz na mapę lub wpisz przybliżoną:`);
    if (km && !isNaN(km)) {
        const newStations = { ...stationsData };
        newStations[name.toLowerCase()] = parseInt(km);
        set(stationsRef, newStations).then(() => alert(`Stacja ${name} dodana do wspólnej bazy!`));
    }
};

// -- MAPA (HEATMAPA LINII) --

window.openMap = function() {
    document.getElementById('map-modal').classList.add('active');
    drawMap();
};

window.closeMap = function() {
    document.getElementById('map-modal').classList.remove('active');
};

function drawMap() {
    const svg = document.getElementById('svg-map');
    svg.innerHTML = ""; // Czyść

    // Wyznaczamy główne punkty na uproszczonej osi Y
    const mapNodes = [
        { id: "tczew", name: "Tczew", y: 450, x: 100 },
        { id: "gdańsk główny", name: "Gdańsk", y: 350, x: 100 },
        { id: "sopot", name: "Sopot", y: 250, x: 100 },
        { id: "gdynia główna", name: "Gdynia", y: 150, x: 100 },
        { id: "wejherowo", name: "Wejherowo", y: 50, x: 100 }
    ];

    // Budujemy liczniki połączeń
    const segments = {
        "tczew-gdańsk główny": 0,
        "gdańsk główny-sopot": 0,
        "sopot-gdynia główna": 0,
        "gdynia główna-wejherowo": 0
    };

    // Uproszczona analiza tras (czy stacja A i B zawierają się w segmencie)
    tripsData.forEach(trip => {
        // Dla uproszczenia, sprawdzamy tylko czy stacje się zgadzają z węzłami (wymagałoby to skomplikowanego routera dla każdej mniejszej stacji, więc mapujemy po nazwach)
        const trasa = `${trip.od}-${trip.do}`;
        const trasaOdwrotna = `${trip.do}-${trip.od}`;
        
        for (let key in segments) {
            if (key === trasa || key === trasaOdwrotna) {
                segments[key]++;
            }
        }
    });

    // Rysowanie Linii (Krawędzi)
    for (let i = 0; i < mapNodes.length - 1; i++) {
        const n1 = mapNodes[i];
        const n2 = mapNodes[i+1];
        const key = `${n1.id}-${n2.id}`;
        let count = segments[key] || 0;

        // Dobór koloru legendy
        let color = "#64748b"; // 0 - szary
        if (count > 0 && count < 5) color = "#f59e0b"; // 1-4 pomarańcz-żółty
        else if (count >= 5 && count < 20) color = "#ea580c"; // 5-19 pomarańcz-czerwony
        else if (count >= 20) color = "#dc2626"; // 20+ czerwony

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", n1.x);
        line.setAttribute("y1", n1.y);
        line.setAttribute("x2", n2.x);
        line.setAttribute("y2", n2.y);
        line.setAttribute("stroke", color);
        line.setAttribute("stroke-width", "8");
        line.setAttribute("stroke-linecap", "round");
        svg.appendChild(line);
    }

    // Rysowanie Węzłów (Kółka)
    mapNodes.forEach(node => {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", node.x);
        circle.setAttribute("cy", node.y);
        circle.setAttribute("r", "6");
        circle.setAttribute("fill", "white");
        svg.appendChild(circle);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", node.x + 15);
        text.setAttribute("y", node.y + 5);
        text.setAttribute("fill", "white");
        text.setAttribute("font-family", "sans-serif");
        text.setAttribute("font-size", "14");
        text.textContent = node.name;
        svg.appendChild(text);
    });
}