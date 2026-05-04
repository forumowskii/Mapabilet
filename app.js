import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// TWOJA KONFIGURACJA (wklej swoją tutaj)
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

let earnedSoFar = 0;
const ticketPrice = 150;
const validStations = ["gdansk", "gdynia", "sopot", "wejherowo", "rumia", "reda"];

// Synchronizacja z bazą w czasie rzeczywistym
const statsRef = ref(db, 'stats/oszczednosci');
onValue(statsRef, (snapshot) => {
    const data = snapshot.val();
    earnedSoFar = data || 0;
    updateUI();
});

function updateUI() {
    const percent = Math.min((earnedSoFar / ticketPrice) * 100, 100).toFixed(1);
    document.getElementById('bar-fill').style.width = percent + "%";
    document.getElementById('progress-text').innerText = `${percent}% (${earnedSoFar} zł / ${ticketPrice} zł)`;
}

// TYLKO SPRAWDZANIE
window.checkStation = function() {
    const input = document.getElementById('station-input').value.toLowerCase().trim();
    const msg = document.getElementById('result-msg');
    
    if (input === "") return;

    if (validStations.includes(input)) {
        msg.innerText = "✅ Ta stacja JEST w Twoim bilecie!";
        msg.style.background = "rgba(34, 197, 94, 0.2)";
        msg.style.color = "#4ade80";
    } else {
        msg.innerText = "⚠️ Poza zasięgiem - musisz kupić bilet!";
        msg.style.background = "rgba(239, 68, 68, 0.2)";
        msg.style.color = "#f87171";
    }
}

// DODAWANIE DO LICZNIKA I BAZY
window.addNewTrip = function() {
    const value = parseFloat(document.getElementById('trip-value').value);
    
    if (isNaN(value) || value <= 0) return;

    earnedSoFar += value;
    
    // Wysyłka do Firebase
    set(ref(db, 'stats/oszczednosci'), earnedSoFar)
    .then(() => {
        const msg = document.getElementById('result-msg');
        msg.innerText = `💰 Doliczono ${value} zł do zwrotu!`;
        msg.style.background = "rgba(99, 102, 241, 0.2)";
        msg.style.color = "#818cf8";
    });
}