import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCqWomuAPeflvawobPGRlNIqE-7H1cU4bs",
  authDomain: "biliet.firebaseapp.com",
  databaseURL: "https://biliet-default-rtdb.europe-west1.firebasedatabase.app", // Adres ze screena
  projectId: "biliet",
  storageBucket: "biliet.firebasestorage.app",
  messagingSenderId: "739842092527",
  appId: "1:739842092527:web:0d8989e6a09b1d78ebda1a"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let earnedSoFar = 0;
const ticketPrice = 150;
const validStations = ["gdansk", "gdynia", "sopot", "wejherowo", "rumia"];

// Słuchaj zmian w chmurze na żywo
const statsRef = ref(db, 'stats/oszczednosci');
onValue(statsRef, (snapshot) => {
    const data = snapshot.val();
    if (data !== null) {
        earnedSoFar = data;
        updateUI();
    }
});

function updateUI() {
    const percent = Math.min((earnedSoFar / ticketPrice) * 100, 100).toFixed(1);
    document.getElementById('bar-fill').style.width = percent + "%";
    document.getElementById('progress-text').innerText = `${percent}% (${earnedSoFar} zł / ${ticketPrice} zł)`;
}

window.checkStation = function() {
    const input = document.getElementById('station-input').value.toLowerCase();
    const msg = document.getElementById('result-msg');
    
    if (validStations.includes(input)) {
        msg.innerText = "✅ Stacja OK! Dodaję 10zł.";
        msg.style.color = "green";
        earnedSoFar += 10;
        
        // WYSYŁKA DO CHMURY
        set(ref(db, 'stats/oszczednosci'), earnedSoFar);
        
    } else {
        msg.innerText = "❌ Płatne poza biletem!";
        msg.style.color = "red";
    }
    updateUI();
}