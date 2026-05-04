import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// 1. Konfiguracja Firebase (Twoje dane)
const firebaseConfig = {
    apiKey: "AIzaSyCqWomuAPeflvawobPGRlNIqE-7H1cU4bs",
    authDomain: "biliet.firebaseapp.com",
    databaseURL: "https://biliet-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "biliet",
    storageBucket: "biliet.firebasestorage.app",
    messagingSenderId: "739842092527",
    appId: "1:739842092527:web:0d8989e6a09b1d78ebda1a"
};

// 2. Inicjalizacja
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const statsRef = ref(db, 'stats/oszczednosci');

// 3. Stan aplikacji i dane taryfowe
let earnedSoFar = 0;
const ticketPrice = 150;

// Odległości od Gdańska Głównego (km) - baza dla taryfy
const distanceMap = {
    "gdansk": 0, "gdańsk": 0, "oliwa": 7, "sopot": 12, "gdynia": 21, 
    "rumia": 28, "reda": 32, "wejherowo": 44, "tczew": 32, "pruszcz": 10,
    "cieplewo": 15, "pszczolki": 20, "malbork": 50
};

// 4. Funkcja wyliczająca cenę wg Taryfy Pomorskiej (jednorazowe)
function calculateFare(dist) {
    if (dist <= 5) return 4.80;
    if (dist <= 10) return 5.80;
    if (dist <= 15) return 7.40;
    if (dist <= 20) return 8.60;
    if (dist <= 30) return 10.80;
    if (dist <= 40) return 13.00;
    if (dist <= 50) return 15.20;
    return 18.00; // Powyżej 50km
}

// 5. Synchronizacja z chmurą w czasie rzeczywistym
onValue(statsRef, (snapshot) => {
    earnedSoFar = snapshot.val() || 0;
    updateUI();
});

// 6. Aktualizacja Interfejsu
function updateUI() {
    const rawPercent = (earnedSoFar / ticketPrice) * 100;
    const barWidth = Math.min(rawPercent, 100); // Pasek wizualnie staje na 100
    
    const bar = document.getElementById('bar-fill');
    const label = document.getElementById('percentage-label');
    const earnedLabel = document.getElementById('earned-val');

    if (bar) {
        bar.style.width = barWidth + "%";
        // Zmień kolor na zielony jeśli zarobiliśmy na bilet (zysk)
        if (rawPercent >= 100) {
            bar.style.background = "linear-gradient(90deg, #22c55e, #10b981)";
        }
    }

    if (label) label.innerText = rawPercent.toFixed(1) + "%";
    if (earnedLabel) earnedLabel.innerText = earnedSoFar.toFixed(2) + " zł";
}

// 7. Funkcje eksportowane do WINDOW (dla przycisków HTML)

// Sprawdzanie stacji i automatyczne wpisanie kwoty
window.checkStation = function() {
    const input = document.getElementById('station-input').value.toLowerCase().trim();
    const msg = document.getElementById('result-msg');
    const amountInput = document.getElementById('trip-amount');
    
    let found = false;
    for (let key in distanceMap) {
        if (input.includes(key)) {
            const km = distanceMap[key];
            const cena = calculateFare(km);
            msg.innerText = `✅ Zasięg OK! ~${km}km | Cena: ${cena.toFixed(2)} zł`;
            msg.style.color = "#4ade80";
            amountInput.value = cena.toFixed(2);
            found = true;
            break;
        }
    }

    if (!found) {
        msg.innerText = "❌ Nie znam tej stacji. Wpisz kwotę ręcznie.";
        msg.style.color = "#f87171";
    }
};

// Dodawanie przejazdu do bazy i do listy historii
window.addNewTripFull = function() {
    const nr = document.getElementById('train-nr').value || "B/N";
    const trasa = document.getElementById('route-name').value || "Trasa nieznana";
    const kwota = parseFloat(document.getElementById('trip-amount').value);

    if (isNaN(kwota) || kwota <= 0) {
        alert("Wpisz poprawną kwotę przejazdu!");
        return;
    }

    const newValue = earnedSoFar + kwota;

    // 1. Zapis do Firebase
    set(statsRef, newValue).then(() => {
        // 2. Dodanie do listy historii na stronie
        const historyList = document.getElementById('history-list');
        const newItem = document.createElement('div');
        newItem.className = 'history-item';
        newItem.innerHTML = `
            <div>
                <strong>${nr}</strong><br>
                <small>${trasa}</small>
            </div>
            <div style="font-weight: bold; color: #4ade80;">+${kwota.toFixed(2)} zł</div>
        `;
        
        // Jeśli był komunikat "Oczekiwanie...", usuń go
        if (historyList.innerText.includes("Oczekiwanie")) historyList.innerHTML = "";
        
        historyList.prepend(newItem); // Dodaj na początek listy

        // 3. Czyścimy formularz
        document.getElementById('train-nr').value = "";
        document.getElementById('route-name').value = "";
        document.getElementById('trip-amount').value = "";
        document.getElementById('result-msg').innerText = "✅ Przejazd doliczony!";
    }).catch(err => {
        console.error("Błąd zapisu:", err);
        alert("Błąd połączenia z bazą!");
    });
};

// Pokazywanie listy obsługiwanych stacji
window.toggleStationList = function() {
    const list = document.getElementById('full-station-list');
    if (list.style.display === 'none') {
        list.style.display = 'block';
        list.innerText = "Obsługiwane: " + Object.keys(distanceMap).join(", ");
    } else {
        list.style.display = 'none';
    }
};

console.log("System biletowy gotowy do drogi!");