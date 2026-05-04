import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// 1. Konfiguracja Firebase
const firebaseConfig = {
    apiKey: "AIzaSyCqWomuAPeflvawobPGRlNIqE-7H1cU4bs",
    authDomain: "biliet.firebaseapp.com",
    databaseURL: "https://biliet-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "biliet",
    storageBucket: "biliet.firebasestorage.app",
    messagingSenderId: "739842092527",
    appId: "1:739842092527:web:0d8989e6a09b1d78ebda1a",
    measurementId: "G-CEM24B5M07"
};

// 2. Inicjalizacja
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const statsRef = ref(db, 'stats/oszczednosci');

// 3. Stan aplikacji
let earnedSoFar = 0;
const ticketPrice = 150;
const validStations = [
    "gdansk", "gdańsk", "gdansk glowny", "gdańsk główny", "gdansk oliwa", "gdańsk oliwa", 
    "gdansk wrzeszcz", "gdańsk wrzeszcz", "sopot", "gdynia", "gdynia glowna", "gdynia główna", 
    "wejherowo", "rumia", "reda", "cieplewo", "pszczolki"
];

// 4. Synchronizacja z chmurą (LIVE)
onValue(statsRef, (snapshot) => {
    const data = snapshot.val();
    earnedSoFar = data || 0;
    updateUI();
    console.log("Zsynchronizowano z Firebase:", earnedSoFar);
});

// 5. Funkcja aktualizacji interfejsu
function updateUI() {
    const percent = Math.min((earnedSoFar / ticketPrice) * 100, 100).toFixed(1);
    
    // Elementy paska i tekstu
    const bar = document.getElementById('bar-fill');
    const percentLabel = document.getElementById('percentage-label');
    const earnedLabel = document.getElementById('earned-val');

    if (bar) bar.style.width = percent + "%";
    if (percentLabel) percentLabel.innerText = percent + "%";
    if (earnedLabel) earnedLabel.innerText = earnedSoFar + " zł";
}

// 6. Eksport funkcji do WINDOW (aby HTML je widział)

// Funkcja sprawdzania stacji
window.checkStation = function() {
    const inputField = document.getElementById('station-input');
    const input = inputField.value.toLowerCase().trim();
    const msg = document.getElementById('result-msg');
    
    if (input === "") return;

    if (validStations.some(s => input.includes(s))) {
        msg.innerText = "✅ Ta stacja JEST w Twoim bilecie!";
        msg.style.background = "rgba(34, 197, 94, 0.2)";
        msg.style.color = "#4ade80";
        msg.style.border = "1px solid rgba(34, 197, 94, 0.3)";
    } else {
        msg.innerText = "⚠️ Poza zasięgiem - musisz kupić bilet!";
        msg.style.background = "rgba(239, 68, 68, 0.2)";
        msg.style.color = "#f87171";
        msg.style.border = "1px solid rgba(239, 68, 68, 0.3)";
    }
};

// Funkcja dodawania przejazdu (Twój "akcept wozu")
window.addNewTrip = function(amount) {
    const newValue = earnedSoFar + amount;
    
    // Zapis do Firebase (to automatycznie wywoła onValue i zaktualizuje UI)
    set(statsRef, newValue)
        .then(() => {
            console.log(`Pomyślnie dodano ${amount} zł`);
            // Mały efekt wizualny w komunikacie
            const msg = document.getElementById('result-msg');
            if (msg) {
                msg.innerText = `💰 Doliczono ${amount} zł!`;
                msg.style.background = "rgba(99, 102, 241, 0.2)";
                msg.style.color = "#818cf8";
            }
        })
        .catch((error) => {
            console.error("Błąd zapisu w Firebase:", error);
            alert("Błąd połączenia z bazą danych!");
        });
};

console.log("App.js załadowany pomyślnie.");