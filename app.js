import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, set, push, remove, update, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import PhotoSwipeLightbox from 'https://unpkg.com/photoswipe@5.4.3/dist/photoswipe-lightbox.esm.js';

let isConnectionMode = false;
let connectionStartStation = null;
let isCurveEditMode = false;
let activeCurveId = null;

// --- ZMIENNE GLOBALNE ---
let gridActive = false;
let busClicks = 0;
let isAdminUnlocked = false; 
let isSessionAuthenticated = false; 
let isSecretPanelAuth = false; 
let storedPassword = null;
let inviteCodes = ["Albatrosowa1"];

// Sprawdzamy czy jestesmy zalogowani jako admin z lokalnego storage
isSecretPanelAuth = localStorage.getItem('isSecretPanelAuth') === 'true';
isAdminUnlocked = isSecretPanelAuth;
let isDeveloperModeActive = false;
let isDrawMode = false;
let drawPoints = [];
let maintenanceEndTime = null;
let maintenanceInterval = null;
let stationEditorBg = null;
let tempMarker = null;
let isMapVisible = true;
let showEditorBg = true;
let isForceAuthActive = false;
let globalPinSize = 6;
let globalPinColor = "#ffffff";
let globalLineWidth = 4;
let globalHeatWidth = 1.5;
let globalTextRotation = 0;
let heatLineThickness = 4;
let heatColorTheme = 'classic';
let heatMapBg = '#0f172a';
let isCalcDisabled = false;
let calcDisabledMsg = "Funkcja tymczasowo niedostępna.";
let mapBgSettings = { w: 1200, h: 1800, offX: 0, offY: 0 };
let loadTimeValue = 0;
let systemStatus = "online";
let draggedLabel = null;
let isLabelEditMode = false;
let selectedLabelForRotation = null;
let isParentSelectionMode = false;
let parentSelectionSource = null;
let newStationParentHandler = null;
let isGalleryAddModeActive = false; // NOWE: Stan dopisywania schematów
let isCalcBtnActive = false; // NOWE: Czy przycisk Oblicz KM jest widoczny
let isTariffTabVisible = true; // NOWE: Czy zakładka Cennik jest widoczna w ustawieniach bazy
let isCityRankingVisible = true; // NOWE: Czy ranking miast jest widoczny
let isGalleryTodoMode = false; // NOWE: Tryb TO DO dla galerii
let activeGalleryTab = 'schematy'; // NOWE: Aktualna zakładka galerii (schematy/todo)
let simulatedTicketId = null; // NOWE: ID symulowanego biletu


// --- KONFIGURACJA ---
const startTime = performance.now();

// NOWE: Obsługa CapsLock
function initCapsLockWarning(inputId, warningId) {
    const input = document.getElementById(inputId);
    const warning = document.getElementById(warningId);
    if (!input || !warning) return;

    input.addEventListener('keyup', (e) => {
        if (e.getModifierState('CapsLock')) {
            warning.style.display = 'block';
        } else {
            warning.style.display = 'none';
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.getModifierState('CapsLock')) {
            warning.style.display = 'block';
        } else {
            warning.style.display = 'none';
        }
    });
}

// Helper do wyciągania stacji nadrzędnych (wsparcie dla wielu oddzielonych przecinkiem)
// Zwraca listę kluczy (identyfikatorów) stacji nadrzędnych
const getParents = (s) => {
    if (!s || !s.parent) return [];
    let parentNames = [];
    if (typeof s.parent === 'string') {
        parentNames = s.parent.split(',').map(p => p.trim());
    }
    
    // Szukamy kluczy stacji pasujących do tych nazw
    const parentKeys = [];
    parentNames.forEach(pName => {
        const normP = normalizeStationName(pName);
        const foundKey = Object.keys(stations).find(k => k === pName.toLowerCase() || normalizeStationName(k) === normP);
        if (foundKey) parentKeys.push(foundKey);
    });
    return parentKeys;
};

// Helper do normalizacji nazw stacji (usuwanie polskich znaków, małe litery, trim)
const normalizeStationName = (name) => {
    if (!name) return "";
    return name.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ł/g, "l")
        .replace(/[^a-z0-9 ]/g, "")
        .trim();
};

// Helper do rozdzielania ID połączenia (obsługa nazw stacji zawierających '|')
const splitConnectionId = (id) => {
    if (!id) return [null, null];
    const parts = id.split('|');
    
    // Szukamy punktu podziału, który daje dwa istniejące klucze stacji (używając findStationKey)
    for (let i = 1; i < parts.length; i++) {
        const aName = parts.slice(0, i).join('|');
        const bName = parts.slice(i).join('|');
        
        const aKey = findStationKey(aName);
        const bKey = findStationKey(bName);
        
        if (aKey && bKey) return [aKey, bKey];
    }
    
    // Jeśli proste id.split('|') ma 2 części, sprawdź czy pasują do kluczy
    if (parts.length === 2) {
        const aKey = findStationKey(parts[0]);
        const bKey = findStationKey(parts[1]);
        if (aKey && bKey) return [aKey, bKey];
    }

    return [parts[0]?.toLowerCase() || null, parts[1]?.toLowerCase() || null]; // Fallback do starego zachowania (lowercase)
};

// --- TAGS INPUT SYSTEM ---
window.initTagsInput = (containerId, initialValue = "") => {
    const container = document.getElementById(containerId);
    if (!container) return null;

    container.style.position = 'relative'; // Dla pozycjonowania sugestii

    let tags = initialValue ? initialValue.split(',').map(t => t.trim()).filter(t => t) : [];
    let selectedSuggestionIdx = -1;
    
    // Tworzymy kontener na sugestie
    const suggestionsBox = document.createElement('div');
    suggestionsBox.className = 'tags-suggestions';
    container.appendChild(suggestionsBox);
    
    const renderTags = () => {
        const input = container.querySelector('input');
        const existingTags = container.querySelectorAll('.tag-chip');
        existingTags.forEach(t => t.remove());

        tags.forEach((tag, idx) => {
            const chip = document.createElement('div');
            chip.className = 'tag-chip';
            chip.innerHTML = `
                <span>${tag.toUpperCase()}</span>
                <i class="fa-solid fa-xmark remove-tag" onclick="event.stopPropagation(); window.removeTag('${containerId}', ${idx})"></i>
            `;
            container.insertBefore(chip, input);
        });
    };

    const updateSuggestions = (val) => {
        const q = val.toLowerCase().trim();
        suggestionsBox.innerHTML = "";
        selectedSuggestionIdx = -1;

        if (!q) {
            suggestionsBox.classList.remove('active');
            return;
        }

        const matches = Object.keys(stations)
            .filter(name => name.toLowerCase().includes(q) && !tags.includes(name.toLowerCase()))
            .sort()
            .slice(0, 10);

        if (matches.length > 0) {
            matches.forEach((name, idx) => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.innerText = name.toUpperCase();
                item.onclick = (e) => {
                    e.stopPropagation();
                    addTag(name);
                };
                suggestionsBox.appendChild(item);
            });
            suggestionsBox.classList.add('active');
        } else {
            suggestionsBox.classList.remove('active');
        }
    };

    const addTag = (val) => {
        const tag = val.toLowerCase().trim();
        if (tag && !tags.includes(tag)) {
            tags.push(tag);
            input.value = "";
            renderTags();
            suggestionsBox.classList.remove('active');
            container.dispatchEvent(new CustomEvent('change', { detail: tags }));
        }
    };

    window.removeTag = (cId, idx) => {
        if (cId !== containerId) return;
        tags.splice(idx, 1);
        renderTags();
        container.dispatchEvent(new CustomEvent('change', { detail: tags }));
    };

    const input = container.querySelector('input');
    
    input.oninput = (e) => {
        updateSuggestions(e.target.value);
    };

    input.onkeydown = (e) => {
        const items = suggestionsBox.querySelectorAll('.suggestion-item');
        
        if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedSuggestionIdx >= 0 && items[selectedSuggestionIdx]) {
                addTag(items[selectedSuggestionIdx].innerText);
            } else {
                addTag(input.value);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSuggestionIdx = Math.min(selectedSuggestionIdx + 1, items.length - 1);
            updateSelectedSuggestion(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSuggestionIdx = Math.max(selectedSuggestionIdx - 1, -1);
            updateSelectedSuggestion(items);
        } else if (e.key === 'Backspace' && !input.value && tags.length > 0) {
            tags.pop();
            renderTags();
            container.dispatchEvent(new CustomEvent('change', { detail: tags }));
        } else if (e.key === 'Escape') {
            suggestionsBox.classList.remove('active');
        }
    };

    const updateSelectedSuggestion = (items) => {
        items.forEach((item, idx) => {
            item.classList.toggle('selected', idx === selectedSuggestionIdx);
            if (idx === selectedSuggestionIdx) item.scrollIntoView({ block: 'nearest' });
        });
    };

    // Zamknij sugestie przy kliknięciu poza
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            suggestionsBox.classList.remove('active');
        }
    });

    container.onclick = () => input.focus();
    renderTags();

    return {
        getTags: () => tags,
        setTags: (newTags) => { tags = newTags; renderTags(); }
    };
};

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
    // Ukrywamy prawdziwy błąd przed zwykłym użytkownikiem w konsoli przeglądarki
    const errorCode = "36"; // Domyślny kod
    // originalError(`( KOD BŁĘDU ${errorCode} skontaktuj sie z administratorem )`);
    originalError(...args); // Pokazujemy prawdziwy błąd podczas debugowania
    
    // Ale w tajnej konsoli admina pokazujemy wszystko
    const consoleElem = secretConsole();
    if (consoleElem) {
        const line = document.createElement('div');
        line.style.color = '#ff5555';
        line.innerText = `[ERR ${errorCode}] ${args.join(' ')}`;
        consoleElem.appendChild(line);
        consoleElem.scrollTop = consoleElem.scrollHeight;
    }
};

// Logowanie początkowe
console.log("System RegioPomorskie zainicjowany...");

import { firebaseConfig } from './firebase-secrets.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// Włączanie trwałej sesji dla Firebase Auth
setPersistence(auth, browserLocalPersistence)
    .catch((error) => console.error("Persistence error:", error));

// Sprawdzanie zapisanej sesji admina (hasło bazy)
if (localStorage.getItem('adminSession') === 'active') {
    isSessionAuthenticated = true;
}

// --- LOGIKA AUTORYZACJI (LANDING PAGE) ---
let landingAuthMode = 'login'; // 'login' | 'register' | 'verify'
let landingTempData = null;

window.switchLandingTab = (mode) => {
    landingAuthMode = mode;
    const loginTab = document.getElementById('tab-login');
    const adminTab = document.getElementById('tab-admin');
    const authBtn = document.getElementById('landing-auth-btn');
    const inviteGroup = document.getElementById('landing-invite-group');
    const passGroup = document.getElementById('landing-pass-group');
    
    if (mode === 'login') {
        if (loginTab) loginTab.classList.add('active');
        if (adminTab) adminTab.classList.remove('active');
        authBtn.innerText = "WEJDŹ DO SYSTEMU";
        if (inviteGroup) inviteGroup.style.display = 'block';
        if (passGroup) passGroup.style.display = 'none';
    } else if (mode === 'admin') {
        if (loginTab) loginTab.classList.remove('active');
        if (adminTab) adminTab.classList.add('active');
        authBtn.innerText = "ZALOGUJ JAKO ADMIN";
        if (inviteGroup) inviteGroup.style.display = 'none';
        if (passGroup) passGroup.style.display = 'block';
    }
    window.resetLandingAuth();
};

window.resetLandingAuth = () => {
    const inviteGroup = document.getElementById('landing-invite-group');
    const passGroup = document.getElementById('landing-pass-group');
    const emailGroup = document.getElementById('landing-email-group');
    const codeGroup = document.getElementById('landing-code-group');
    const backBtn = document.getElementById('landing-back-btn');
    const authBtn = document.getElementById('landing-auth-btn');

    if (backBtn) backBtn.style.display = 'none';
    if (codeGroup) codeGroup.style.display = 'none';
    if (emailGroup) emailGroup.style.display = 'none';
    
    if (landingAuthMode === 'admin') {
        if (authBtn) authBtn.innerText = "ZALOGUJ JAKO ADMIN";
        if (inviteGroup) inviteGroup.style.display = 'none';
        if (passGroup) passGroup.style.display = 'block';
    } else {
        if (authBtn) authBtn.innerText = "WEJDŹ DO SYSTEMU";
        if (inviteGroup) inviteGroup.style.display = 'block';
        if (passGroup) passGroup.style.display = 'none';
    }
    
    landingTempData = null;
};

window.handleLandingAuth = async () => {
    try {
        const inviteCode = document.getElementById('landing-invite-code').value.trim();
        const password = document.getElementById('landing-password').value;

        // LOGOWANIE ADMINA (HASŁO BAZY)
        if (landingAuthMode === 'admin') {
            if (!password) return window.showToast("Wpisz hasło administratora!", "error");
            if (password === storedPassword) {
                console.log("Landing: Admin password correct, saving session.");
                isSessionAuthenticated = true;
                isAdminUnlocked = true; // PRZYWRÓCONO: Odblokowanie uprawnień admina
                localStorage.setItem('adminSession', 'active');
                renderFullHistory();
                document.getElementById('landing-page').style.display = 'none';
                document.getElementById('main-app-content').style.display = 'block';
                document.getElementById('auth-logged-in').style.display = 'flex';
                document.getElementById('user-display-email').innerText = "ADMINISTRATOR";
                window.showToast("Zalogowano jako Administrator", "success");
                updateAppVisibility();
            } else {
                window.showToast("Błędne hasło administratora!", "error");
            }
            return;
        }

        // LOGOWANIE KODEM ZAPROSZENIA
        if (landingAuthMode === 'login') {
            if (!inviteCode) return window.showToast("Wpisz kod zaproszenia!", "error");
            if (inviteCodes.includes(inviteCode)) {
                console.log("Landing: Invite code correct.");
                isSessionAuthenticated = true;
                localStorage.setItem('adminSession', 'active'); // Traktujemy to jako sesję gościa/użytkownika
                document.getElementById('landing-page').style.display = 'none';
                document.getElementById('main-app-content').style.display = 'block';
                document.getElementById('auth-logged-in').style.display = 'flex';
                document.getElementById('user-display-email').innerText = "UŻYTKOWNIK";
                window.showToast("Kod poprawny! Witaj w systemie.", "success");
                updateAppVisibility();
            } else {
                window.showToast("Błędny kod zaproszenia!", "error");
            }
            return;
        }
    } catch (err) {
        console.error("Auth error:", err);
        window.showToast("Błąd autoryzacji", "error");
    }
};


window.toggleForceAuth = () => {
    const newState = !isForceAuthActive;
    update(configRef, { isForceAuthActive: newState })
        .then(() => {
            window.showToast(newState ? "Tryb testowy ekranu startowego włączony" : "Tryb testowy wyłączony", "success");
        })
        .catch(err => {
            console.error("Błąd zapisu forceAuth:", err);
            window.showToast("Błąd uprawnień Firebase!", "error");
        });
};

window.previewLandingPage = () => {
    window.closeAllModals();
    const landing = document.getElementById('landing-page');
    const main = document.getElementById('main-app-content');
    if (landing && main) {
        landing.style.display = 'flex';
        main.style.display = 'none';
        window.showToast("Podgląd ekranu startowego aktywny", "info");
    }
};

window.toggleAuthBar = () => {
    const bar = document.getElementById('top-auth-bar');
    const trigger = document.getElementById('auth-bar-trigger');
    
    if (bar.classList.contains('collapsed')) {
        bar.classList.remove('collapsed');
        trigger.style.display = 'none';
    } else {
        bar.classList.add('collapsed');
        trigger.style.display = 'flex';
    }
};

window.handleLogout = () => {
    signOut(auth).then(() => {
        isSessionAuthenticated = false;
        isSecretPanelAuth = false;
        isAdminUnlocked = false;
        localStorage.removeItem('adminSession');
        localStorage.removeItem('isSecretPanelAuth');
        updateMenuSettingsItem();
        
        // Reset admin UI
        const busTrigger = document.getElementById('admin-bus-trigger');
        if (busTrigger) {
            busTrigger.classList.remove('admin-unlocked');
            busTrigger.classList.remove('admin-active');
            busTrigger.style.background = "";
            busTrigger.style.color = "";
        }
        const labelPanel = document.getElementById('admin-label-edit-panel');
        if (labelPanel) labelPanel.style.display = 'none';
        const floatingGui = document.getElementById('floating-admin-gui');
        if (floatingGui) {
            floatingGui.style.display = 'none';
            floatingGui.classList.remove('active');
        }
        window.showToast("Wylogowano.", "info");
    });
};

// Funkcja sterująca widocznością całej aplikacji
function updateAppVisibility() {
    const user = auth.currentUser;
    const landing = document.getElementById('landing-page');
    const main = document.getElementById('main-app-content');
    const maintenance = document.getElementById('maintenance-overlay');
    const loggedInBar = document.getElementById('auth-logged-in');
    const userEmailSpan = document.getElementById('user-display-email');

    const isAuthenticated = user || isSessionAuthenticated;
    
    // 1. Sprawdzamy czy wymuszamy logowanie
    if (isForceAuthActive && !isAuthenticated) {
        if (landing) landing.style.display = 'flex';
        if (main) main.style.display = 'none';
        if (maintenance) maintenance.classList.remove('active');
        return;
    }

    // 2. Jeśli nie wymuszamy lub jesteśmy zalogowani, sprawdzamy tryb konserwacji
    const shouldShowMaintenance = isDeveloperModeActive && !isSessionAuthenticated && !isAdminUnlocked;

    if (shouldShowMaintenance) {
        if (landing) landing.style.display = 'none';
        if (main) main.style.display = 'none'; // Przywrócono 'none' dla poprawnego działania nakładki
        if (maintenance) {
            maintenance.classList.add('active');
            startMaintenanceCountdown();
        }
    } else {
        // Pokazujemy główną aplikację
        if (landing) landing.style.display = 'none';
        if (main) main.style.display = 'block';
        if (maintenance) {
            maintenance.classList.remove('active');
            if (maintenanceInterval) clearInterval(maintenanceInterval);
        }
        
        // Aktualizacja paska logowania
        if (isAuthenticated) {
            if (loggedInBar) loggedInBar.style.display = 'flex';
            if (userEmailSpan) {
                if (user) {
                    userEmailSpan.innerText = user.email;
                } else {
                    userEmailSpan.innerText = isAdminUnlocked ? "ADMINISTRATOR" : "UŻYTKOWNIK";
                }
            }
        } else {
            if (loggedInBar) loggedInBar.style.display = 'none';
        }
    }
}

onAuthStateChanged(auth, () => {
    updateAppVisibility();
});

const statsRef = ref(db, 'stats/oszczednosci');
const tripsRef = ref(db, 'stats/przejazdy');
const stationsRef = ref(db, 'stats/stacje_siec');
const schematyRef = ref(db, 'stats/schematy');
const ticketRef = ref(db, 'stats/bilet_miesieczny');
const configRef = ref(db, 'stats/config');
const visitedCitiesRef = ref(db, 'stats/visited_cities');
const connectionsRef = ref(db, 'stats/polaczenia');
const tariffsRef = ref(db, 'stats/cenniki');
const achievementsRef = ref(db, 'stats/achievements');
const monthlyTicketsRef = ref(db, 'stats/bilety_miesieczne');

// Achievement definitions
const ACHIEVEMENT_TYPES = {
    DISTANCE: 'distance', // Kilometry (SERIA)
    IC_TRIPS: 'ic_trips', // Przejazdy IC (PRZEWOZNIK)
    PR_TRIPS: 'pr_trips', // Przejazdy PR (PRZEWOZNIK)
    SKM_TRIPS: 'skm_trips', // Przejazdy SKM (PRZEWOZNIK)
    TRIPS_TOTAL: 'trips_total', // Wszystkie przejazdy (TRASA)
    CITIES: 'cities', // Liczba miast (MIASTO)
    TOTAL_COST: 'total_cost', // Suma kosztów (CENA)
    TICKET_SAVINGS: 'ticket_savings', // Oszczędności na bilecie (CENA)
    SERIES: 'series', // Seria (SERIA)
    FULL_ROUTE: 'full_route', // Pełna trasa (PELNE)
    UNITS: 'units' // Jednostki (JEDNOSTKI)
};

// Achievement categories
const ACHIEVEMENT_CATEGORIES = [
    { value: 'SERIA', label: 'SERIA' },
    { value: 'TRASA', label: 'TRASA' },
    { value: 'PRZEWOZNIK', label: 'PRZEWOZNIK' },
    { value: 'JEDNOSTKI', label: 'JEDNOSTKI' },
    { value: 'PELNE', label: 'PEŁNE' },
    { value: 'CENA', label: 'CENA' },
    { value: 'MIASTO', label: 'MIASTO' }
];

let BADGE_LEVELS = [
    { name: 'Brąz', color: '#cd7f32' },
    { name: 'Srebro', color: '#c0c0c0' },
    { name: 'Złoto', color: '#ffd700' },
    { name: 'Diament', color: '#b9f2ff' },
    { name: 'Obsydian', color: '#0b1320' },
    { name: 'Obsydian II', color: '#050a12' },
    { name: 'Obsydian III', color: '#02050a' },
    { name: 'Max', color: '#ffffff' }
];

// Define achievement categories
let ACHIEVEMENTS = [
    {
        id: 'traveler',
        name: 'Podróżnik',
        icon: 'fa-train',
        description: 'Otrzymywana za przejechaną sumę kilometrów',
        type: ACHIEVEMENT_TYPES.DISTANCE,
        category: 'SERIA',
        levels: [
            { threshold: 10 },
            { threshold: 20 },
            { threshold: 50 },
            { threshold: 100 },
            { threshold: 200 },
            { threshold: 500 }
        ]
    },
    {
        id: 'ic_fan',
        name: 'Wierny Fan IC',
        icon: 'fa-star',
        description: 'Otrzymywana za jazdę pociągami IC',
        type: ACHIEVEMENT_TYPES.IC_TRIPS,
        category: 'PRZEWOZNIK',
        levels: [
            { threshold: 1 },
            { threshold: 2 },
            { threshold: 5 },
            { threshold: 10 },
            { threshold: 25 }
        ]
    },
    {
        id: 'pr_fan',
        name: 'Wierny Fan PR',
        icon: 'fa-mountain',
        description: 'Otrzymywana za jazdę pociągami PR',
        type: ACHIEVEMENT_TYPES.PR_TRIPS,
        category: 'PRZEWOZNIK',
        levels: [
            { threshold: 1 },
            { threshold: 2 },
            { threshold: 5 },
            { threshold: 10 },
            { threshold: 25 }
        ]
    },
    {
        id: 'skm_fan',
        name: 'Wierny Fan SKM',
        icon: 'fa-subway',
        description: 'Otrzymywana za jazdę pociągami SKM',
        type: ACHIEVEMENT_TYPES.SKM_TRIPS,
        category: 'PRZEWOZNIK',
        levels: [
            { threshold: 1 },
            { threshold: 2 },
            { threshold: 5 },
            { threshold: 10 },
            { threshold: 25 }
        ]
    },
    {
        id: 'secret_achievement',
        name: 'Tajemniczy Podróżnik',
        icon: 'fa-question',
        description: 'Oto Twoja tajna nagroda! 🎉',
        type: ACHIEVEMENT_TYPES.TOTAL_TRIPS, // Or any other type
        category: 'SERIA',
        secret: true,
        levels: [
            { threshold: 100 } // 100 total trips to unlock secret achievement
        ]
    }
];

let userAchievements = {};
let totalDistance = 0;
let totalIcTrips = 0;
let totalPrTrips = 0;
let totalSkmTrips = 0;
let totalTrips = 0; // NEW: All trips count
let uniqueCities = 0; // NEW: Unique cities visited
let totalCost = 0; // NEW: Total cost of all trips
let totalTicketSavings = 0; // NEW: Savings from monthly tickets
let ticketData = null;
let ticketExpireNotificationShown = false; // For one-time 7-day notification
let ticketExpireTimer = null;
let achievementUnlockTimer = null;
let lastAchievementCheck = {}; // To track which level we've shown notifications for
let currentHeatmapBg = '#0b0f1a'; // Client-side only, no Firebase

let earnedSoFar = 0;
let lastConfettiPercent = 0;
let lastConfettiTime = null;
let isInitialConfigLoaded = false;
let isGuiPinned = false;
let isGuiOnLeft = false;
let isRainbowModeActive = false;
let tariffsData = {
    miejska: [],
    wojewodzka: []
};
let selectedTariffType = 'miejska'; // Dodane tutaj
let isHeatTestMode = false; // NOWE: Tryb testowy heatmapy

// Funkcja konfetti
window.shootConfetti = () => {
    const container = document.getElementById('confetti-container');
    if (!container) return;

    const colors = ['#22c55e', '#15803d', '#4ade80', '#ffffff', '#fbbf24', '#3b82f6', '#ef4444', '#a855f7'];
    const corners = [
        { x: 0, y: 0 },
        { x: window.innerWidth, y: 0 },
        { x: 0, y: window.innerHeight },
        { x: window.innerWidth, y: window.innerHeight }
    ];

    corners.forEach((corner, cornerIndex) => {
        for (let i = 0; i < 40; i++) {
            const confetti = document.createElement('div');
            const size = Math.random() * 10 + 5;
            confetti.style.width = `${size}px`;
            confetti.style.height = `${size}px`;
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.opacity = Math.random() * 0.8 + 0.2;
            confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            confetti.style.position = 'absolute';
            confetti.style.left = `${corner.x}px`;
            confetti.style.top = `${corner.y}px`;
            confetti.style.pointerEvents = 'none';
            
            container.appendChild(confetti);

            let startTime = null;
            const duration = 3000 + Math.random() * 3000;
            
            const targetX = window.innerWidth / 2 + (Math.random() - 0.5) * window.innerWidth;
            const targetY = window.innerHeight / 2 + (Math.random() - 0.5) * window.innerHeight;
            const rotationSpeed = (Math.random() - 0.5) * 720;
            const swaySpeed = 2 + Math.random() * 3;
            const swayAmount = 30 + Math.random() * 50;

            const animate = (timestamp) => {
                if (!startTime) startTime = timestamp;
                const elapsed = (timestamp - startTime) / 1000;

                if (elapsed < duration) {
                    const progress = elapsed / duration;
                    const easeOut = 1 - Math.pow(1 - progress, 3);
                    const x = corner.x + (targetX - corner.x) * easeOut + Math.sin(elapsed * swaySpeed) * swayAmount;
                    const y = corner.y + (targetY - corner.y) * easeOut + Math.cos(elapsed * swaySpeed) * swayAmount * 0.5;
                    const rotation = rotationSpeed * elapsed;
                    
                    confetti.style.left = `${x}px`;
                    confetti.style.top = `${y}px`;
                    confetti.style.transform = `rotate(${rotation}deg)`;
                    confetti.style.opacity = 1 - progress;

                    requestAnimationFrame(animate);
                } else {
                    confetti.remove();
                }
            };
            
            requestAnimationFrame(animate);
        }
    });
};

// --- NOTIFICATION FUNCTIONS ---
function checkTicketExpiration() {
    if (!ticketData || !ticketData.endTime) return;

    const now = new Date();
    const endTime = ticketData.endTime;
    const diffMs = endTime - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    // Check if we should show a notification
    const shouldShowPersistent = diffDays <= 3 && diffDays > 0; // 3,2,1 days before
    const shouldShowOneTime = diffDays === 7 && !ticketExpireNotificationShown; // 7 days before, one time

    if (shouldShowPersistent || shouldShowOneTime) {
        // Format end date: dd mm yy o hh mm
        const endDateStr = endTime.toLocaleDateString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Pluralization for days
        let dayText = 'dni';
        if (diffDays === 1) {
            dayText = 'dzień';
        }

        const notificationText = `bilet kończy się za ${diffDays} ${dayText} (data zakończenia ${endDateStr.toLowerCase()})`;
        const textElem = document.getElementById('ticket-expire-text');
        if (textElem) textElem.innerText = notificationText;

        showTicketExpireNotification();

        // Mark one-time notification as shown
        if (shouldShowOneTime) {
            ticketExpireNotificationShown = true;
        }
    }
}

function showTicketExpireNotification() {
    const notificationElem = document.getElementById('ticket-expire-notification');
    const progressElem = document.getElementById('ticket-expire-progress');
    if (!notificationElem) return;

    notificationElem.style.display = 'block';

    // Animate progress bar
    if (ticketExpireTimer) clearInterval(ticketExpireTimer);
    let progress = 100;
    const duration = 4000; // 4 seconds
    const steps = 50;
    const stepTime = duration / steps;

    progressElem.style.width = '100%';
    progressElem.style.transition = 'none';
    // Force reflow
    void progressElem.offsetWidth;

    progressElem.style.transition = `width ${duration}ms linear`;
    progressElem.style.width = '0%';

    // Auto-close after 4 seconds
    ticketExpireTimer = setTimeout(() => {
        closeTicketExpireNotification();
    }, duration);
}

window.closeTicketExpireNotification = () => {
    const notificationElem = document.getElementById('ticket-expire-notification');
    if (notificationElem) notificationElem.style.display = 'none';
    if (ticketExpireTimer) {
        clearTimeout(ticketExpireTimer);
        ticketExpireTimer = null;
    }
};

function showAchievementUnlockNotification(achievement, levelIndex, level) {
    const notificationElem = document.getElementById('achievement-unlock-notification');
    const progressElem = document.getElementById('achievement-unlock-progress');
    const iconElem = document.getElementById('achievement-unlock-icon');
    const textElem = document.getElementById('achievement-unlock-text');
    if (!notificationElem) return;

    // Get Roman numeral for level (I, II, III, IV, V, VI)
    const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
    const levelRoman = romanNumerals[levelIndex] || (levelIndex + 1).toString();

    const badgeConfig = BADGE_LEVELS[levelIndex] || BADGE_LEVELS[BADGE_LEVELS.length - 1];

    // Set up notification
    notificationElem.style.background = `rgba(${hexToRgb(badgeConfig.color)}, 0.15)`;
    notificationElem.style.border = `1px solid ${badgeConfig.color}`;
    progressElem.style.background = badgeConfig.color;
    iconElem.className = `fa-solid ${achievement.icon}`;
    iconElem.style.color = badgeConfig.color;
    textElem.innerText = `Zdobyto odznakę ${achievement.name} ${levelRoman}`;

    // Show notification
    notificationElem.style.display = 'block';

    // Animate progress bar
    if (achievementUnlockTimer) clearTimeout(achievementUnlockTimer);
    progressElem.style.width = '100%';
    progressElem.style.transition = 'none';
    // Force reflow
    void progressElem.offsetWidth;

    const duration = 4000; // 4 seconds
    progressElem.style.transition = `width ${duration}ms linear`;
    progressElem.style.width = '0%';

    // Auto-close after 4 seconds
    achievementUnlockTimer = setTimeout(() => {
        closeAchievementUnlockNotification();
    }, duration);
}

window.closeAchievementUnlockNotification = () => {
    const notificationElem = document.getElementById('achievement-unlock-notification');
    if (notificationElem) notificationElem.style.display = 'none';
    if (achievementUnlockTimer) {
        clearTimeout(achievementUnlockTimer);
        achievementUnlockTimer = null;
    }
};

// Helper: convert hex to RGB for rgba background
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0, 0, 0';
}

// --- ACHIEVEMENTS FUNCTIONS ---
function calculateAchievementStats() {
    // Reset all stats
    totalDistance = 0;
    totalIcTrips = 0;
    totalPrTrips = 0;
    totalSkmTrips = 0;
    totalTrips = 0;
    uniqueCities = 0;
    totalCost = 0;
    totalTicketSavings = 0;

    // Get all trips to calculate stats from Firebase
    get(tripsRef).then((snap) => {
        if (snap.exists()) {
            const trips = snap.val();
            const tripKeys = Object.keys(trips);
            totalTrips = tripKeys.length;
            
            const citiesVisited = new Set();
            
            tripKeys.forEach(key => {
                const trip = trips[key];
                totalDistance += (trip.km || 0);
                totalCost += (trip.price || 0);
                
                if (trip.ticketType === 'IC') {
                    totalIcTrips++;
                } else if (trip.ticketType === 'PR') {
                    totalPrTrips++;
                } else if (trip.ticketType === 'SKM') {
                    totalSkmTrips++;
                }
                
                if (trip.from) citiesVisited.add(trip.from.toLowerCase().trim());
                if (trip.to) citiesVisited.add(trip.to.toLowerCase().trim());
            });
            
            uniqueCities = citiesVisited.size;
        }
        
        // Calculate ticket savings from monthly tickets
        get(monthlyTicketsRef).then((snap) => {
            if (snap.exists()) {
                const monthlyTicketsData = snap.val();
                Object.values(monthlyTicketsData).forEach(ticket => {
                    const savings = (ticket.totalCost || 0) - (ticket.price || 0);
                    if (savings > 0) totalTicketSavings += savings;
                });
            }
            
            // Now check achievements with updated stats
            checkAchievements();
        });
    });
}

function checkAchievements() {
    ACHIEVEMENTS.forEach(achievement => {
        let currentValue;
        switch (achievement.type) {
            case ACHIEVEMENT_TYPES.DISTANCE:
                currentValue = totalDistance;
                break;
            case ACHIEVEMENT_TYPES.IC_TRIPS:
                currentValue = totalIcTrips;
                break;
            case ACHIEVEMENT_TYPES.PR_TRIPS:
                currentValue = totalPrTrips;
                break;
            case ACHIEVEMENT_TYPES.SKM_TRIPS:
                currentValue = totalSkmTrips;
                break;
            case ACHIEVEMENT_TYPES.TRIPS_TOTAL:
                currentValue = totalTrips;
                break;
            case ACHIEVEMENT_TYPES.CITIES:
                currentValue = uniqueCities;
                break;
            case ACHIEVEMENT_TYPES.TOTAL_COST:
                currentValue = totalCost;
                break;
            case ACHIEVEMENT_TYPES.TICKET_SAVINGS:
                currentValue = totalTicketSavings;
                break;
            default:
                // For series and other custom types, use distance as fallback
                currentValue = totalDistance;
                break;
        }

        // Get user's existing achievement data
        const userData = userAchievements[achievement.id] || { levels: {}, levelIndex: -1 };
        const existingLevels = userData.levels || {};
        const userCurrentLevel = userData.levelIndex ?? -1;

        // Find all levels the user has achieved
        let highestNewLevel = -1;
        let newlyUnlockedLevel = null;
        let newlyUnlockedIndex = -1;

        achievement.levels.forEach((level, idx) => {
            if (currentValue >= level.threshold && !existingLevels[idx]) {
                // This level is newly achieved
                existingLevels[idx] = {
                    threshold: level.threshold,
                    unlockedAt: Date.now()
                };
                if (idx > highestNewLevel) {
                    highestNewLevel = idx;
                    newlyUnlockedLevel = level;
                    newlyUnlockedIndex = idx;
                }
            }
        });

        // If we have new levels, update Firebase
        if (highestNewLevel > userCurrentLevel && newlyUnlockedLevel !== null) {
            const badgeConfig = BADGE_LEVELS[highestNewLevel] || BADGE_LEVELS[BADGE_LEVELS.length - 1];
            // Update achievement
            set(ref(db, `stats/achievements/${achievement.id}`), {
                levelIndex: highestNewLevel,
                levels: existingLevels
            });
            window.showToast(`🏆 Nowe osiągnięcie: ${achievement.name} (${badgeConfig.name})`, 'success');
            window.shootConfetti(`🏆 Nowe osiągnięcie: ${achievement.name} (${badgeConfig.name})!`);
            // Show notification
            showAchievementUnlockNotification(achievement, newlyUnlockedIndex, newlyUnlockedLevel);
        }
    });
}

function renderAchievements() {
    const container = document.getElementById('achievements-container');
    const historyContainer = document.getElementById('achievements-history-list');

    if (!container || !historyContainer) return;

    container.innerHTML = '';
    historyContainer.innerHTML = '';

    ACHIEVEMENTS.forEach(achievement => {
        const userData = userAchievements[achievement.id];
        const currentLevelIndex = userData?.levelIndex ?? -1;
        const existingLevels = userData?.levels || {};
        
        // Handle secret achievement - hide if not unlocked
        if (achievement.secret && currentLevelIndex < 0) {
            return;
        }

        // Get current progress value
        let currentValue;
        let unitLabel;
        switch (achievement.type) {
            case ACHIEVEMENT_TYPES.DISTANCE:
                currentValue = totalDistance;
                unitLabel = 'km';
                break;
            case ACHIEVEMENT_TYPES.IC_TRIPS:
                currentValue = totalIcTrips;
                unitLabel = 'przejazdów';
                break;
            case ACHIEVEMENT_TYPES.PR_TRIPS:
                currentValue = totalPrTrips;
                unitLabel = 'przejazdów';
                break;
            case ACHIEVEMENT_TYPES.SKM_TRIPS:
                currentValue = totalSkmTrips;
                unitLabel = 'przejazdów';
                break;
            case ACHIEVEMENT_TYPES.TRIPS_TOTAL:
            case ACHIEVEMENT_TYPES.TOTAL_TRIPS:
                currentValue = totalTrips;
                unitLabel = 'przejazdów';
                break;
            case ACHIEVEMENT_TYPES.CITIES:
                currentValue = uniqueCities;
                unitLabel = 'miast';
                break;
            case ACHIEVEMENT_TYPES.TOTAL_COST:
                currentValue = totalCost;
                unitLabel = 'zł';
                break;
            case ACHIEVEMENT_TYPES.TICKET_SAVINGS:
                currentValue = totalTicketSavings;
                unitLabel = 'zł';
                break;
            default:
                currentValue = totalDistance;
                unitLabel = 'km';
                break;
        }

        // Find next level
        let nextLevel = null;
        for (let i = 0; i < achievement.levels.length; i++) {
            if (i > currentLevelIndex) {
                nextLevel = achievement.levels[i];
                break;
            }
        }

        const isMaxed = currentLevelIndex === achievement.levels.length - 1;
        const currentBadgeConfig = currentLevelIndex >= 0 ? (BADGE_LEVELS[currentLevelIndex] || BADGE_LEVELS[BADGE_LEVELS.length - 1]) : { color: 'var(--accent)' };
        const currentIsRainbow = currentBadgeConfig.color === 'RAINBOW';
        
        // Create card
        const card = document.createElement('div');
        card.className = 'card';
        let cardStyle = '';
        
        if (achievement.secret) {
            // Secret achievement - flashing black-white rainbow effect
            cardStyle += `border: 2px solid transparent;`;
            cardStyle += `background: rgba(0,0,0,0.3);`;
            cardStyle += `box-shadow: 0 0 30px rgba(255,255,255,0.5);`;
            cardStyle += `animation: secret-achievement 0.5s ease infinite;`;
        } else if (currentIsRainbow) {
            cardStyle += `border: 2px solid transparent;`;
            cardStyle += `background: linear-gradient(135deg, rgba(255,0,0,0.2), rgba(255,127,0,0.2), rgba(255,255,0,0.2), rgba(0,255,0,0.2), rgba(0,0,255,0.2), rgba(75,0,130,0.2), rgba(148,0,211,0.2)); background-size: 400% 400%; animation: rainbow 5s ease infinite;`;
            cardStyle += `border-image: linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3) 1;`;
        } else {
            const rgbColor = hexToRgb(currentBadgeConfig.color) || '129, 140, 248';
            cardStyle += `border: 2px solid ${currentBadgeConfig.color};`;
            cardStyle += `background: rgba(${rgbColor}, 0.15);`;
            cardStyle += `box-shadow: 0 0 20px rgba(${rgbColor}, 0.3);`;
        }
        card.style.cssText = cardStyle;

        let progressHtml = '';
        if (!isMaxed && nextLevel) {
            const nextLevelIndex = currentLevelIndex + 1;
            const nextBadgeConfig = BADGE_LEVELS[nextLevelIndex] || BADGE_LEVELS[BADGE_LEVELS.length - 1];
            const nextIsRainbow = nextBadgeConfig.color === 'RAINBOW';
            const progress = Math.min((currentValue / nextLevel.threshold) * 100, 100);
            progressHtml = `
                <div style="margin-top: 15px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom:5px;">
                        <span>${currentValue.toFixed(1)}/${nextLevel.threshold} ${unitLabel}</span>
                        <span class="${nextIsRainbow ? 'rainbow-text' : ''}" style="color: ${nextIsRainbow ? '' : nextBadgeConfig.color};">${nextBadgeConfig.name}</span>
                    </div>
                    <div style="height: 8px; background: rgba(255,255,255,0.1); border-radius: 10px; overflow:hidden;">
                        <div style="width: ${progress}%; height:100%; background: ${nextIsRainbow ? 'linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3)' : nextBadgeConfig.color}; transition: width 0.5s ease; ${nextIsRainbow ? 'background-size: 400% 400%; animation: rainbow-border 3s linear infinite;' : ''}"></div>
                    </div>
                </div>
            `;
        } else if (isMaxed) {
            progressHtml = `<div style="margin-top:15px; text-align:center; font-size:14px; color:var(--success); font-weight:900; text-shadow: 0 0 10px rgba(34, 197, 94, 0.5);">🎉 Osiągnięto maksymalny poziom!</div>`;
        }

        let displayName = achievement.name;
        if (currentLevelIndex >= 0) {
            displayName = `${achievement.name} - poziom ${currentLevelIndex + 1}`;
        }
        
        let iconClass = achievement.icon;
        let textClass = currentIsRainbow ? 'rainbow-text' : '';
        let textColorStyle = currentIsRainbow ? '' : `color: ${currentBadgeConfig.color};`;
        if (achievement.secret) {
            textClass = 'secret-achievement-text';
        }

        card.innerHTML = `
            <div style="display:flex; align-items: center; gap:15px;">
                <i class="fa-solid ${iconClass} ${textClass}" style="font-size:40px; ${textColorStyle}"></i>
                <div style="flex:1;">
                    <div style="display:flex; gap:8px; align-items:center; margin-bottom:4px;">
                        <h4 style="margin:0; font-size:18px; font-weight:900;" class="${textClass}">${displayName}</h4>
                        <span style="font-size:10px; background:var(--accent); padding:2px 8px; border-radius:4px; font-weight:700;">${achievement.category || 'SERIA'}</span>
                    </div>
                    <p style="margin:0; font-size:12px; opacity:0.7;">${achievement.description}</p>
                    ${progressHtml}
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    // Render history
    const historyItems = [];
    ACHIEVEMENTS.forEach(achievement => {
        const userData = userAchievements[achievement.id];
        if (userData?.levels) {
            Object.entries(userData.levels).forEach(([levelIndex, levelData]) => {
                const idx = parseInt(levelIndex);
                historyItems.push({
                    achievement: achievement,
                    levelIndex: idx,
                    threshold: levelData.threshold,
                    unlockedAt: levelData.unlockedAt
                });
            });
        }
    });

    // Sort by unlockedAt descending
    historyItems.sort((a, b) => b.unlockedAt - a.unlockedAt);

    if (historyItems.length === 0) {
        historyContainer.innerHTML = '<p style="text-align:center; opacity:0.5;">Brak historii osiągnięć</p>';
    } else {
        historyItems.forEach(item => {
            const date = new Date(item.unlockedAt);
            const dateStr = date.toLocaleString('pl-PL');
            const historyCard = document.createElement('div');
            historyCard.className = 'card';
            historyCard.style.cssText = 'background: rgba(0,0,0,0.2); display: flex; align-items: center; gap: 15px; padding: 10px 15px;';
            const bConf = BADGE_LEVELS[item.levelIndex] || BADGE_LEVELS[BADGE_LEVELS.length - 1];
            historyCard.innerHTML = `
                <i class="fa-solid ${item.achievement.icon}" style="font-size:24px; color: ${bConf.color};"></i>
                <div style="flex:1;">
                    <div style="font-weight:700;">${item.achievement.name} - poziom ${item.levelIndex + 1}</div>
                    <div style="font-size:11px; opacity:0.6;">${dateStr}</div>
                </div>
            `;
            historyContainer.appendChild(historyCard);
        });
    }
}

window.switchAchievementTab = (tab) => {
    const tabMain = document.getElementById('achievement-tab-main');
    const tabHistory = document.getElementById('achievement-tab-history');
    const containerMain = document.getElementById('achievements-container');
    const containerHistory = document.getElementById('achievements-history');

    if (tab === 'main') {
        tabMain.style.background = 'var(--accent)';
        tabHistory.style.background = 'rgba(255,255,255,0.1)';
        containerMain.style.display = 'grid';
        containerHistory.style.display = 'none';
    } else {
        tabMain.style.background = 'rgba(255,255,255,0.1)';
        tabHistory.style.background = 'var(--accent)';
        containerMain.style.display = 'none';
        containerHistory.style.display = 'block';
    }
};

window.openAchievements = () => {
    window.closeAllModals();
    document.getElementById('achievements-modal').classList.add('active');
    window.setActiveMenuItem('menu-achievements');
    document.body.classList.add('no-scroll');
    window.switchAchievementTab('main');
    renderAchievements();
};

let monthlyTickets = [];

window.openMonthlyTickets = () => {
    window.closeAllModals();
    document.getElementById('monthly-tickets-modal').classList.add('active');
    window.setActiveMenuItem('menu-monthly-tickets');
    document.body.classList.add('no-scroll');
    loadMonthlyTickets();
};

const syncTripsForTicket = async (ticketId) => {
    const ticket = monthlyTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    const ticketStart = new Date(ticket.startDate);
    const ticketEnd = new Date(ticket.endDate);

    // Filter trips that fall within the ticket's date range
    const relevantTrips = tripsData.filter(trip => {
        let tripDate;
        if (trip.createdAt) {
            tripDate = new Date(trip.createdAt);
        } else if (trip.data) {
            const [day, month, year] = trip.data.split('.');
            tripDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
            return false;
        }
        return tripDate >= ticketStart && tripDate <= ticketEnd;
    });

    // Calculate trip count and total cost
    const tripIds = relevantTrips.map(t => t.key);
    const totalCost = relevantTrips.reduce((sum, t) => sum + (t.zl || t.cost || 0), 0);

    // Update ticket in Firebase
    const ticketRef = ref(db, `stats/bilety_miesieczne/${ticketId}`);
    await update(ticketRef, {
        tripCount: tripIds.length,
        totalCost: totalCost,
        trips: tripIds
    });

    window.showToast(`Zsynchronizowano ${tripIds.length} przejazdów z biletu!`, 'success');
    
    // Refresh ticket details modal if it's open
    setTimeout(() => {
        if (document.getElementById('ticket-details-modal')) {
            window.openTicketDetails(ticketId);
        }
    }, 300);
};

const loadMonthlyTickets = () => {
    onValue(monthlyTicketsRef, (snapshot) => {
        const data = snapshot.val();
        monthlyTickets = data ? Object.entries(data).map(([id, ticket]) => ({ id, ...ticket })) : [];
        renderMonthlyTickets();
        renderAdminMonthlyTickets();
        renderMainHistoryList();
        updateProgressUI();
    });
};

const renderMonthlyTickets = () => {
    const activeContainer = document.getElementById('active-tickets-container');
    const archiveContainer = document.getElementById('archive-tickets-container');
    
    const now = new Date();
    const activeTickets = monthlyTickets.filter(t => !t.archived);
    const archiveTickets = monthlyTickets.filter(t => t.archived);

    // Aktualizuj sekcję na stronie głównej
    const activeTicketInfo = document.getElementById('active-ticket-info');
    const ticketStatusBadge = document.getElementById('ticket-status-badge');
    const activeTicketActions = document.getElementById('active-ticket-actions');
    
    if (activeTicketInfo && ticketStatusBadge && activeTicketActions) {
        if (simulatedTicketId) {
            // Symulacja biletu
            const ticket = monthlyTickets.find(t => t.id === simulatedTicketId);
            if (ticket) {
                const savings = (ticket.totalCost || 0) - (ticket.price || 0);
                const ticketName = ticket.customName || ticket.type;
                
                activeTicketInfo.style.display = 'block';
                ticketStatusBadge.style.display = 'flex';
                ticketStatusBadge.style.background = 'linear-gradient(135deg, #ff9500 0%, #ffb700 100%)';
                ticketStatusBadge.innerHTML = `
                    <span style="font-size:16px; margin-right:8px;">🎭</span>
                    SYMULACJA: ${ticketName}
                `;
                
                const nameElem = document.getElementById('active-ticket-name');
                const datesElem = document.getElementById('active-ticket-dates');
                const tripsElem = document.getElementById('active-ticket-trips');
                const savingsElem = document.getElementById('active-ticket-savings');
                
                if (nameElem) nameElem.innerText = ticketName;
                if (datesElem) datesElem.innerText = `${new Date(ticket.startDate).toLocaleDateString('pl-PL')} - ${new Date(ticket.endDate).toLocaleDateString('pl-PL')}`;
                if (tripsElem) tripsElem.innerText = ticket.tripCount || 0;
                if (savingsElem) {
                    savingsElem.innerText = `${savings >= 0 ? '+' : ''}${savings.toFixed(2)} zł`;
                    savingsElem.style.color = savings > 0 ? 'var(--success)' : 'white';
                }
                
                activeTicketActions.innerHTML = `
                    <button onclick="window.openTicketDetails('${ticket.id}')" style="width: 100%; padding: 12px; margin-bottom: 8px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; border-radius: 8px; font-weight: 800; cursor: pointer; font-size: 14px;">
                        📋 SZCZEGÓŁY BILETU
                    </button>
                    <button onclick="window.stopSimulateTicket()" style="width: 100%; padding: 12px; background: var(--danger); border: none; border-radius: 8px; font-weight: 800; cursor: pointer; font-size: 14px;">
                        ❌ ZAKOŃCZ SYMULACJĘ
                    </button>
                `;
            }
        } else if (activeTickets.length > 0) {
            const ticket = activeTickets[0];
            const savings = (ticket.totalCost || 0) - (ticket.price || 0);
            const ticketName = ticket.customName || ticket.type;
            const isExpired = new Date(ticket.endDate) <= now;
            
            // Show active ticket info
            activeTicketInfo.style.display = 'block';
            
            // Update status badge
            if (isExpired) {
                ticketStatusBadge.style.display = 'flex';
                ticketStatusBadge.style.background = 'var(--danger)';
                ticketStatusBadge.innerHTML = `
                    <span class="online-dot" style="background: #fecaca; box-shadow: 0 0 6px 2px #ef4444; animation: pulse 1.5s infinite;"></span>
                    BILET WYGASŁ
                `;
                activeTicketActions.innerHTML = `
                    <button onclick="window.endMonthlyTicket('${ticket.id}')" style="width: 100%; padding: 12px; background: var(--danger); border: none; border-radius: 8px; font-weight: 800; cursor: pointer; font-size: 14px;">
                        🎬 ZAKOŃCZ TEN MIESIĄC
                    </button>
                `;
            } else {
                ticketStatusBadge.style.display = 'flex';
                ticketStatusBadge.style.background = 'var(--success)';
                ticketStatusBadge.innerHTML = `
                    <span class="online-dot" style="animation: pulse 1.5s infinite;"></span>
                    BILET AKTYWNY
                `;
                activeTicketActions.innerHTML = '';
            }
            
            const nameElem = document.getElementById('active-ticket-name');
            const datesElem = document.getElementById('active-ticket-dates');
            const tripsElem = document.getElementById('active-ticket-trips');
            const savingsElem = document.getElementById('active-ticket-savings');
            
            if (nameElem) nameElem.innerText = ticketName;
            if (datesElem) datesElem.innerText = `${new Date(ticket.startDate).toLocaleDateString('pl-PL')} - ${new Date(ticket.endDate).toLocaleDateString('pl-PL')}`;
            if (tripsElem) tripsElem.innerText = ticket.tripCount || 0;
            if (savingsElem) {
                savingsElem.innerText = `${savings >= 0 ? '+' : ''}${savings.toFixed(2)} zł`;
                savingsElem.style.color = savings > 0 ? 'var(--success)' : 'white';
            }
        } else {
            // Check if there are archived tickets with wrapped to show on main page
            const archivedWithWrapped = archiveTickets.filter(t => t.wrappedGenerated).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
            if (archivedWithWrapped.length > 0) {
                const ticket = archivedWithWrapped[0];
                const savings = (ticket.totalCost || 0) - (ticket.price || 0);
                const ticketName = ticket.customName || ticket.type;
                
                activeTicketInfo.style.display = 'block';
                ticketStatusBadge.style.display = 'flex';
                ticketStatusBadge.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                ticketStatusBadge.innerHTML = `
                    <span style="font-size:16px; margin-right:8px;">🎁</span>
                    ZAKOŃCZONY MIESIĄC
                `;
                
                const nameElem = document.getElementById('active-ticket-name');
                const datesElem = document.getElementById('active-ticket-dates');
                const tripsElem = document.getElementById('active-ticket-trips');
                const savingsElem = document.getElementById('active-ticket-savings');
                
                if (nameElem) nameElem.innerText = ticketName;
                if (datesElem) datesElem.innerText = `${new Date(ticket.startDate).toLocaleDateString('pl-PL')} - ${new Date(ticket.endDate).toLocaleDateString('pl-PL')}`;
                if (tripsElem) tripsElem.innerText = ticket.tripCount || 0;
                if (savingsElem) {
                    savingsElem.innerText = `${savings >= 0 ? '+' : ''}${savings.toFixed(2)} zł`;
                    savingsElem.style.color = savings > 0 ? 'var(--success)' : 'white';
                }
                
                activeTicketActions.innerHTML = `
                    <button onclick="window.openTicketWrapped('${ticket.id}')" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; border-radius: 8px; font-weight: 800; cursor: pointer; font-size: 14px;">
                        🎁 ZOBACZ WRAPPED
                    </button>
                `;
            } else {
                activeTicketInfo.style.display = 'none';
                ticketStatusBadge.style.display = 'none';
                activeTicketActions.innerHTML = '';
            }
        }
    }

    // Aktualizuj modal z biletami
    if (activeContainer && archiveContainer) {
        activeContainer.innerHTML = activeTickets.length ? activeTickets.map(ticket => {
            const savings = (ticket.totalCost || 0) - (ticket.price || 0);
            const ticketName = ticket.customName || ticket.type;
            return `
            <div class="card" style="background: rgba(0,0,0,0.2);">
                <div style="cursor: pointer;" onclick="window.openTicketDetails('${ticket.id}')">
                    <h4 style="margin: 0 0 10px; color: var(--accent);">${ticketName}</h4>
                    <div style="display: flex; justify-content: space-between; font-size: 12px;">
                        <span>Od: ${new Date(ticket.startDate).toLocaleDateString('pl-PL')}</span>
                        <span>Do: ${new Date(ticket.endDate).toLocaleDateString('pl-PL')}</span>
                    </div>
                    <div style="margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px;">
                        <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 8px; text-align: center;">
                            <div style="opacity:0.6;">Cena biletu</div>
                            <div style="font-weight: 800; color: var(--warning);">${(ticket.price || 0).toFixed(2)} zł</div>
                        </div>
                        <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 8px; text-align: center;">
                            <div style="opacity:0.6;">Przejazdy</div>
                            <div style="font-weight: 800;">${ticket.tripCount || 0}</div>
                        </div>
                        <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 8px; text-align: center;">
                            <div style="opacity:0.6;">Wartość</div>
                            <div style="font-weight: 800;">${(ticket.totalCost || 0).toFixed(2)} zł</div>
                        </div>
                        <div style="background: ${savings > 0 ? 'var(--success)' : 'rgba(0,0,0,0.2)'}; padding: 8px; border-radius: 8px; text-align: center;">
                            <div style="opacity:0.8;">Oszczędności</div>
                            <div style="font-weight: 800;">${savings >= 0 ? '+' : ''}${savings.toFixed(2)} zł</div>
                        </div>
                    </div>
                </div>
            </div>
        `}).join('') : '<p style="text-align:center; opacity:0.5;">Brak aktywnych biletów</p>';
        
        archiveContainer.innerHTML = archiveTickets.length ? archiveTickets.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0)).map(ticket => {
            const savings = (ticket.totalCost || 0) - (ticket.price || 0);
            const ticketName = ticket.customName || ticket.type;
            const hasWrapped = ticket.wrappedGenerated || false;
            return `
            <div class="card" style="background: rgba(0,0,0,0.15);">
                <div style="cursor: pointer;" onclick="window.openTicketDetails('${ticket.id}')">
                    <h4 style="margin: 0 0 10px; color: rgba(255,255,255,0.6);">${ticketName}</h4>
                    <div style="display: flex; justify-content: space-between; font-size: 12px;">
                        <span>Od: ${new Date(ticket.startDate).toLocaleDateString('pl-PL')}</span>
                        <span>Do: ${new Date(ticket.endDate).toLocaleDateString('pl-PL')}</span>
                    </div>
                    <div style="margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px;">
                        <div style="background: rgba(0,0,0,0.1); padding: 8px; border-radius: 8px; text-align: center;">
                            <div style="opacity:0.6;">Cena biletu</div>
                            <div style="font-weight: 800; color: var(--warning);">${(ticket.price || 0).toFixed(2)} zł</div>
                        </div>
                        <div style="background: rgba(0,0,0,0.1); padding: 8px; border-radius: 8px; text-align: center;">
                            <div style="opacity:0.6;">Przejazdy</div>
                            <div style="font-weight: 800;">${ticket.tripCount || 0}</div>
                        </div>
                        <div style="background: rgba(0,0,0,0.1); padding: 8px; border-radius: 8px; text-align: center;">
                            <div style="opacity:0.6;">Wartość</div>
                            <div style="font-weight: 800;">${(ticket.totalCost || 0).toFixed(2)} zł</div>
                        </div>
                        <div style="background: ${savings > 0 ? 'var(--success)' : 'rgba(0,0,0,0.1)'}; padding: 8px; border-radius: 8px; text-align: center;">
                            <div style="opacity:0.8;">Oszczędności</div>
                            <div style="font-weight: 800;">${savings >= 0 ? '+' : ''}${savings.toFixed(2)} zł</div>
                        </div>
                    </div>
                </div>
                <div style="margin-top: 10px; display: grid; gap: 8px;">
                    <button onclick="event.stopPropagation(); window.openTicketWrapped('${ticket.id}')" style="width: 100%; padding: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; border-radius: 8px; font-weight: 800; cursor: pointer;">
                        🎁 Zobacz Wrapped
                    </button>
                    <button onclick="event.stopPropagation(); window.simulateTicket('${ticket.id}')" style="width: 100%; padding: 10px; background: linear-gradient(135deg, #ff9500 0%, #ffb700 100%); border: none; border-radius: 8px; font-weight: 800; cursor: pointer;">
                        🎭 Stymuluj bilet
                    </button>
                </div>
            </div>
        `}).join('') : '<p style="text-align:center; opacity:0.5;">Brak archiwalnych biletów</p>';
    }
};

window.addNewMonthlyTicket = () => {
    const type = document.getElementById('new-ticket-type').value;
    const customName = document.getElementById('new-ticket-name').value;
    const startDate = document.getElementById('new-ticket-start').value;
    const endDate = document.getElementById('new-ticket-end').value;
    const price = parseFloat(document.getElementById('new-ticket-price').value) || 0;
    
    if (!startDate || !endDate) {
        window.showToast('Wybierz daty rozpoczęcia i zakończenia', 'error');
        return;
    }
    
    const newTicket = {
        type,
        customName: customName || type,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        price: price,
        tripCount: 0,
        totalCost: 0,
        trips: [],
        createdAt: Date.now()
    };
    
    push(monthlyTicketsRef, newTicket).then(() => {
        window.showToast('Bilet dodany!', 'success');
    });
    
    // Reset form
    document.getElementById('new-ticket-name').value = '';
    document.getElementById('new-ticket-start').value = '';
    document.getElementById('new-ticket-end').value = '';
    document.getElementById('new-ticket-price').value = '';
};

window.syncTripsForTicket = syncTripsForTicket;

window.removeTripFromTicket = (ticketId, tripId) => {
    const ticket = monthlyTickets.find(t => t.id === ticketId);
    const newTrips = (ticket.trips || []).filter(id => id !== tripId);
    const newTotalCost = newTrips.reduce((sum, id) => {
        const trip = tripsData.find(t => t.key === id);
        return sum + (trip?.zl || trip?.cost || 0);
    }, 0);
    const ticketRef = ref(db, `stats/bilety_miesieczne/${ticketId}`);
    update(ticketRef, { trips: newTrips, tripCount: newTrips.length, totalCost: newTotalCost });
    window.showToast('Usunięto przejazd z biletu', 'success');
    setTimeout(() => window.openTicketDetails(ticketId), 200);
};

window.openTripManagerModal = (ticketId) => {
    console.log('🎫 openTripManagerModal called with ticketId:', ticketId);
    console.log('📂 tripsData:', tripsData);
    console.log('🎟️ monthlyTickets:', monthlyTickets);

    const ticket = monthlyTickets.find(t => t.id === ticketId);
    if (!ticket) {
        console.error('❌ Ticket not found!');
        return;
    }

    const tripsInTicket = (ticket.trips || []).map(tripId => tripsData.find(t => t.key === tripId)).filter(Boolean);
    const tripsNotInTicket = tripsData.filter(t => !(ticket.trips || []).includes(t.key));

    console.log('✅ tripsInTicket:', tripsInTicket);
    console.log('✅ tripsNotInTicket:', tripsNotInTicket);

    const createTripTile = (trip, inTicket) => {
        return `
            <div class="card" style="background: rgba(0,0,0,0.2); padding: 10px; margin-bottom: 8px; cursor: pointer; transition: transform 0.1s;" 
                 onmouseover="this.style.transform='scale(1.01)'" 
                 onmouseout="this.style.transform='scale(1)'"
                 onclick="window.toggleTripInTicket('${ticketId}', '${trip.key}', ${inTicket})">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <div style="font-weight: 800;">${trip.od || trip.from || '?'} → ${trip.do || trip.to || '?'}</div>
                    <div style="color: var(--warning); font-weight: 800;">${(trip.zl || trip.cost || 0).toFixed(2)} zł</div>
                </div>
                <div style="font-size: 12px; opacity: 0.7;">
                    <span>${trip.data || trip.date || 'Brak daty'}</span>
                    <span style="margin-left: 8px;">${trip.nr || trip.trainNumber || trip.regioNum || 'Regio'}</span>
                </div>
                <div style="text-align: center; margin-top: 8px; font-size: 11px; opacity: 0.8;">
                    ${inTicket ? '🗑️ Usuń z biletu' : '➕ Dodaj do biletu'}
                </div>
            </div>
        `;
    };

    const modalId = 'trip-manager-modal';
    // Remove old modal if exists
    const oldModal = document.getElementById(modalId);
    if (oldModal) oldModal.remove();

    let modalHtml = `
        <div id="${modalId}" style="position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center; z-index: 2000;">
            <div style="width: 90%; max-width: 1000px; max-height: 90vh; background: #1a1a2e; border-radius: 16px; padding: 24px; overflow: hidden;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h2 style="margin:0; font-size:24px;">Zarządzaj przejazdami</h2>
                    <button onclick="document.getElementById('${modalId}').remove(); setTimeout(() => window.openTicketDetails('${ticketId}'), 100);" style="background: var(--danger); border:none; padding:8px 16px; border-radius:8px; font-weight:800; cursor:pointer;">Zamknij</button>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; height: calc(100% - 80px);">
                    <div>
                        <h3 style="margin:0 0 12px 0; color: var(--accent);">Dostępne przejazdy (${tripsNotInTicket.length})</h3>
                        <div style="height: calc(100% - 40px); overflow-y: auto; padding-right: 8px;">
                            ${tripsNotInTicket.length > 0 ? tripsNotInTicket.map(t => createTripTile(t, false)).join('') : '<p style="text-align:center; opacity:0.5; padding:20px;">Brak przejazdów do dodania</p>'}
                        </div>
                    </div>
                    <div>
                        <h3 style="margin:0 0 12px 0; color: var(--success);">W biletcie (${tripsInTicket.length})</h3>
                        <div style="height: calc(100% - 40px); overflow-y: auto; padding-right: 8px;">
                            ${tripsInTicket.length > 0 ? tripsInTicket.map(t => createTripTile(t, true)).join('') : '<p style="text-align:center; opacity:0.5; padding:20px;">Brak przejazdów w bilecie</p>'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Insert modal into DOM
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = modalHtml;
    document.body.appendChild(tempDiv.firstChild);
};

window.toggleTripInTicket = (ticketId, tripKey, isInTicket) => {
    const ticket = monthlyTickets.find(t => t.id === ticketId);
    let newTrips;

    if (isInTicket) {
        // Remove from ticket
        newTrips = (ticket.trips || []).filter(id => id !== tripKey);
    } else {
        // Add to ticket
        newTrips = [...(ticket.trips || []), tripKey];
    }

    // Recalculate total cost
    const newTotalCost = newTrips.reduce((sum, id) => {
        const trip = tripsData.find(t => t.key === id);
        return sum + (trip?.zl || trip?.cost || 0);
    }, 0);

    // Update local ticket first for immediate UI feedback
    ticket.trips = newTrips;
    ticket.tripCount = newTrips.length;
    ticket.totalCost = newTotalCost;

    // Update Firebase
    const ticketRef = ref(db, `stats/bilety_miesieczne/${ticketId}`);
    update(ticketRef, { trips: newTrips, tripCount: newTrips.length, totalCost: newTotalCost }).then(() => {
        window.showToast(isInTicket ? 'Usunięto przejazd z biletu' : 'Dodano przejazd do biletu', 'success');
        // Refresh modal
        window.openTripManagerModal(ticketId);
    });
};

window.openEditTicketStatsModal = (ticketId) => {
    const ticket = monthlyTickets.find(t => t.id === ticketId);
    window.openUniversalEdit('Edytuj dane biletu', [
        { id: 'totalCost', label: 'Wartość (zł)', type: 'number', value: ticket.totalCost || 0 },
        { id: 'tripCount', label: 'Liczba przejazdów', type: 'number', value: ticket.tripCount || 0 },
        { id: 'price', label: 'Cena biletu (zł)', type: 'number', value: ticket.price || 0 }
    ], (result) => {
        const ticketRef = ref(db, `stats/bilety_miesieczne/${ticketId}`);
        update(ticketRef, { 
            totalCost: parseFloat(result.totalCost) || 0, 
            tripCount: parseInt(result.tripCount) || 0, 
            price: parseFloat(result.price) || 0 
        });
        window.showToast('Zaktualizowano dane biletu!', 'success');
        setTimeout(() => window.openTicketDetails(ticketId), 200);
    });
};

function renderTicketTopList(dataMap, suffix) {
    const allSorted = Object.entries(dataMap)
        .sort((a, b) => b[1] - a[1]);
        
    const top3 = allSorted.slice(0, 3);

    if (top3.length === 0) {
        return '<div style="font-size:10px; opacity:0.3;">Brak danych...</div>';
    }

    const medals = ['🥇', '🥈', '🥉'];
    return top3.map(([key, value], index) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:8px 10px; border-radius:8px; font-size:11px; border-left:3px solid ${['var(--warning)', 'var(--accent)', 'var(--success)'][index]};">
            <div>
                <span style="margin-right:5px;">${medals[index]}</span>
                <span style="font-weight:700;">${key}</span>
            </div>
            <span style="font-weight:900;">${value}${suffix}</span>
        </div>
    `).join('');
}

function renderTicketPriceRanking(ticketTrips) {
    const realTrips = ticketTrips.filter(t => !t.isPart);
    if (realTrips.length === 0) return '<div style="font-size:10px; opacity:0.3;">Brak danych...</div>';

    const sortedByPrice = [...realTrips].sort((a, b) => {
        const zlA = parseFloat(a.zl || a.cost || 0);
        const zlB = parseFloat(b.zl || b.cost || 0);
        return zlB - zlA;
    });
    
    const mostExpensive = sortedByPrice[0];
    const cheapest = sortedByPrice[sortedByPrice.length - 1];

    const items = [
        { label: "NAJDROŻSZY", data: mostExpensive, icon: "🔥", color: "var(--danger)" },
        { label: "NAJTAŃSZY", data: cheapest, icon: "💎", color: "var(--success)" }
    ];

    return items.map(item => {
        const val = parseFloat(item.data.zl || item.data.cost || 0);
        return `
            <div style="display:flex; flex-direction:column; gap:2px; background:rgba(255,255,255,0.03); padding:8px 10px; border-radius:8px; font-size:11px; border-left: 3px solid ${item.color};">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:800; color:${item.color}; letter-spacing:1px;">${item.icon} ${item.label}</span>
                    <span style="font-weight:900; color:#fff;">${val.toFixed(2)} zł</span>
                </div>
                <div style="opacity:0.6;">${(item.data.od || item.data.from || '?').toUpperCase()} ➔ ${(item.data.do || item.data.to || '?').toUpperCase()}</div>
                <div style="font-size:9px; opacity:0.4;">${item.data.data || item.data.date || '?'} | ${item.data.nr || item.data.trainNumber || item.data.regioNum || '---'}</div>
            </div>
        `;
    }).join('');
}

window.openTicketDetails = (ticketId) => {
    const ticket = monthlyTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    const savings = (ticket.totalCost || 0) - (ticket.price || 0);
    const ticketTrips = (ticket.trips || []).map(tripId => {
        const trip = tripsData.find(t => t.key === tripId);
        return trip || null;
    }).filter(t => t !== null);

    const isArchived = ticket.archived || false;

    // Calculate ticket-specific rankings
    const seriesCounts = {};
    ticketTrips.forEach(t => {
        if (t.unit) {
            const series = t.unit.split('-')[0].trim().toUpperCase();
            seriesCounts[series] = (seriesCounts[series] || 0) + 1;
        }
    });

    const routeCounts = {};
    ticketTrips.forEach(t => {
        if (t.od || t.from) {
            const r = `${(t.od || t.from || '?').toUpperCase()} ➔ ${(t.do || t.to || '?').toUpperCase()}`;
            routeCounts[r] = (routeCounts[r] || 0) + 1;
        }
    });

    const carrierCounts = {};
    ticketTrips.forEach(t => {
        if (t.nr || t.trainNumber) {
            const firstPart = (t.nr || t.trainNumber || '').trim().split(' ')[0].toUpperCase();
            let carrier = "INNY";
            if (firstPart.startsWith('S')) carrier = "SKM TRÓJMIASTO";
            else if (firstPart.startsWith('IC') || firstPart.startsWith('EIP') || firstPart.startsWith('EIC') || firstPart.startsWith('TLK')) carrier = "PKP INTERCITY";
            else if (firstPart.startsWith('R') || firstPart.startsWith('KW') || firstPart.startsWith('KD')) carrier = "POLREGIO";
            
            carrierCounts[carrier] = (carrierCounts[carrier] || 0) + 1;
        }
    });

    const unitCounts = {};
    ticketTrips.forEach(t => {
        if (t.unit) {
            const u = t.unit.trim().toUpperCase();
            unitCounts[u] = (unitCounts[u] || 0) + 1;
        }
    });

    document.getElementById('ticket-details-title').innerText = ticket.customName || ticket.type;
    document.getElementById('ticket-details-content').innerHTML = `
        <div style="display:flex; gap:8px; margin-bottom:15px;">
            <button onclick="window.openTicketHeatmap('${ticketId}')" style="flex:1; padding:10px; background:linear-gradient(135deg, #ff0000, #ff8800, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3); border:none; border-radius:8px; font-weight:800; cursor:pointer;">
                🔥 Heatmapa biletu
            </button>
        </div>
        <div class="card" style="background: rgba(0,0,0,0.2); margin-bottom: 15px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12px;">
                <div>
                    <div style="opacity:0.6;">Od</div>
                    <div style="font-weight:800;">${new Date(ticket.startDate).toLocaleDateString('pl-PL')}</div>
                </div>
                <div>
                    <div style="opacity:0.6;">Do</div>
                    <div style="font-weight:800;">${new Date(ticket.endDate).toLocaleDateString('pl-PL')}</div>
                </div>
                <div>
                    <div style="opacity:0.6;">Cena biletu</div>
                    <div style="font-weight:800; color: var(--warning);">${(ticket.price || 0).toFixed(2)} zł</div>
                </div>
                <div>
                    <div style="opacity:0.6;">Oszczędności</div>
                    <div style="font-weight:800; color: ${savings > 0 ? 'var(--success)' : 'white'};">${savings >= 0 ? '+' : ''}${savings.toFixed(2)} zł</div>
                </div>
            </div>
            ${!isArchived ? `
            <div style="display:flex; gap:8px; margin-top:10px;">
                <button onclick="window.syncTripsForTicket('${ticketId}')" style="flex:1; padding:8px; background:var(--accent); border:none; border-radius:8px; font-weight:800; cursor:pointer;">
                    🔄 Synchronizuj
                </button>
                <button onclick="window.openEditTicketStatsModal('${ticketId}')" style="flex:1; padding:8px; background:var(--info); border:none; border-radius:8px; font-weight:800; cursor:pointer;">
                    ✏️ Edytuj
                </button>
            </div>
            ` : `
            <div style="margin-top:10px; text-align:center; opacity:0.7; font-size:14px; padding:8px; background:rgba(0,0,0,0.15); border-radius:8px;">
                <i class="fa-solid fa-lock"></i> Ten miesiąc został zakończony - tylko do odczytu
            </div>
            `}
        </div>
        
        <!-- RANKING SECTION -->
        <h4 style="margin: 15px 0 10px; color: var(--accent);">Rankingi (${ticket.customName || ticket.type})</h4>
        <div style="display: grid; gap:15px; grid-template-columns: 1fr;">
            <!-- Top Series -->
            <div class="card" style="background: rgba(0,0,0,0.2);">
                <h5 style="margin: 0 0 10px; color: var(--warning);">🏆 TOP SERIE</h5>
                ${renderTicketTopList(seriesCounts, 'x')}
            </div>
            
            <!-- Top Routes -->
            <div class="card" style="background: rgba(0,0,0,0.2);">
                <h5 style="margin: 0 0 10px; color: var(--info);">🛤️ TOP TRASY</h5>
                ${renderTicketTopList(routeCounts, 'x')}
            </div>
            
            <!-- Top Carriers -->
            <div class="card" style="background: rgba(0,0,0,0.2);">
                <h5 style="margin: 0 0 10px; color: var(--accent);">🚄 TOP PRZEWOŹNICY</h5>
                ${renderTicketTopList(carrierCounts, 'x')}
            </div>
            
            <!-- Top Units -->
            <div class="card" style="background: rgba(0,0,0,0.2);">
                <h5 style="margin: 0 0 10px; color: var(--success);">⚙️ TOP JEDNOSTKI</h5>
                ${renderTicketTopList(unitCounts, 'x')}
            </div>
            
            <!-- Price Ranking -->
            <div class="card" style="background: rgba(0,0,0,0.2);">
                <h5 style="margin: 0 0 10px; color: var(--danger);">💰 REKORDY CEN</h5>
                ${renderTicketPriceRanking(ticketTrips)}
            </div>
        </div>
        
        <!-- HISTORY SECTION -->
        <h4 style="margin: 15px 0 10px; color: var(--accent);">Historia przejazdów (${ticketTrips.length})</h4>
        ${!isArchived ? `
        <div style="display:flex; gap:8px; margin-bottom:10px;">
            <button onclick="window.openTripManagerModal('${ticketId}')" style="flex:1; padding:8px; background:var(--success); border:none; border-radius:8px; font-weight:800; cursor:pointer;">
                📋 Zarządzaj przejazdami
            </button>
        </div>
        ` : ''}
        ${ticketTrips.length > 0 ? `
        <div style="overflow-x: auto;">
            <table style="width:100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                    <tr style="background: rgba(0,0,0,0.2);">
                        <th style="padding:10px; text-align:left; border-bottom:1px solid rgba(255,255,255,0.1);">Data</th>
                        <th style="padding:10px; text-align:left; border-bottom:1px solid rgba(255,255,255,0.1);">Pociąg</th>
                        <th style="padding:10px; text-align:left; border-bottom:1px solid rgba(255,255,255,0.1);">Jednostka</th>
                        <th style="padding:10px; text-align:left; border-bottom:1px solid rgba(255,255,255,0.1);">Od</th>
                        <th style="padding:10px; text-align:left; border-bottom:1px solid rgba(255,255,255,0.1);">Do</th>
                        <th style="padding:10px; text-align:left; border-bottom:1px solid rgba(255,255,255,0.1);">Cena</th>
                        <th style="padding:10px; text-align:left; border-bottom:1px solid rgba(255,255,255,0.1);">Notatka</th>
                    </tr>
                </thead>
                <tbody>
                    ${ticketTrips.map(trip => {
                        const noteHtml = trip.note ? `<td onclick="window.showNote(\`${trip.note.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)" style="padding:10px; font-size:10px; opacity:0.7; max-width:150px; overflow:hidden; text-overflow:ellipsis; cursor: pointer; color: var(--warning);">${trip.note}</td>` : `<td style="padding:10px; opacity:0.3">---</td>`;
                        const rawZl = parseFloat(trip.zl || trip.cost || 0);
                        const isPart = !!trip.isPart;
                        const priceDisplay = isPart ? "- zł" : `${(isNaN(rawZl) ? 0 : rawZl).toFixed(2)} zł`;
                        const priceColor = isPart ? "opacity: 0.3;" : "color:var(--success); font-weight:900";
                        const editIconHtml = isAdminUnlocked && !isArchived ? `<span onclick="event.stopPropagation(); window.editTrip('${trip.key}')" style="display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; background:var(--accent); border-radius:6px; margin-right:8px; cursor:pointer; transition:transform 0.2s;"><i class="fa-solid fa-pen" style="font-size:12px; color:white;"></i></span>` : '';
                        
                        return `
                            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                <td style="padding:10px;">${editIconHtml}${trip.data || trip.date || '?'}</td>
                                <td style="padding:10px;">${trip.nr || trip.trainNumber || trip.regioNum || '---'}</td>
                                <td style="padding:10px;">${trip.unit || '---'}</td>
                                <td style="padding:10px;">${(trip.od || trip.from || '?').toUpperCase()}</td>
                                <td style="padding:10px;">${(trip.do || trip.to || '?').toUpperCase()}</td>
                                <td style="padding:10px; ${priceColor}">${priceDisplay}</td>
                                ${noteHtml}
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        ` : '<p style="text-align:center; opacity:0.5;">Brak przejazdów w tym bilecie</p>'}
    `;

    window.closeAllModals();
    document.getElementById('ticket-details-modal').classList.add('active');
    document.body.classList.add('no-scroll');
};

window.simulateTicket = (ticketId) => {
    simulatedTicketId = ticketId;
    window.closeAllModals();
    window.showToast(`Symulacja biletu rozpoczęta!`, 'success');
    // Refresh everything
    renderMonthlyTickets();
    renderMainHistoryList();
    updateProgressUI();
    updateLeaderboards();
};

window.stopSimulateTicket = () => {
    simulatedTicketId = null;
    window.closeAllModals();
    window.showToast(`Symulacja biletu zakończona!`, 'info');
    // Refresh everything
    renderMonthlyTickets();
    renderMainHistoryList();
    updateProgressUI();
    updateLeaderboards();
};

window.closeTicketDetails = () => {
    document.getElementById('ticket-details-modal').classList.remove('active');
    document.body.classList.remove('no-scroll');
    window.openMonthlyTickets();
};

let wrappedCurrentSlide = 0;
let wrappedSlides = [];

let currentWrappedTicketId = null;
window.openTicketWrapped = (ticketId) => {
    currentWrappedTicketId = ticketId;
    const ticket = monthlyTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    const ticketName = ticket.customName || ticket.type;
    const ticketTrips = (ticket.trips || []).map(tripId => {
        const trip = tripsData.find(t => t.key === tripId);
        return trip || null;
    }).filter(t => t !== null);

    // Calculate stats
    let totalDistance = 0;
    let totalCost = ticket.totalCost || 0;
    const carrierCount = {};
    const stationCount = {};
    let firstTrip = null;
    let lastTrip = null;
    let maxCostTrip = null;

    ticketTrips.forEach(trip => {
        // Get trip date (handle both createdAt, data, date)
        let tripDate;
        if (trip.createdAt) {
            tripDate = new Date(trip.createdAt);
        } else if (trip.data) {
            const [day, month, year] = trip.data.split('.');
            tripDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else if (trip.date) {
            tripDate = new Date(trip.date);
        }
        
        // Track first and last trip
        if (tripDate) {
            if (!firstTrip || tripDate < (firstTrip.dateObj || new Date(0))) {
                firstTrip = { ...trip, dateObj: tripDate };
            }
            if (!lastTrip || tripDate > (lastTrip.dateObj || new Date(0))) {
                lastTrip = { ...trip, dateObj: tripDate };
            }
        }

        // Track max cost trip
        const tripCost = trip.zl || trip.cost || 0;
        const currentMax = maxCostTrip ? (maxCostTrip.zl || maxCostTrip.cost || 0) : 0;
        if (!maxCostTrip || tripCost > currentMax) {
            maxCostTrip = trip;
        }

        // Count carriers (handle nr, trainNumber, regioNum, trainType)
        let carrier = 'Regio';
        if (trip.nr) carrier = trip.nr;
        else if (trip.trainNumber) carrier = trip.trainNumber;
        else if (trip.regioNum) carrier = trip.regioNum;
        else if (trip.trainType) carrier = trip.trainType;
        
        // Simplify carrier name - if it's a long string, extract first word
        const simpleCarrier = carrier.split(' ')[0].toUpperCase();
        carrierCount[simpleCarrier] = (carrierCount[simpleCarrier] || 0) + 1;

        // Count stations (handle od/to and from/to)
        const fromStation = trip.od || trip.from;
        const toStation = trip.do || trip.to;
        
        if (fromStation) {
            stationCount[fromStation] = (stationCount[fromStation] || 0) + 1;
        }
        if (toStation) {
            stationCount[toStation] = (stationCount[toStation] || 0) + 1;
        }

        // Add distance if available
        if (trip.distance || trip.km) {
            totalDistance += parseFloat(trip.distance || trip.km || 0);
        }
    });

    // Get most used carrier
    let mostUsedCarrier = null;
    let maxCarrierCount = 0;
    Object.entries(carrierCount).forEach(([carrier, count]) => {
        if (count > maxCarrierCount) {
            maxCarrierCount = count;
            mostUsedCarrier = carrier;
        }
    });

    // Get most used station
    let mostUsedStation = null;
    let maxStationCount = 0;
    Object.entries(stationCount).forEach(([station, count]) => {
        if (count > maxStationCount) {
            maxStationCount = count;
            mostUsedStation = station;
        }
    });



    // Create slides
    wrappedSlides = [
        {
            title: `🎁 ${ticketName}`,
            subtitle: 'Twoje podsumowanie',
            content: `Od ${new Date(ticket.startDate).toLocaleDateString('pl-PL')} do ${new Date(ticket.endDate).toLocaleDateString('pl-PL')}`,
            bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
        },
        {
            title: '🚂 Łączna liczba przejazdów',
            content: ticketTrips.length,
            subtitle: 'przejazdów',
            bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'
        },
        {
            title: '💰 Wartość wszystkich przejazdów',
            content: `${totalCost.toFixed(2)} zł`,
            subtitle: 'bez biletu',
            bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
        },
        {
            title: '🎯 Najczęstszy przewoźnik',
            content: mostUsedCarrier || 'Regio',
            subtitle: `${maxCarrierCount} razy`,
            bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)'
        },
        {
            title: '🏠 Najczęstsza stacja',
            content: mostUsedStation || 'Brak danych',
            subtitle: `${maxStationCount} razy`,
            bg: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
        },
        {
            title: '⭐ Najdroższy przejazd',
            content: maxCostTrip ? `${maxCostTrip.od || maxCostTrip.from || '?'} → ${maxCostTrip.do || maxCostTrip.to || '?'}` : 'Brak danych',
            subtitle: maxCostTrip ? `${(maxCostTrip.zl || maxCostTrip.cost || 0).toFixed(2)} zł` : '',
            bg: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)'
        },
        {
            title: '🏁 Podsumowanie',
            content: 'Dzięki za podróżowanie z nami!',
            subtitle: `Oszczędności: ${(totalCost - (ticket.price || 0)).toFixed(2)} zł`,
            bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            isLast: true
        }
    ];

    wrappedCurrentSlide = 0;
    renderWrappedSlide();

    window.closeAllModals();
    document.getElementById('wrapped-modal').classList.add('active');
    document.body.classList.add('no-scroll');
};

window.closeWrapped = () => {
    document.getElementById('wrapped-modal').classList.remove('active');
    document.body.classList.remove('no-scroll');
    window.openMonthlyTickets();
};

const renderWrappedSlide = () => {
    const container = document.getElementById('wrapped-content');
    const slide = wrappedSlides[wrappedCurrentSlide];

    let contentHtml;
    if (slide.isCustom) {
        contentHtml = slide.content;
    } else {
        contentHtml = `
            <h1 style="font-size: 24px; font-weight: 900; margin-bottom: 10px;">${slide.title}</h1>
            <div style="font-size: 48px; font-weight: 900; margin: 20px 0;">${slide.content}</div>
            ${slide.subtitle ? `<div style="font-size: 18px; opacity: 0.9;">${slide.subtitle}</div>` : ''}
        `;
    }

    container.innerHTML = `
        <div style="width: 100%; max-width: 500px; min-height: 400px; background: ${slide.bg}; border-radius: 20px; padding: 30px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; animation: fadeInUp 0.5s ease-out; overflow-y: auto; max-height: 70vh;">
            ${contentHtml}
        </div>
        <div style="margin-top: 30px; display: flex; gap: 10px; align-items: center;">
            ${wrappedCurrentSlide > 0 ? `<button onclick="window.prevWrappedSlide()" style="padding: 10px 20px; border-radius: 10px; border: none; background: rgba(255,255,255,0.2); color: white; font-weight: 800; cursor: pointer;">←</button>` : '<div style="width: 70px;"></div>'}
            <div style="display: flex; gap: 5px;">
                ${wrappedSlides.map((_, idx) => `<div style="width: 10px; height: 10px; border-radius: 50%; background: ${idx === wrappedCurrentSlide ? 'white' : 'rgba(255,255,255,0.3)'}"></div>`).join('')}
            </div>
            ${wrappedCurrentSlide < wrappedSlides.length - 1 ? `<button onclick="window.nextWrappedSlide()" style="padding: 10px 20px; border-radius: 10px; border: none; background: rgba(255,255,255,0.2); color: white; font-weight: 800; cursor: pointer;">→</button>` : '<button onclick="window.closeWrapped()" style="padding: 10px 20px; border-radius: 10px; border: none; background: white; color: #667eea; font-weight: 800; cursor: pointer;">Zakończ</button>'}
        </div>
    `;
};

window.nextWrappedSlide = () => {
    if (wrappedCurrentSlide < wrappedSlides.length - 1) {
        wrappedCurrentSlide++;
        renderWrappedSlide();
    }
};

window.prevWrappedSlide = () => {
    if (wrappedCurrentSlide > 0) {
        wrappedCurrentSlide--;
        renderWrappedSlide();
    }
};

let pendingTicketToEnd = null;
let pendingTicketToDelete = null;

window.endMonthlyTicket = async (ticketId) => {
    const ticket = monthlyTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    let customName = ticket.customName;
    if (!ticket.customName || ticket.customName === ticket.type) {
        // Ask for custom name
        customName = await window.showCustomDialog(
            'Nazwij ten miesiąc',
            'Podaj nazwę dla tego miesiąca (np. "Styczeń 2026"):',
            { 
                showInput: true, 
                defaultValue: ticket.type, 
                showCancel: true 
            }
        );
        
        if (!customName) return; // User cancelled
    }
    
    completeEndTicket(ticketId, customName);
};

const completeEndTicket = (ticketId, customName) => {
    set(ref(db, `stats/bilety_miesieczne/${ticketId}`), {
        ...monthlyTickets.find(t => t.id === ticketId),
        customName: customName,
        archived: true,
        wrappedGenerated: true,
        archivedAt: Date.now()
    }).then(() => {
        window.showToast('Miesiąc zakończony! 🎉', 'success');
        // Open wrapped automatically
        setTimeout(() => {
            window.openTicketWrapped(ticketId);
        }, 500);
    });
};

window.confirmDeleteTicket = async (ticketId) => {
    const ticket = monthlyTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    const ticketName = ticket.customName || ticket.type;

    const input = await window.showCustomDialog(
        'Usuń bilet?',
        `Aby potwierdzić, wpisz nazwę biletu: "${ticketName}"`,
        { 
            showInput: true, 
            showCancel: true 
        }
    );
    
    if (input && input.toLowerCase() === ticketName.toLowerCase()) {
        remove(ref(db, `stats/bilety_miesieczne/${ticketId}`))
            .then(() => {
                window.showToast('Bilet usunięty!', 'success');
            })
            .catch(err => {
                window.showToast('Błąd usuwania biletu!', 'error');
            });
    } else if (input !== null) {
        window.showToast('Nazwa nie pasuje!', 'error');
    }
};

// Admin functions
window.unlockAllAchievements = () => {
    ACHIEVEMENTS.forEach(achievement => {
        const levels = {};
        achievement.levels.forEach((level, idx) => {
            levels[idx] = {
                threshold: level.threshold,
                unlockedAt: Date.now() - (achievement.levels.length - idx) * 1000 // Just to have different times
            };
        });
        const maxLevelIndex = achievement.levels.length - 1;
        set(ref(db, `stats/achievements/${achievement.id}`), {
            levelIndex: maxLevelIndex,
            levels: levels
        });
    });
    window.showToast('Wszystkie osiągnięcia odblokowane!', 'success');
};

window.resetAllAchievements = () => {
    set(ref(db, 'stats/achievements'), null);
    window.showToast('Wszystkie osiągnięcia zresetowane!', 'success');
};

window.addAchievementLevel = (achievementId) => {
    const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
    if (!achievement) return;
    
    const userData = userAchievements[achievementId] || { levels: {}, levelIndex: -1 };
    const existingLevels = { ...(userData.levels || {}) };
    let currentLevelIndex = userData.levelIndex ?? -1;
    
    if (currentLevelIndex < achievement.levels.length - 1) {
        currentLevelIndex++;
        const newLevel = achievement.levels[currentLevelIndex];
        existingLevels[currentLevelIndex] = {
            threshold: newLevel.threshold,
            unlockedAt: Date.now()
        };
        
        set(ref(db, `stats/achievements/${achievementId}`), {
            levelIndex: currentLevelIndex,
            levels: existingLevels
        });

        // Show notification
        showAchievementUnlockNotification(achievement, currentLevelIndex, newLevel);
    }
};

window.removeAchievementLevel = (achievementId) => {
    const achievement = ACHIEVEMENTS.find(a => a.id === achievementId);
    if (!achievement) return;
    
    const userData = userAchievements[achievementId] || { levels: {}, levelIndex: -1 };
    const existingLevels = { ...(userData.levels || {}) };
    let currentLevelIndex = userData.levelIndex ?? -1;
    
    if (currentLevelIndex >= 0) {
        delete existingLevels[currentLevelIndex];
        currentLevelIndex--;
        
        if (currentLevelIndex < 0) {
            set(ref(db, `stats/achievements/${achievementId}`), null);
        } else {
            set(ref(db, `stats/achievements/${achievementId}`), {
                levelIndex: currentLevelIndex,
                levels: existingLevels
            });
        }
    }
};

// Test functions
window.testTicketExpiration = () => {
    // Create a fake ticket that expires in 1 day
    const now = new Date();
    const startTime = new Date(now);
    const endTime = new Date(now);
    endTime.setDate(endTime.getDate() + 1);
    ticketData = {
        startTime: startTime.toISOString().split('T')[0],
        endTime: endTime
    };
    checkTicketExpiration();
    window.showToast('Test ticket expiration triggered!', 'info');
};

window.testRandomAchievement = () => {
    // Pick a random achievement
    const achievement = ACHIEVEMENTS[Math.floor(Math.random() * ACHIEVEMENTS.length)];
    // Pick a random level
    const levelIndex = Math.floor(Math.random() * achievement.levels.length);
    const level = achievement.levels[levelIndex];
    // Show notification
    showAchievementUnlockNotification(achievement, levelIndex, level);
    window.showToast('Test achievement notification triggered!', 'info');
};
let stations = {};
let tripsData = [];
let galleryData = [];
let visitedCitiesData = {};
let connectionsData = {};
let historySortConfig = { key: 'data', direction: 'desc' };

window.sortHistory = (key) => {
    if (historySortConfig.key === key) {
        historySortConfig.direction = historySortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        historySortConfig.key = key;
        historySortConfig.direction = 'desc';
    }
    renderFullHistory();
};

window.toggleLabelEditMode = () => {
    isLabelEditMode = !isLabelEditMode;
    
    if (isLabelEditMode) {
        // Wyłączamy tryby edycji mapy przy włączaniu edycji etykiet
        isConnectionMode = false;
        isCurveEditMode = false;
        isDrawMode = false;
        isParentSelectionMode = false;
        
        const connBtn = document.getElementById('toggle-connection-mode-btn');
        if (connBtn) { connBtn.innerText = "TRYB ŁĄCZENIA: WYŁ"; connBtn.style.background = "#475569"; }
        const curveBtn = document.getElementById('toggle-curve-edit-btn');
        if (curveBtn) { curveBtn.innerText = "EDYCJA KRZYWYCH: WYŁ"; curveBtn.style.background = "#475569"; }
        const drawBtn = document.getElementById('toggle-draw-mode-btn');
        if (drawBtn) { drawBtn.innerText = "TRYB RYSOWANIA: WYŁ"; drawBtn.style.background = "#475569"; }
        
        renderBase();
    }

    // Aktualizacja przycisku w edytorze (prawy panel)
    const btnEditor = document.getElementById('toggle-label-edit-btn');
    if (btnEditor) {
        btnEditor.innerHTML = isLabelEditMode ? `<i class="fa-solid fa-xmark"></i> TRYB EDYCJI: WŁ` : `<i class="fa-solid fa-arrows-up-down-left-right"></i> TRYB EDYCJI: WYŁ`;
        btnEditor.style.background = isLabelEditMode ? 'var(--danger)' : '#334155';
    }

    // Aktualizacja pływającego przycisku
    const btnFloating = document.getElementById('floating-label-edit-btn');
    if (btnFloating) {
        btnFloating.style.background = isLabelEditMode ? 'var(--danger)' : 'rgba(30, 41, 59, 0.7)';
        btnFloating.style.boxShadow = isLabelEditMode ? '0 0 20px rgba(239, 68, 68, 0.5)' : '0 8px 25px rgba(0,0,0,0.5)';
        btnFloating.querySelector('i').className = isLabelEditMode ? 'fa-solid fa-xmark' : 'fa-solid fa-arrows-up-down-left-right';
        btnFloating.querySelector('i').style.color = 'white';
    }

    // Pasek obrotu
    const knobContainer = document.getElementById('interactive-editor-gui');
    if (knobContainer) {
        knobContainer.classList.toggle('active', isLabelEditMode);
        if (!isLabelEditMode) {
            selectedLabelForRotation = null;
            document.getElementById('knob-label-name').innerText = "Wybierz napis";
        }
    }

    renderBase();
    window.showToast(isLabelEditMode ? "Tryb edycji nazw aktywny" : "Tryb edycji nazw wyłączony", "info");
};

// --- OBSŁUGA POKRĘTEŁ EDYCYJNYCH ---
function initEditorKnobs() {
    const rotDial = document.getElementById('knob-rotation-dial');
    const sizeDial = document.getElementById('knob-size-dial');
    const rotInput = document.getElementById('knob-rotation-input');
    const sizeInput = document.getElementById('knob-size-input');
    
    let isDraggingRot = false;
    let isDraggingSize = false;
    let lastAngleRot = 0;
    let lastAngleSize = 0;
    let currentRotation = 0;
    let currentFontSize = 14;

    const getAngle = (x, y, dial) => {
        const rect = dial.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        return Math.atan2(y - centerY, x - centerX) * (180 / Math.PI);
    };

    const handleStartRot = (e) => {
        if (!selectedLabelForRotation) return;
        isDraggingRot = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        lastAngleRot = getAngle(clientX, clientY, rotDial);
        rotDial.style.transition = 'none';
        e.preventDefault();
    };

    const handleStartSize = (e) => {
        if (!selectedLabelForRotation) return;
        isDraggingSize = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        lastAngleSize = getAngle(clientX, clientY, sizeDial);
        sizeDial.style.transition = 'none';
        e.preventDefault();
    };

    const handleMove = (e) => {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        if (isDraggingRot && selectedLabelForRotation) {
            const currentAngle = getAngle(clientX, clientY, rotDial);
            let delta = currentAngle - lastAngleRot;
            
            // Obsługa przeskoku 180/-180
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            
            currentRotation += delta;
            lastAngleRot = currentAngle;
            
            updateRotationLive(Math.round(currentRotation));
        }

        if (isDraggingSize && selectedLabelForRotation) {
            const currentAngle = getAngle(clientX, clientY, sizeDial);
            let delta = currentAngle - lastAngleSize;
            
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;

            // Czułość rozmiaru: 10 stopni obrotu = 1px rozmiaru
            let newSize = currentFontSize + delta / 10;
            newSize = Math.max(8, Math.min(60, newSize));
            
            const sizeDiff = newSize - currentFontSize;
            currentFontSize = newSize;
            lastAngleSize = currentAngle;

            // Wizualny obrót pokrętła rozmiaru (kumulatywny)
            const currentDialRotation = (parseFloat(sizeDial.style.transform.replace('rotate(', '').replace('deg)', '')) || 0) + delta;
            updateSizeLive(Math.round(currentFontSize), currentDialRotation);
        }
    };

    const handleEnd = () => {
        if (isDraggingRot && selectedLabelForRotation) {
            const name = selectedLabelForRotation.name;
            update(ref(db, `stats/stacje_siec/${name}`), { rotation: Math.round(currentRotation) });
        }
        if (isDraggingSize && selectedLabelForRotation) {
            const name = selectedLabelForRotation.name;
            update(ref(db, `stats/stacje_siec/${name}`), { fontSize: Math.round(currentFontSize) });
        }
        
        isDraggingRot = false;
        isDraggingSize = false;
        rotDial.style.transition = 'transform 0.1s linear';
        sizeDial.style.transition = 'transform 0.1s linear';
    };

    const updateRotationLive = (deg) => {
        rotDial.style.transform = `rotate(${deg}deg)`;
        if (rotInput) rotInput.value = deg;
        if (selectedLabelForRotation && selectedLabelForRotation.element) {
            const s = selectedLabelForRotation.data;
            const x = s.x + (selectedLabelForRotation.finalDx || 0);
            const y = s.y + (selectedLabelForRotation.finalDy || 0);
            selectedLabelForRotation.element.setAttribute("transform", `rotate(${deg} ${x} ${y})`);
        }
    };

    const updateSizeLive = (size, angle) => {
        sizeDial.style.transform = `rotate(${angle}deg)`;
        sizeInput.value = size;
        if (selectedLabelForRotation && selectedLabelForRotation.element) {
            const textElem = selectedLabelForRotation.element;
            textElem.setAttribute("font-size", `${size}px`);
            // Aktualizuj tspan dla wielowierszowych
            textElem.querySelectorAll('tspan').forEach((t, i) => {
                t.setAttribute("font-size", `${size}px`);
                // Odstęp między wierszami (dy) musi być aktualizowany przy zmianie font-size
                if (i > 0) t.setAttribute("dy", `${size * 1.1}px`);
            });
        }
    };

    // Ręczna zmiana obrotu
    if (rotInput) {
        rotInput.addEventListener('input', (e) => {
            if (!selectedLabelForRotation) return;
            
            let val = e.target.value;
            
            // Pozwól na wpisanie samego minusa lub minusa z zerem
            if (val === "-" || val === "-0") {
                updateRotationLive(0);
                return;
            }

            let deg = parseInt(val) || 0;
            currentRotation = deg;
            updateRotationLive(deg);
            
            clearTimeout(rotInput._timer);
            rotInput._timer = setTimeout(() => {
                const name = selectedLabelForRotation.name;
                update(ref(db, `stats/stacje_siec/${name}`), { rotation: currentRotation });
            }, 500);
        });

        // Czyszczenie przy wyjściu z pola
        rotInput.addEventListener('blur', (e) => {
            if (e.target.value === "-" || e.target.value === "-0") {
                e.target.value = "";
            }
        });
    }

    // Ręczna zmiana rozmiaru
    sizeInput.addEventListener('input', (e) => {
        if (!selectedLabelForRotation) return;
        let size = parseInt(e.target.value) || 14;
        size = Math.max(8, Math.min(60, size));
        currentFontSize = size;
        // Resetujemy wizualny kąt pokrętła przy ręcznym wpisie dla spójności
        const angle = (size - 20) * 12;
        updateSizeLive(size, angle);
        
        clearTimeout(sizeInput._timer);
        sizeInput._timer = setTimeout(() => {
            const name = selectedLabelForRotation.name;
            update(ref(db, `stats/stacje_siec/${name}`), { fontSize: currentFontSize });
        }, 500);
    });

    rotDial.addEventListener('mousedown', handleStartRot);
    sizeDial.addEventListener('mousedown', handleStartSize);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);

    rotDial.addEventListener('touchstart', handleStartRot, { passive: false });
    sizeDial.addEventListener('touchstart', handleStartSize, { passive: false });
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    window.selectLabelForRotation = (name, element, data, finalDx, finalDy) => {
        selectedLabelForRotation = { name, element, data, finalDx, finalDy };
        
        currentRotation = data.rotation || 0;
        rotDial.style.transform = `rotate(${currentRotation}deg)`;
        if (rotInput) rotInput.value = currentRotation;

        currentFontSize = data.fontSize || 14;
        const sizeAngle = (currentFontSize - 20) * 12;
        sizeDial.style.transform = `rotate(${sizeAngle}deg)`;
        sizeInput.value = currentFontSize;

        document.getElementById('knob-label-name').innerText = name.toUpperCase().replace('|', ' / ');
        document.querySelectorAll('text').forEach(t => t.style.filter = "none");
        element.style.filter = "drop-shadow(0 0 5px var(--accent))";
    };
}

setTimeout(initEditorKnobs, 1000);
setTimeout(() => {
    newStationParentHandler = window.initTagsInput('new-st-parent-tags');
}, 1000);

window.updatePinSize = (val) => {
    globalPinSize = parseFloat(val);
    set(ref(db, 'stats/config/globalPinSize'), globalPinSize);
    renderBase();
    renderHeat();
};

window.updateGlobalPinColor = (val) => {
    globalPinColor = val;
    // Usunięto zapis do bazy - ma być tylko do odświeżenia strony
    renderBase();
    renderHeat();
};

window.updateGlobalLineWidth = (val) => {
    globalLineWidth = parseFloat(val);
    set(ref(db, 'stats/config/globalLineWidth'), globalLineWidth);
    renderBase();
    renderHeat();
};

window.updateGlobalHeatWidth = (val) => {
    globalHeatWidth = parseFloat(val);
    set(ref(db, 'stats/config/globalHeatWidth'), globalHeatWidth);
    renderHeat();
};

window.updateHeatLineThickness = (val) => {
    const thickness = parseFloat(val);
    set(ref(db, 'stats/config/heatLineThickness'), thickness);
    renderHeat();
};

window.updateHeatColorTheme = (val) => {
    heatColorTheme = val;
    set(ref(db, 'stats/config/heatColorTheme'), val);
    updateHeatLegend();
    renderHeat();
};

window.updateHeatMapBg = (val) => {
    heatMapBg = val;
    set(ref(db, 'stats/config/heatMapBg'), val);
    applyHeatMapBg();
};

// Client-side only heatmap background color - default to #0b0f1a (--bg-dark)
window.setHeatmapBg = (color) => {
    currentHeatmapBg = color;
    const wrapper = document.querySelector('#heatmap-modal .map-wrapper');
    if (wrapper) {
        wrapper.style.background = color;
    }
};

function applyHeatMapBg() {
    const wrapper = document.querySelector('#heatmap-modal .map-wrapper');
    if (wrapper) {
        wrapper.style.background = currentHeatmapBg;
    }
}

function updateHeatLegend() {
    const colors = heatThemes[heatColorTheme] || heatThemes.classic;
    document.querySelectorAll('.heat-legend-box').forEach(box => {
        const idx = parseInt(box.getAttribute('data-idx'));
        if (colors[idx]) box.style.background = colors[idx];
    });
}

window.saveDefaultView = (mode) => {
    if (mode === 'base') {
        set(ref(db, 'stats/config/defaultMapState'), mapState).then(() => {
            window.showToast("Domyślny widok edytora zapisany!", "success");
        });
    } else if (mode === 'heat') {
        set(ref(db, 'stats/config/defaultHeatState'), heatState).then(() => {
            window.showToast("Domyślny widok heatmapy zapisany!", "success");
        });
    }
};

window.updateGlobalTextRotation = (val) => {
    globalTextRotation = parseInt(val);
    set(ref(db, 'stats/config/globalTextRotation'), globalTextRotation);
    renderBase();
    renderHeat();
};

window.centerHeatmap = () => {
    const svg = document.getElementById('svg-heatmap');
    if (!svg) return;
    const parent = svg.parentNode;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    
    // Nowe wymiary 1200x1800
    const bgW = 1200;
    const bgH = 1800;

    // Oblicz skalę tak, aby obraz wypełnił widok (lepiej niż Math.min dla "ciapatych" map)
    const scale = Math.max(w / bgW, h / bgH) * 0.9;
    heatState.scale = scale;

    // Wyśrodkuj na ŚRODEK obrazu
    heatState.x = (w - bgW * scale) / 2;
    heatState.y = (h - bgH * scale) / 2;
    
    renderHeat();
    window.showToast("Heatmapa wycentrowana i wyostrzona", "success");
};

window.updateStationEditorBg = (url) => {
    stationEditorBg = url;
    set(ref(db, 'stats/config/stationEditorBg'), url);
    renderBase();
};

window.centerMapOnEditor = () => {
    const svg = document.getElementById('svg-map');
    if (!svg) return;
    const parent = svg.parentNode;
    const w = parent.clientWidth || 800;
    const h = parent.clientHeight || 600;
    
    const bgW = mapBgSettings.w || 1200;
    const bgH = mapBgSettings.h || 1800;
    const offX = mapBgSettings.offX || 0;
    const offY = mapBgSettings.offY || 0;

    // Oblicz skalę tak, aby obraz zmieścił się w widoku
    const scale = Math.min(w / bgW, h / bgH) * 1.0;
    mapState.scale = scale;
    
    // Aktualizuj suwak
    const slider = document.getElementById('map-zoom-slider');
    if (slider) {
        slider.value = scale;
        slider.min = Math.min(0.05, scale / 5);
        slider.max = Math.max(5, scale * 5);
    }

    // Wyśrodkuj na ŚRODEK obrazu
    mapState.x = w/2 - (offX + bgW/2) * scale;
    mapState.y = h/2 - (offY + bgH/2) * scale;
    
    renderBase();
    window.showToast("Widok wycentrowany na środek zdjęcia", "success");
};

function startMaintenanceCountdown() {
    if (maintenanceInterval) clearInterval(maintenanceInterval);
    
    const timerBox = document.getElementById('maintenance-timer-box');
    const display = document.getElementById('maintenance-countdown');
    
    if (!maintenanceEndTime || !isDeveloperModeActive) {
        if (timerBox) timerBox.style.display = 'none';
        return;
    }

    if (timerBox) timerBox.style.display = 'block';

    const updateTimer = () => {
        const now = new Date().getTime();
        const end = new Date(maintenanceEndTime).getTime();
        const diff = end - now;

        if (diff <= 0) {
            display.innerText = "00:00:00";
            clearInterval(maintenanceInterval);
            return;
        }

        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);

        display.innerText = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    updateTimer();
    maintenanceInterval = setInterval(updateTimer, 1000);
}

// Stany Zoomu (Domyślnie wyśrodkowane na system komunikacyjny)
let mapState = { x: 0, y: 0, scale: 0.33 }; // Dopasowane do nowej skali 1200x1800
let heatState = { x: 0, y: 0, scale: 0.7 };

// Init renderów
const renderBase = () => {
    try {
        renderMapElements('svg-map', mapState, 'base');
    } catch (e) {
        console.error("Błąd renderBase:", e);
    }
};

let currentTicketHeatmapTrips = null;
const renderHeat = (customUsage = null) => {
    try {
        applyHeatMapBg();
        renderMapElements('svg-heatmap', heatState, 'heat', customUsage);
        updateHotRoutesUI();
    } catch (e) {
        console.error("Błąd renderHeat:", e);
    }
};

window.openTicketHeatmap = (ticketId) => {
    const ticket = monthlyTickets.find(t => t.id === ticketId);
    if (!ticket) {
        window.showToast("Nie znaleziono biletu!", "error");
        return;
    }

    const ticketTrips = (ticket.trips || []).map(tripId => {
        const trip = tripsData.find(t => t.key === tripId);
        return trip || null;
    }).filter(t => t !== null);

    const customUsage = getUsageData(ticketTrips);
    currentTicketHeatmapTrips = ticketTrips;

    window.closeAllModals();
    document.getElementById('heatmap-modal').classList.add('active'); 
    window.setActiveMenuItem('menu-heatmap');
    document.body.classList.add('no-scroll');
    // Set color picker to current heatmap bg color
    const colorPicker = document.getElementById('heat-bg-color-picker');
    if (colorPicker) {
        colorPicker.value = currentHeatmapBg;
    }

    renderHeat(customUsage);
    window.showToast(`Heatmapa dla ${ticket.customName || ticket.type}!`, "success");
};

// NOWE: Zapisywanie widoku mapy lub heatmapy (jako domyślny w Firebase)
window.saveCurrentMapView = (type = 'map') => {
    if (!isAdminUnlocked && !isSecretPanelAuth) {
        window.showToast("Tylko administrator może zapisać domyślny widok!", "error");
        return;
    }

    const updates = {};
    if (type === 'map') {
        updates['stats/config/defaultMapState'] = { x: mapState.x, y: mapState.y, scale: mapState.scale };
        window.showToast("Widok MAPY zapisany jako domyślny!", "success");
    } else {
        updates['stats/config/defaultHeatState'] = { x: heatState.x, y: heatState.y, scale: heatState.scale };
        window.showToast("Widok HEATMAPY zapisany jako domyślny!", "success");
    }

    update(ref(db), updates).then(() => {
        // Zamknij menu edytora jeśli jest otwarte
        const editorMenu = document.getElementById('editor-side-menu');
        if (editorMenu && editorMenu.classList.contains('active')) {
            window.toggleEditorMenu();
        }
        
        const sideMenu = document.getElementById('side-menu');
        if (sideMenu && sideMenu.classList.contains('active')) {
            window.toggleMenu();
        }
    }).catch(err => {
        console.error("Błąd zapisu widoku:", err);
        window.showToast("Błąd zapisu!", "error");
    });
};

// NOWE: Wczytywanie widoku mapy (lokalne - opcjonalne, bo mamy Firebase)
function loadSavedMapView() {
    // Firebase onValue zajmuje się tym przy starcie (Object.assign)
    console.log("System widoków mapy zainicjowany");
}

// Wywołaj wczytywanie przy starcie
loadSavedMapView();

// Taryfa 2026
const taryfa = [
    {max: 6, cena: 7.00}, {max: 12, cena: 8.00}, {max: 18, cena: 9.00},
    {max: 24, cena: 11.00}, {max: 30, cena: 12.00}, {max: 40, cena: 14.00},
    {max: 50, cena: 16.00}, {max: 60, cena: 18.00}, {max: 70, cena: 20.00},
    {max: 80, cena: 22.00}, {max: 90, cena: 24.00}, {max: 100, cena: 26.00}
];

// --- CUSTOM GUI DIALOG SYSTEM (Non-Native) ---
window.showFullRanking = (title, items) => {
    const view = document.getElementById('full-ranking-view');
    const titleElem = document.getElementById('full-ranking-title');
    const content = document.getElementById('full-ranking-content');
    
    titleElem.innerText = title;
    content.innerHTML = "";
    
    items.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = "background: rgba(255,255,255,0.03); padding: 18px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);";
        div.innerHTML = `
            <div style="font-size: 15px; font-weight: 800; color: #fff; line-height: 1.4;">${item.label}</div>
            <div style="font-size: 13px; opacity: 0.8; color: var(--accent); font-weight: 700; letter-spacing: 0.5px;">${item.value}</div>
        `;
        content.appendChild(div);
    });
    
    view.style.display = "flex";
    // Dodaj animację wejścia
    view.style.animation = "modalFadeIn 0.3s ease-out forwards";
};

window.closeFullRanking = () => {
    document.getElementById('full-ranking-view').style.display = "none";
};

window.openUniversalEdit = (title, fields, onSave) => {
    const modal = document.getElementById('universal-edit-modal');
    const titleElem = document.getElementById('edit-modal-title');
    const fieldsContainer = document.getElementById('edit-modal-fields');
    const saveBtn = document.getElementById('edit-modal-save-btn');

    titleElem.innerText = title;
    fieldsContainer.innerHTML = "";
    
    // Przełączamy na grid jeśli jest więcej niż 4 pola
    const isGrid = fields.length > 4;
    fieldsContainer.style.display = "grid";
    fieldsContainer.style.gridTemplateColumns = isGrid ? "1fr 1fr" : "1fr";
    fieldsContainer.style.gap = "15px";

    const inputs = {};

    fields.forEach(field => {
        const wrap = document.createElement('div');
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "6px";
        
        // Pola tekstowe (textarea) lub nazwa stacji na całą szerokość w trybie grid
        if (isGrid && (field.type === 'textarea' || field.id === 'name' || field.id === 'parent')) {
            wrap.style.gridColumn = "span 2";
        }

        const label = document.createElement('label');
        label.innerText = field.label;
        label.style.fontSize = "11px";
        label.style.fontWeight = "700";
        label.style.color = "var(--accent)";
        label.style.letterSpacing = "0.5px";
        label.style.textTransform = "uppercase";
        label.style.opacity = "0.9";
        
        let input;
        if (field.type === 'select') {
            input = document.createElement('select');
            input.style.cssText = "background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 12px; border-radius: 10px; font-size: 14px; outline: none;";
            field.options.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.value;
                o.innerText = opt.label;
                if (opt.value === field.value) o.selected = true;
                input.appendChild(o);
            });
        } else if (field.type === 'checkbox') {
            // For checkbox, we'll create a container with checkbox and label
            wrap.style.flexDirection = 'row';
            wrap.style.alignItems = 'center';
            wrap.style.justifyContent = 'space-between';
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = field.value || false;
            input.style.cssText = "width: 20px; height: 20px; cursor: pointer; accent-color: var(--accent);";
        } else if (field.type === 'tags') {
            const tagContainer = document.createElement('div');
            tagContainer.className = 'tags-input-container';
            tagContainer.id = `tags-input-${field.id}`;
            tagContainer.innerHTML = `<input type="text" placeholder="${field.placeholder || 'Dodaj stację...'}" style="background: transparent; border: none; color: #fff; width: 100%; outline: none;">`;
            tagContainer.style.cssText = "background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 8px 12px; border-radius: 10px; display: flex; flex-wrap: wrap; gap: 5px; min-height: 45px; align-items: center;";
            
            if (isGrid) wrap.style.gridColumn = "span 2";

            wrap.appendChild(label);
            wrap.appendChild(tagContainer);
            fieldsContainer.appendChild(wrap);
            
            const handler = window.initTagsInput(tagContainer.id, field.value);
            inputs[field.id] = { 
                get value() { return handler.getTags().join(', '); },
                set value(v) { handler.setTags(v.split(',').map(t => t.trim()).filter(t => t)); }
            };
            return; 
        } else {
            const isTextarea = field.type === 'textarea';
            input = document.createElement(isTextarea ? 'textarea' : 'input');
            if (!isTextarea) input.type = field.type || 'text';
            
            // Obsługa "niewidzialnego zera" i wartości domyślnych
            if (field.value === 0 || field.value === "0") {
                input.value = ""; // Zero traktujemy jako brak wartości (pokazuje placeholder)
            } else {
                input.value = field.value || "";
            }
            
            input.style.cssText = `background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 12px; border-radius: 10px; font-size: 14px; outline: none; transition: border-color 0.2s; font-family: inherit;`;
            if (isTextarea) {
                input.style.height = "100px";
                input.style.resize = "none";
            }
            
            input.onfocus = () => input.style.borderColor = "var(--accent)";
            input.onblur = () => input.style.borderColor = "rgba(255,255,255,0.1)";
        }
        if (field.type !== 'checkbox') {
            input.placeholder = field.placeholder || "";
            input.style.width = "100%";
        }
        
        wrap.appendChild(label);
        wrap.appendChild(input);
        fieldsContainer.appendChild(wrap);
        
        inputs[field.id] = input;
    });

    modal.style.display = "flex";
    modal.classList.add('active');

    saveBtn.onclick = () => {
        const results = {};
        Object.keys(inputs).forEach(id => {
            // Find original field definition
            const field = fields.find(f => f.id === id);
            if (field && field.type === 'checkbox') {
                results[id] = inputs[id].checked;
            } else {
                results[id] = inputs[id].value;
            }
        });
        onSave(results);
        window.closeUniversalEdit();
    };
};

window.closeUniversalEdit = () => {
    const modal = document.getElementById('universal-edit-modal');
    modal.style.display = "none";
    modal.classList.remove('active');
};

window.showActionMenu = (event, actions) => {
    event.stopPropagation();
    const menu = document.getElementById('action-menu');
    menu.innerHTML = "";
    
    actions.forEach(action => {
        const item = document.createElement('div');
        item.className = `action-menu-item ${action.type || ""}`;
        item.innerHTML = `<i class="fa-solid ${action.icon}"></i> ${action.label}`;
        item.onclick = (e) => {
            e.stopPropagation();
            action.onClick();
            window.hideActionMenu();
        };
        menu.appendChild(item);
    });

    // Pozycjonowanie
    const x = Math.min(event.clientX, window.innerWidth - 160);
    const y = Math.min(event.clientY, window.innerHeight - (actions.length * 45));
    
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = "flex";

    // Zamknij przy kliknięciu gdziekolwiek indziej
    const closeMenu = () => {
        window.hideActionMenu();
        window.removeEventListener('click', closeMenu);
    };
    setTimeout(() => window.addEventListener('click', closeMenu), 10);
};

window.hideActionMenu = () => {
    const menu = document.getElementById('action-menu');
    menu.style.display = "none";
};

window.openDeleteConfirm = (details, onConfirm, buttonText = "TAK, USUŃ TRWALE") => {
    const modal = document.getElementById('delete-confirm-modal');
    const detailsElem = document.getElementById('delete-confirm-details');
    const yesBtn = document.getElementById('delete-confirm-yes');

    detailsElem.innerText = details;
    yesBtn.innerText = buttonText;
    modal.style.display = "flex";
    modal.classList.add('active');

    yesBtn.onclick = () => {
        onConfirm();
        window.closeDeleteConfirm();
    };
};

window.closeDeleteConfirm = () => {
    const modal = document.getElementById('delete-confirm-modal');
    modal.style.display = "none";
    modal.classList.remove('active');
};

window.showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `custom-toast ${type}`;
    
    // Używamy ikon FontAwesome zamiast emotek
    const iconClass = type === 'success' ? 'fa-circle-check' : 'fa-circle-xmark';
    const iconColor = type === 'success' ? 'var(--success)' : 'var(--danger)';
    
    toast.innerHTML = `
        <i class="fa-solid ${iconClass}" style="color: ${iconColor}; font-size: 18px;"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
};

window.addConsoleLog = (message, type = 'info') => {
    const consoleElem = document.getElementById('secret-console');
    if (!consoleElem) return;
    const entry = document.createElement('div');
    entry.className = `console-entry ${type}`;
    entry.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
    consoleElem.appendChild(entry);
    consoleElem.scrollTop = consoleElem.scrollHeight;
};

window.showCustomDialog = (title, message, options = {}) => {
    return new Promise((resolve) => {
        const overlay = document.getElementById('custom-dialog-overlay');
        const titleElem = document.getElementById('dialog-title');
        const msgElem = document.getElementById('dialog-message');
        const inputContainer = document.getElementById('dialog-input-container');
        const input = document.getElementById('dialog-input');
        const cancelBtn = document.getElementById('dialog-cancel-btn');
        const confirmBtn = document.getElementById('dialog-confirm-btn');

        titleElem.innerText = title;
        msgElem.innerText = message;
        input.value = options.defaultValue || "";
        inputContainer.style.display = options.showInput ? 'block' : 'none';
        cancelBtn.style.display = options.showCancel ? 'block' : 'none';
        confirmBtn.innerText = options.confirmText || 'OK';

        overlay.classList.add('active');
        if (options.showInput) {
            setTimeout(() => input.focus(), 100);
        }

        const cleanup = () => {
            overlay.classList.remove('active');
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
        };

        confirmBtn.onclick = () => {
            const val = options.showInput ? input.value : true;
            cleanup();
            resolve(val);
        };

        cancelBtn.onclick = () => {
            cleanup();
            resolve(null);
        };
    });
};

// Override native methods for unified App-Native Look
window.alert = async (msg) => await window.showCustomDialog("Powiadomienie", msg);
window.confirm = async (msg) => await window.showCustomDialog("Potwierdzenie", msg, { showCancel: true });
window.prompt = async (msg, def) => await window.showCustomDialog("Wprowadź dane", msg, { showInput: true, defaultValue: def, showCancel: true });

window.showNote = (note) => {
    if (!note) return;
    const dialog = document.getElementById('custom-dialog-overlay');
    if (dialog) {
        window.showCustomDialog("📝 Notatka do przejazdu", note);
    } else {
        // Fallback jeśli modal nie istnieje w DOM
        alert(note);
    }
};

// --- SYNCHRONIZACJA FIREBASE ---
onValue(statsRef, (s) => { 
    earnedSoFar = s.val() || 0; 
    updateProgressUI(); 
    window.showToast("Zsynchronizowano statystyki", "success");
});

let isInitialConfigLoad = true;
onValue(configRef, (s) => { 
    if (s.exists()) {
        const config = s.val();
        storedPassword = config.password;
        inviteCodes = config.inviteCodes || ["Albatrosowa1"];
        maintenanceEndTime = config.maintenanceEndTime || null;
        renderInviteCodes();
        stationEditorBg = config.stationEditorBg || null;
        isMapVisible = config.isMapVisible !== undefined ? config.isMapVisible : true;

        // Aplikuj domyślne widoki tylko przy pierwszym ładowaniu
        if (isInitialConfigLoad) {
            if (config.defaultMapState) {
                Object.assign(mapState, config.defaultMapState);
            }
            if (config.defaultHeatState) {
                Object.assign(heatState, config.defaultHeatState);
            }
            isInitialConfigLoad = false;
        }

        renderBase();
        renderHeat();
        
        if (config.lastExportDate) {
            const display = document.getElementById('last-export-date');
            if (display) display.innerText = config.lastExportDate;
        }

        showEditorBg = config.showEditorBg !== undefined ? config.showEditorBg : true;
        isCalcDisabled = config.isCalcDisabled || false;
        calcDisabledMsg = config.calcDisabledMsg || "Funkcja tymczasowo niedostępna.";
        mapBgSettings = config.mapBgSettings || { w: 1200, h: 1800, offX: 0, offY: 0 };
        systemStatus = config.systemStatus || "online";
        isDeveloperModeActive = config.isDeveloperModeActive || false;
        isForceAuthActive = config.isForceAuthActive || false;
        isGalleryAddModeActive = config.isGalleryAddModeActive || false;
        isCalcBtnActive = config.isCalcBtnActive || false; // NOWE
        isTariffTabVisible = config.isTariffTabVisible !== undefined ? config.isTariffTabVisible : true; // NOWE
        isCityRankingVisible = config.isCityRankingVisible !== undefined ? config.isCityRankingVisible : true;
        isGalleryTodoMode = config.isGalleryTodoMode || false; // NOWE
        
        if (config.achievementsConfig) {
            if (config.achievementsConfig.badges) {
                BADGE_LEVELS = config.achievementsConfig.badges;
            }
            if (config.achievementsConfig.achievements) {
                ACHIEVEMENTS = config.achievementsConfig.achievements;
            }
        } else {
            // Save defaults if not present
            set(ref(db, 'stats/config/achievementsConfig'), { badges: BADGE_LEVELS, achievements: ACHIEVEMENTS });
        }

        lastConfettiPercent = config.lastConfettiPercent || 0;
        lastConfettiTime = config.lastConfettiTime || null;
        isInitialConfigLoaded = true;

        updateAppVisibility();
        updateCalcBtnUI(); // NOWE
        updateGalleryAddModeUI(); // NOWE
        updateGalleryTodoModeUI(); // NOWE
        updateTariffTabVisibilityUI(); // NOWE
        updateCityRankingVisibilityUI();
        
        // Wymuś odświeżenie grafu i heatmapy po załadowaniu konfiguracji
        buildGlobalGraph();
        if (document.getElementById('svg-heatmap')) renderHeat();
        
        // Pokaż pływające GUI jeśli sesja jest aktywna
        const floatingGui = document.getElementById('floating-admin-gui');
        if (floatingGui && (isAdminUnlocked || isSecretPanelAuth)) {
            floatingGui.style.display = 'block';
            if (isGuiPinned) floatingGui.classList.add('active');
        }

        if (config.globalPinSize !== undefined) {
            globalPinSize = config.globalPinSize;
            // Aktualizuj suwaki w UI
            document.querySelectorAll('input[type="range"][oninput*="updatePinSize"]').forEach(input => {
                input.value = globalPinSize;
            });
        }

        if (config.globalPinColor !== undefined) {
            globalPinColor = config.globalPinColor;
            document.querySelectorAll('input[type="color"][oninput*="updateGlobalPinColor"]').forEach(input => {
                input.value = globalPinColor;
            });
        }
        
        if (config.globalLineWidth !== undefined) {
            globalLineWidth = config.globalLineWidth;
            document.querySelectorAll('input[type="range"][oninput*="updateGlobalLineWidth"]').forEach(input => {
                input.value = globalLineWidth;
            });
        }

        if (config.globalHeatWidth !== undefined) {
            globalHeatWidth = config.globalHeatWidth;
            document.querySelectorAll('input[type="range"][oninput*="updateGlobalHeatWidth"]').forEach(input => {
                input.value = globalHeatWidth;
            });
        }

        if (config.heatLineThickness !== undefined) {
            heatLineThickness = config.heatLineThickness;
            const input = document.getElementById('heat-line-thickness-input');
            if (input) input.value = heatLineThickness;
        }

        if (config.heatColorTheme !== undefined) {
            heatColorTheme = config.heatColorTheme;
            const select = document.getElementById('heat-color-theme');
            if (select) select.value = heatColorTheme;
            updateHeatLegend();
        }

        // No longer load heatMapBg from Firebase - keep client-side only

        if (config.globalTextRotation !== undefined) {
            globalTextRotation = config.globalTextRotation;
            document.querySelectorAll('input[type="range"][oninput*="updateGlobalTextRotation"]').forEach(input => {
                input.value = globalTextRotation;
            });
        }

        if (config.failedPasswords) {
            renderFailedPasswords(config.failedPasswords);
        } else {
            const list = document.getElementById('failed-passwords-list');
            if (list) list.innerHTML = '<p style="opacity: 0.5; text-align: center;">Brak prób włamań...</p>';
        }

        // Aktualizuj input w adminie jeśli istnieje
        const bgInput = document.getElementById('station-editor-bg');
        if (bgInput) bgInput.value = stationEditorBg || "";

        updateMaintenanceUI();
        updateMapVisibilityUI();
        updateCalcBtnUI();
        updateAdminPanelFields();
        updateProgressUI(); // Dodane: Odśwież UI z poprawnym stanem konfetti
        updateSystemStatusUI();
        renderBase(); // Odśwież mapę z nowym tłem jeśli trzeba
        
        // Update menu item
            updateMenuSettingsItem();
            
            // Restore admin UI if logged in
            if (isSecretPanelAuth) {
                const busTrigger = document.getElementById('admin-bus-trigger');
                if (busTrigger) {
                    busTrigger.classList.add('admin-unlocked');
                    busTrigger.classList.add('admin-active');
                    busTrigger.style.background = "var(--success)";
                    busTrigger.style.color = "#000";
                }
                const labelPanel = document.getElementById('admin-label-edit-panel');
                if (labelPanel) labelPanel.style.display = 'block';
                const floatingGui = document.getElementById('floating-admin-gui');
                if (floatingGui) {
                    floatingGui.style.display = 'block';
                    if (isGuiPinned) floatingGui.classList.add('active');
                }
            }
        
        window.addConsoleLog("Konfiguracja Firebase załadowana", "success");
        
        const inputFrom = document.getElementById('route-from');
        const inputTo = document.getElementById('route-to');
        if (inputFrom) inputFrom.addEventListener('input', renderMainHistoryList);
        if (inputTo) inputTo.addEventListener('input', renderMainHistoryList);
    }
});

function updateSystemStatusUI() {
    const statusContainers = document.querySelectorAll('.footer-online');
    if (statusContainers.length === 0) return;

    let statusText = "ONLINE";
    let color = "var(--success)";
    let icon = "online-dot";

    if (systemStatus === "offline") {
        statusText = "OFFLINE";
        color = "var(--danger)";
        icon = "offline-dot";
    } else if (systemStatus === "maintenance") {
        statusText = "PRACE KONSERWACYJNE";
        color = "var(--warning)";
        icon = "maintenance-dot";
    }

    statusContainers.forEach(container => {
        container.innerHTML = `
            <span class="${icon}" style="background-color: ${color}; box-shadow: 0 0 8px ${color};"></span>
            <span style="color: ${color}">${statusText}</span>
        `;
    });
}

window.setSystemStatus = (status) => {
    set(ref(db, 'stats/config/systemStatus'), status).then(() => {
        window.showToast(`Status systemu zmieniony na ${status.toUpperCase()}`, "success");
    });
};

window.saveConfettiState = () => {
    const percent = parseInt(document.getElementById('confetti-last-percent').value) || 0;
    const time = document.getElementById('confetti-last-time').value;
    update(configRef, { 
        lastConfettiPercent: percent,
        lastConfettiTime: time
    }).then(() => {
        window.showToast("Stan konfetti zapisany", "success");
    });
};

function updateMenuSettingsItem() {
    const menuItem = document.getElementById('menu-settings');
    const testTicketBtn = document.getElementById('menu-test-ticket');
    const testAchievementBtn = document.getElementById('menu-test-achievement');
    if (menuItem) {
        if (isSecretPanelAuth) {
            menuItem.innerHTML = '<i class="fa-solid fa-gear"></i> Ustawienia bazy';
        } else {
            menuItem.innerHTML = '<i class="fa-solid fa-table"></i> Cennik';
        }
    }
    // Show/hide test buttons
    if (testTicketBtn) testTicketBtn.style.display = isSecretPanelAuth ? 'flex' : 'none';
    if (testAchievementBtn) testAchievementBtn.style.display = isSecretPanelAuth ? 'flex' : 'none';
}

function updateAdminPanelFields() {
    // Status Systemu
    const statusSelect = document.getElementById('admin-system-status');
    if (statusSelect) statusSelect.value = systemStatus;

    // Zakładka Cennik
    const tariffTabBtn = document.getElementById('tariff-tab-toggle-btn');
    if (tariffTabBtn) {
        tariffTabBtn.innerText = isTariffTabVisible ? "📋 CENNIK: ON" : "📋 CENNIK: OFF";
        tariffTabBtn.style.background = isTariffTabVisible ? "var(--success)" : "var(--danger)";
    }

    // Konfetti
    const confPercent = document.getElementById('confetti-last-percent');
    const confTime = document.getElementById('confetti-last-time');
    if (confPercent) confPercent.value = lastConfettiPercent;
    if (confTime) confTime.value = lastConfettiTime || "Nigdy";

    // Blokada KM
    const lockBtn = document.getElementById('calc-lock-toggle-btn');
    const guiLockBtn = document.getElementById('gui-calc-lock-btn');
    if (lockBtn) {
        lockBtn.innerText = isCalcDisabled ? "WŁĄCZONA" : "WYŁĄCZONA";
        lockBtn.style.background = isCalcDisabled ? "var(--success)" : "var(--danger)";
    }
    if (guiLockBtn) {
        guiLockBtn.innerText = isCalcDisabled ? "BLOKADA FUNKCJA KM: OFF" : "BLOKADA FUNKCJA KM: ON";
        guiLockBtn.className = isCalcDisabled ? "gui-btn success" : "gui-btn danger";
    }

    // Widoczność KM
    const calcVisBtn = document.getElementById('calc-btn-toggle-btn');
    const guiCalcVisBtn = document.getElementById('gui-calc-btn-visibility');
    if (calcVisBtn) {
        calcVisBtn.innerText = isCalcBtnActive ? "WŁĄCZONY" : "WYŁĄCZONY";
        calcVisBtn.style.background = isCalcBtnActive ? "var(--success)" : "var(--danger)";
    }
    if (guiCalcVisBtn) {
        guiCalcVisBtn.innerText = isCalcBtnActive ? "WYŁĄCZ FUNKCJĘ KM" : "WŁĄCZ FUNKCJĘ KM";
        guiCalcVisBtn.className = isCalcBtnActive ? "gui-btn danger" : "gui-btn success";
    }

    // Konserwacja
    const maintBtn = document.getElementById('maintenance-toggle-btn');
    const guiMaintBtn = document.getElementById('gui-maint-btn');
    if (maintBtn) {
        maintBtn.innerText = isDeveloperModeActive ? 'WŁĄCZONY 🚧' : 'WYŁĄCZONY';
        maintBtn.style.background = isDeveloperModeActive ? 'var(--success)' : 'var(--danger)';
    }
    if (guiMaintBtn) {
        guiMaintBtn.innerText = isDeveloperModeActive ? "KONSERWACJA: ON" : "KONSERWACJA: OFF";
        guiMaintBtn.className = isDeveloperModeActive ? "gui-btn success" : "gui-btn danger";
    }

    // Ekran Startowy (Globalny Test)
    const forceAuthBtn = document.getElementById('force-auth-toggle-btn');
    const guiForceAuthBtn = document.getElementById('gui-force-auth-btn');
    const guiForceAuthStatus = document.getElementById('gui-force-auth-status');
    
    if (forceAuthBtn) {
        forceAuthBtn.innerText = isForceAuthActive ? "WŁĄCZONY" : "WYŁĄCZONY";
        forceAuthBtn.style.background = isForceAuthActive ? "var(--success)" : "var(--danger)";
    }
    if (guiForceAuthBtn) {
        guiForceAuthBtn.className = isForceAuthActive ? "gui-btn success" : "gui-btn danger";
    }
    if (guiForceAuthStatus) {
        guiForceAuthStatus.innerText = isForceAuthActive ? "WŁĄCZONY" : "WYŁĄCZONY";
    }

    const msgInput = document.getElementById('calc-lock-msg-input');
    if (msgInput) msgInput.value = calcDisabledMsg;

    // Skalowanie Mapy
    const mapW = document.getElementById('map-bg-w');
    const mapH = document.getElementById('map-bg-h');
    const mapOffX = document.getElementById('map-bg-offx');
    const mapOffY = document.getElementById('map-bg-offy');
    if (mapW) mapW.value = mapBgSettings.w;
    if (mapH) mapH.value = mapBgSettings.h;
    if (mapOffX) mapOffX.value = mapBgSettings.offX;
    if (mapOffY) mapOffY.value = mapBgSettings.offY;

    // Status Service Workera (Offline Cache)
    const swBadge = document.getElementById('sw-status-badge');
    if (swBadge) {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(reg => {
                if (reg && reg.active) {
                    swBadge.innerText = "POBRANO ✅";
                    swBadge.style.background = "var(--success)";
                } else {
                    swBadge.innerText = "NIEPOBRANO ❌";
                    swBadge.style.background = "var(--danger)";
                }
            });
        } else {
            swBadge.innerText = "NIEWSPIERANE ⚠️";
            swBadge.style.background = "#475569";
        }
    }
    
    renderInviteCodes();
}

window.simulateOfflineMode = () => {
    const offlineOverlay = document.getElementById('offline-overlay');
    if (offlineOverlay) {
        offlineOverlay.classList.add('active');
        initSky('offline-sky');
        window.showToast("Symulacja trybu offline aktywna (tylko wizualnie)", "warning");
        window.addConsoleLog("Uruchomiono symulację trybu offline", "info");
    }
};

window.clearAppCache = () => {
    if ('caches' in window) {
        caches.keys().then(names => {
            for (let name of names) caches.delete(name);
            window.showToast("Cache aplikacji wyczyszczony. Odśwież stronę.", "success");
            window.addConsoleLog("Cache aplikacji wyczyszczony", "warning");
        });
    }
};

window.exportData = (format) => {
    const data = {
        stations: stations,
        connections: connectionsData,
        trips: tripsData,
        exportDate: new Date().toISOString()
    };

    let blob, filename;
    // UTF-8 BOM to support Polish characters in Excel
    const BOM = '\uFEFF';
    if (format === 'json') {
        blob = new Blob([BOM + JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        filename = `regio-data-${new Date().toLocaleDateString()}.json`;
    } else {
        // Uproszczony eksport do CSV (lista stacji)
        let csv = BOM + "NAZWA,KM,X,Y,RODZICE\n";
        Object.keys(stations).forEach(k => {
            const s = stations[k];
            csv += `${k.toUpperCase()},${s.km || 0},${s.x},${s.y},"${s.parent || ''}"\n`;
        });
        blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        filename = `regio-stations-${new Date().toLocaleDateString()}.csv`;
    }

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    
    // Zapisz datę ostatniego eksportu
    const now = new Date().toLocaleString();
    localStorage.setItem('last_export_date', now);
    
    // Zapisz do Firebase
    set(ref(db, 'stats/config/lastExportDate'), now);

    const display = document.getElementById('last-export-date');
    if (display) display.innerText = now;

    window.showToast(`Dane wyeksportowane do ${format.toUpperCase()}`, "success");
};

// Funkcja wczytująca datę eksportu na starcie
function loadLastExportDate() {
    const last = localStorage.getItem('last_export_date');
    const display = document.getElementById('last-export-date');
    if (display && last) display.innerText = last;
}

function updateCalcBtnUI() {
    const btn = document.getElementById('calc-km-btn');
    const toggle = document.getElementById('calc-btn-toggle-btn');
    
    if (btn) {
        btn.style.display = isCalcBtnActive ? 'block' : 'none';
        
        if (isCalcDisabled) {
            btn.classList.add('calc-disabled');
            btn.innerHTML = `<span style="text-decoration: line-through; color: var(--danger);">🧮 OBLICZ KM</span>`;
            btn.style.background = "#475569";
        } else {
            btn.classList.remove('calc-disabled');
            btn.innerHTML = "🧮 OBLICZ KM";
            btn.style.background = "var(--accent)";
        }
    }

    if (toggle) {
        toggle.innerText = isCalcBtnActive ? 'WŁĄCZONY' : 'WYŁĄCZONY';
        toggle.style.background = isCalcBtnActive ? 'var(--success)' : 'var(--danger)';
    }
}

window.toggleCalcLock = () => {
    const newState = !isCalcDisabled;
    set(ref(db, 'stats/config/isCalcDisabled'), newState).then(() => {
        window.showToast(newState ? "Blokada KM włączona" : "Blokada KM wyłączona", "success");
    });
};

window.refreshAchievements = () => {
    // Recalculate all achievements based on current stats
    calculateAchievements();
    window.showToast('Osiągnięcia odświeżone!', 'success');
};

window.renderAdminAchievements = () => {
    const badgesContainer = document.getElementById('admin-badge-levels-list');
    const achContainer = document.getElementById('admin-achievements-list');
    if (!badgesContainer || !achContainer) return;

    badgesContainer.innerHTML = '';
    
    // Add refresh button at top
    const refreshBtn = document.createElement('div');
    refreshBtn.innerHTML = `
        <button onclick="window.refreshAchievements()" style="width:100%; margin-bottom: 15px; padding:10px; background:var(--accent); border:none; border-radius:8px; font-weight:800; cursor:pointer;">
            <i class="fa-solid fa-rotate-right"></i> ODŚWIEŻ OSIĄGNIĘCIA
        </button>
    `;
    badgesContainer.appendChild(refreshBtn);
    BADGE_LEVELS.forEach((badge, idx) => {
        const div = document.createElement('div');
        const isRainbow = badge.color === 'RAINBOW';
        const badgeColor = isRainbow ? 'var(--accent)' : badge.color;
        div.style.cssText = `display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; border-left: 4px solid ${badgeColor};`;
        if (isRainbow) {
            div.classList.add('rainbow-border');
        }
        div.innerHTML = `
            <div style="display: flex; flex-direction: column;">
                <span class="${isRainbow ? 'rainbow-text' : ''}" style="font-weight: 800; color: ${isRainbow ? '' : badgeColor};">Poziom ${idx + 1}: ${badge.name}</span>
                <span style="font-size: 10px; opacity: 0.6;">Kolor: ${badge.color}</span>
            </div>
            <div style="display: flex; gap: 5px;">
                <button onclick="window.editBadgeLevel(${idx})" class="gadget-btn" style="background: var(--info); width: auto; padding: 5px 15px; font-size: 10px;">EDYTUJ</button>
                <button onclick="window.removeBadgeLevel(${idx})" class="gadget-btn" style="background: var(--danger); width: auto; padding: 5px 15px; font-size: 10px;" ${BADGE_LEVELS.length <= 1 ? 'disabled' : ''}>USUŃ</button>
            </div>
        `;
        badgesContainer.appendChild(div);
    });
    // Add new badge level button
    const addBadgeBtn = document.createElement('div');
    addBadgeBtn.innerHTML = `
        <button onclick="window.addNewBadgeLevel()" style="width:100%; margin-top: 10px; padding:10px; background: var(--success); border:none; border-radius:8px; font-weight:800; cursor:pointer;">
            <i class="fa-solid fa-plus"></i> DODAJ NOWY POZIOM ODZNACZENIA
        </button>
    `;
    badgesContainer.appendChild(addBadgeBtn);

    achContainer.innerHTML = '';
    ACHIEVEMENTS.forEach((ach, idx) => {
        const userData = userAchievements[ach.id] || {};
        const currentLevelIdx = userData.levelIndex || -1;
        const div = document.createElement('div');
        div.style.cssText = `background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;`;
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fa-solid ${ach.icon}" style="font-size: 20px; color: var(--accent);"></i>
                    <div>
                        <div style="font-weight: 800;">${ach.name} <span style="opacity:0.6;font-size:10px;">(Poziom ${currentLevelIdx + 1})</span>
                            ${ach.secret ? '<span style="font-size:9px; background:#ff0000; padding:2px 6px; border-radius:4px; margin-left:4px;">TAJNE</span>' : ''}
                        </div>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <span style="font-size: 10px; opacity: 0.6;">${ach.description}</span>
                            <span style="font-size:9px; background:var(--accent); padding:2px 6px; border-radius:4px;">${ach.category || 'SERIA'}</span>
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap:5px;">
                    <button onclick="window.editAchievement(${idx})" class="gadget-btn" style="background: var(--info); width: auto; padding: 5px 15px; font-size: 10px;">EDYTUJ</button>
                    <button onclick="window.deleteAchievement(${idx})" class="gadget-btn" style="background: var(--danger); width: auto; padding: 5px 15px; font-size: 10px;">USUŃ</button>
                </div>
            </div>
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <button onclick="window.addAchievementLevel('${ach.id}')" class="gadget-btn" style="background: var(--success); flex: 1; font-size: 10px;">
                    <i class="fa-solid fa-plus"></i> DODAJ POZIOM DO OSIĄGNIĘCIA
                </button>
                <button onclick="window.removeAchievementLevel('${ach.id}')" class="gadget-btn" style="background: var(--danger); flex: 1; font-size: 10px;" ${currentLevelIdx < 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-minus"></i> ODEJMIJ POZIOM
                </button>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 5px;">
                ${ach.levels.map((l, i) => `<span style="font-size: 10px; background: ${i <= currentLevelIdx ? 'var(--success)' : 'rgba(0,0,0,0.3)'}; padding: 3px 8px; border-radius: 4px;">P${i+1}: ${l.threshold}</span>`).join('')}
            </div>
        `;
        achContainer.appendChild(div);
    });
    // Add new achievement button
    const addAchBtn = document.createElement('div');
    addAchBtn.innerHTML = `
        <button onclick="window.addNewAchievement()" style="width:100%; margin-top: 10px; padding:10px; background: var(--success); border:none; border-radius:8px; font-weight:800; cursor:pointer;">
            <i class="fa-solid fa-plus"></i> DODAJ NOWE OSIĄGNIĘCIE
        </button>
    `;
    achContainer.appendChild(addAchBtn);
};

window.addNewBadgeLevel = () => {
    const newBadge = {
        name: `Nowy Poziom ${BADGE_LEVELS.length + 1}`,
        color: '#ffffff'
    };
    BADGE_LEVELS.push(newBadge);
    set(ref(db, 'stats/config/achievementsConfig/badges'), BADGE_LEVELS)
        .then(() => {
            window.showToast('Nowy poziom odznaczenia dodany!', 'success');
            renderAdminAchievements();
        });
};

window.removeBadgeLevel = (idx) => {
    if (BADGE_LEVELS.length <= 1) {
        window.showToast('Musisz mieć conajmniej 1 poziom odznaczenia!', 'error');
        return;
    }
    BADGE_LEVELS.splice(idx, 1);
    set(ref(db, 'stats/config/achievementsConfig/badges'), BADGE_LEVELS)
        .then(() => {
            window.showToast('Poziom odznaczenia usunięty!', 'success');
            renderAdminAchievements();
        });
};

window.addNewAchievement = () => {
    window.openUniversalEdit('Dodaj Nowe Osiągnięcie', [
        { id: 'name', label: 'Nazwa Osiągnięcia', value: 'Nowe Osiągnięcie' },
        { id: 'icon', label: 'Ikona FontAwesome (np. fa-train)', value: 'fa-star' },
        { id: 'description', label: 'Opis', type: 'textarea', value: 'Opis osiągnięcia' },
        { 
            id: 'category', 
            label: 'Kategoria', 
            value: 'SERIA', 
            type: 'select',
            options: ACHIEVEMENT_CATEGORIES
        },
        { 
            id: 'type', 
            label: 'Typ (statystyka do śledzenia)', 
            value: ACHIEVEMENT_TYPES.DISTANCE, 
            type: 'select',
            options: Object.entries(ACHIEVEMENT_TYPES).map(([key, val]) => ({ value: val, label: key }))
        },
        { id: 'secret', label: 'Osiągnięcie tajne (ukryte do momentu odblokowania)', type: 'checkbox', value: false },
        { id: 'threshold1', label: 'Próg dla Poziomu 1', type: 'number', value: 10 },
        { id: 'threshold2', label: 'Próg dla Poziomu 2 (opcjonalnie)', type: 'number', placeholder: 'Pozostaw puste, aby nie dodawać' },
        { id: 'threshold3', label: 'Próg dla Poziomu 3 (opcjonalnie)', type: 'number', placeholder: 'Pozostaw puste, aby nie dodawać' }
    ], (res) => {
        const levels = [];
        if (res.threshold1) levels.push({ threshold: parseInt(res.threshold1) });
        if (res.threshold2) levels.push({ threshold: parseInt(res.threshold2) });
        if (res.threshold3) levels.push({ threshold: parseInt(res.threshold3) });
        
        if (!res.name || levels.length === 0) {
            window.showToast('Nazwa i co najmniej jeden próg są wymagane!', 'error');
            return;
        }
        
        const newAchievement = {
            id: `ach_${Date.now()}`,
            name: res.name,
            icon: res.icon || 'fa-star',
            description: res.description || '',
            category: res.category || 'SERIA',
            type: res.type || ACHIEVEMENT_TYPES.DISTANCE,
            secret: res.secret || false,
            levels: levels
        };
        
        ACHIEVEMENTS.push(newAchievement);
        set(ref(db, 'stats/config/achievementsConfig/achievements'), ACHIEVEMENTS)
            .then(() => {
                window.showToast('Nowe osiągnięcie dodane!', 'success');
                renderAdminAchievements();
            });
    });
};

window.deleteAchievement = async (idx) => {
    const ach = ACHIEVEMENTS[idx];
    const confirmed = await window.confirm(`Czy na pewno chcesz usunąć osiągnięcie "${ach.name}"?`);
    if (confirmed) {
        ACHIEVEMENTS.splice(idx, 1);
        set(ref(db, 'stats/config/achievementsConfig/achievements'), ACHIEVEMENTS);
        remove(ref(db, `stats/achievements/${ach.id}`));
        renderAdminAchievements();
        window.showToast('Osiągnięcie usunięte!', 'success');
    }
};

window.editBadgeLevel = (idx) => {
    const badge = BADGE_LEVELS[idx];
    const isRainbow = badge.color === 'RAINBOW';
    window.openUniversalEdit(`Edycja Poziomu ${idx + 1}`, [
        { id: 'name', label: 'Nazwa Poziomu (np. Brąz)', value: badge.name },
        { 
            id: 'colorType', 
            label: 'Typ Koloru', 
            value: isRainbow ? 'RAINBOW' : 'HEX', 
            type: 'select',
            options: [
                { value: 'HEX', label: 'Kolor HEX' },
                { value: 'RAINBOW', label: 'Tęczowy (Animacja)' }
            ]
        },
        { 
            id: 'color', 
            label: 'Kolor (HEX, tylko jeśli typ HEX)', 
            value: isRainbow ? '#ffffff' : badge.color, 
            type: 'color' 
        }
    ], (res) => {
        BADGE_LEVELS[idx].name = res.name;
        BADGE_LEVELS[idx].color = res.colorType === 'RAINBOW' ? 'RAINBOW' : res.color;
        set(ref(db, 'stats/config/achievementsConfig/badges'), BADGE_LEVELS)
            .then(() => {
                window.showToast("Zapisano poziom", "success");
                renderAdminAchievements();
                if (document.getElementById('achievements-modal').classList.contains('active')) renderAchievements();
            });
    });
};

window.editAchievement = (idx) => {
    const ach = ACHIEVEMENTS[idx];
    
    // Prepare fields - start with basic info
    const fields = [
        { id: 'name', label: 'Nazwa Osiągnięcia', value: ach.name },
        { id: 'icon', label: 'Ikona FontAwesome (np. fa-train)', value: ach.icon },
        { id: 'description', label: 'Opis', type: 'textarea', value: ach.description },
        { 
            id: 'category', 
            label: 'Kategoria', 
            value: ach.category || 'SERIA', 
            type: 'select',
            options: ACHIEVEMENT_CATEGORIES
        },
        { 
            id: 'type', 
            label: 'Typ (statystyka do śledzenia)', 
            value: ach.type || ACHIEVEMENT_TYPES.DISTANCE, 
            type: 'select',
            options: Object.entries(ACHIEVEMENT_TYPES).map(([key, val]) => ({ value: val, label: key }))
        },
        { id: 'secret', label: 'Osiągnięcie tajne (ukryte do momentu odblokowania)', type: 'checkbox', value: ach.secret || false }
    ];
    
    // Add threshold fields for each level
    ach.levels.forEach((level, i) => {
        fields.push({ 
            id: `threshold${i + 1}`, 
            label: `Próg dla Poziomu ${i + 1}`, 
            type: 'number', 
            value: level.threshold 
        });
    });
    
    // Add field for optionally adding one more level
    fields.push({ 
        id: 'thresholdNew', 
        label: `Próg dla NOWEGO Poziomu ${ach.levels.length + 1} (opcjonalnie)`, 
        type: 'number', 
        placeholder: 'Pozostaw puste, aby nie dodawać' 
    });
    
    window.openUniversalEdit(`Edytuj Osiągnięcie: ${ach.name}`, fields, (res) => {
        // Update basic info
        ach.name = res.name;
        ach.icon = res.icon;
        ach.description = res.description;
        ach.category = res.category;
        ach.type = res.type;
        ach.secret = res.secret || false;
        
        // Update existing levels
        ach.levels.forEach((level, i) => {
            if (res[`threshold${i + 1}`]) {
                level.threshold = parseInt(res[`threshold${i + 1}`]);
            }
        });
        
        // Add new level if provided
        if (res.thresholdNew) {
            ach.levels.push({ threshold: parseInt(res.thresholdNew) });
        }
        
        set(ref(db, 'stats/config/achievementsConfig/achievements'), ACHIEVEMENTS)
            .then(() => {
                window.showToast('Osiągnięcie zaktualizowane!', 'success');
                renderAdminAchievements();
                if (document.getElementById('achievements-modal').classList.contains('active')) renderAchievements();
            });
    });
};

window.toggleCityRanking = () => {
    const newState = !isCityRankingVisible;
    update(configRef, { isCityRankingVisible: newState })
        .then(() => window.showToast(newState ? "Ranking miast widoczny" : "Ranking miast ukryty", "success"))
        .catch(err => window.showToast("Błąd uprawnień", "error"));
};

function updateCityRankingVisibilityUI() {
    const btn = document.getElementById('city-ranking-toggle-btn');
    if (btn) {
        btn.innerText = isCityRankingVisible ? "RANKING: WIDOCZNY" : "RANKING: UKRYTY";
        btn.style.background = isCityRankingVisible ? "var(--success)" : "var(--danger)";
    }
    
    const card = document.getElementById('top-cities-card');
    if (card) {
        card.style.display = isCityRankingVisible ? "block" : "none";
    }
}

window.toggleTariffTabVisibility = () => {
    const newState = !isTariffTabVisible;
    set(ref(db, 'stats/config/isTariffTabVisible'), newState).then(() => {
        window.showToast(newState ? "Zakładka Cennik włączona" : "Zakładka Cennik wyłączona", "success");
    });
};

function updateTariffTabVisibilityUI() {
    const tabBtn = document.getElementById('settings-tab-tables');
    if (tabBtn) {
        tabBtn.style.display = isTariffTabVisible ? 'block' : 'none';
        
        // Jeśli aktualnie jesteśmy na zakładce cennika, a ona zostaje wyłączona, przełączamy na stacje
        if (!isTariffTabVisible && tabBtn.classList.contains('active')) {
            window.switchSettingsTab('stations');
        }
    }
}

window.saveCalcLockMsg = () => {
    const msg = document.getElementById('calc-lock-msg-input').value;
    set(ref(db, 'stats/config/calcDisabledMsg'), msg).then(() => {
        window.showToast("Komunikat blokady zapisany", "success");
    });
};

window.saveMapBgSettings = () => {
    const w = parseInt(document.getElementById('map-bg-w').value) || 1200;
    const h = parseInt(document.getElementById('map-bg-h').value) || 1800;
    const offX = parseInt(document.getElementById('map-bg-offx').value) || 0;
    const offY = parseInt(document.getElementById('map-bg-offy').value) || 0;

    const newSettings = { w, h, offX, offY };
    set(ref(db, 'stats/config/mapBgSettings'), newSettings).then(() => {
        window.showToast("Ustawienia tła zapisane", "success");
    });
};

function updateMapVisibilityUI() {
    const toggleBtn = document.getElementById('map-visibility-toggle-btn');
    if (toggleBtn) {
        toggleBtn.innerText = showEditorBg ? 'WIDOCZNE' : 'UKRYTE';
        toggleBtn.style.background = showEditorBg ? 'var(--success)' : 'var(--danger)';
    }
}

window.toggleMapVisibility = () => {
    const newState = !showEditorBg;
    set(ref(db, 'stats/config/showEditorBg'), newState).then(() => {
        window.showToast(newState ? "Tło edytora widoczne" : "Tło edytora ukryte", "success");
    });
};
onValue(stationsRef, (s) => { 
    let rawStations = s.val() || {}; 
    
    // Normalizacja kluczy na małe litery i obsługa tablicy
    stations = {};
    if (Array.isArray(rawStations)) {
        rawStations.forEach((val, idx) => { 
            if(val) {
                const key = idx.toString();
                stations[key] = val; 
            }
        });
    } else {
        Object.keys(rawStations).forEach(key => {
            const normalizedKey = key.toLowerCase().trim();
            stations[normalizedKey] = rawStations[key];
        });
    }

    renderAdminStations();
    updateDatalists(); 
    renderBase();
    if (document.getElementById('svg-heatmap')) {
        renderHeat();
    }
    
    const count = Object.keys(stations).length;
    const badge = document.getElementById('station-count-badge');
    if (badge) {
        badge.innerText = `STACJE: ${count}`;
    }
    const settingsBadge = document.getElementById('settings-station-count');
    if (settingsBadge) {
        settingsBadge.innerText = `STACJE: ${count}`;
    }
});

onValue(connectionsRef, (s) => {
    connectionsData = s.val() || {};
    renderBase();
    renderHeat();
    renderAdminConnections();
});

window.toggleConnectionMode = () => {
    isConnectionMode = !isConnectionMode;
    connectionStartStation = null;
    
    if (isConnectionMode) {
        isCurveEditMode = false;
        isDrawMode = false;
        isParentSelectionMode = false;
        // Aktualizacja przycisków innych trybów
        const curveBtn = document.getElementById('toggle-curve-edit-btn');
        if (curveBtn) { curveBtn.innerText = "EDYCJA KRZYWYCH: WYŁ"; curveBtn.style.background = "#475569"; }
        const drawBtn = document.getElementById('toggle-draw-mode-btn');
        if (drawBtn) { drawBtn.innerText = "TRYB RYSOWANIA: WYŁ"; drawBtn.style.background = "#475569"; }
    }

    const btn = document.getElementById('toggle-connection-mode-btn');
    if (btn) {
        btn.innerText = isConnectionMode ? "ŁĄCZENIE: WŁ" : "ŁĄCZENIE: WYŁ";
        btn.style.background = isConnectionMode ? "var(--success)" : "#475569";
    }
    window.showToast(isConnectionMode ? "Tryb łączenia aktywny - klikaj dwie stacje" : "Tryb łączenia wyłączony", "info");
    renderBase();
};

window.clearAllConnectionsFromStation = () => {
    window.showToast("Wybierz stację na mapie, aby usunąć WSZYSTKIE jej połączenia", "warning");
    isConnectionMode = false;
    isCurveEditMode = false;
    isParentSelectionMode = false;
    
    // Używamy jednorazowego eventu na SVG
    const svg = document.getElementById('svg-map');
    const onStationClick = (e) => {
        const target = e.target;
        if (target.tagName === 'circle' && target.getAttribute('fill') !== 'transparent') {
            // Znaleźliśmy stację
            // Musimy znaleźć klucz stacji na podstawie współrzędnych lub sprawdzić wszystkie stacje
            const cx = parseFloat(target.getAttribute('cx'));
            const cy = parseFloat(target.getAttribute('cy'));
            
            const stationKey = Object.keys(stations).find(k => stations[k].x === cx && stations[k].y === cy);
            
            if (stationKey) {
                window.openDeleteConfirm(`Czy na pewno chcesz usunąć WSZYSTKIE połączenia stacji ${stationKey.toUpperCase()}?`, () => {
                    // 1. Czyścimy parent w tej stacji
                    update(ref(db, `stats/stacje_siec/${stationKey}`), { parent: null });
                    
                    // 2. Czyścimy parenty w innych stacjach, które wskazują na tę stację
                    Object.keys(stations).forEach(sKey => {
                        const parents = getParents(stations[sKey]);
                        if (parents.includes(stationKey.toLowerCase())) {
                            const newParents = parents.filter(p => p !== stationKey.toLowerCase()).join(', ');
                            update(ref(db, `stats/stacje_siec/${sKey}`), { parent: newParents || null });
                        }
                    });
                    
                    // 3. Czyścimy polaczeniaData
                    Object.keys(connectionsData).forEach(id => {
                        if (id.includes(stationKey.toLowerCase())) {
                            remove(ref(db, `stats/polaczenia/${id}`));
                        }
                    });
                    
                    window.showToast(`Połączenia stacji ${stationKey.toUpperCase()} zostały usunięte`, "success");
                    renderBase();
                });
            }
            svg.removeEventListener('click', onStationClick, true);
        }
    };
    svg.addEventListener('click', onStationClick, true);
};

window.toggleEditorMenu = () => {
    const menu = document.getElementById('editor-side-menu');
    if (menu) {
        menu.classList.toggle('active');
        // Jeśli otwieramy menu edytora, upewnijmy się że główne menu jest zamknięte
        if (menu.classList.contains('active')) {
            document.getElementById('side-menu').classList.remove('active');
            document.getElementById('menu-overlay').classList.remove('active');
        }
    }
};

window.toggleCurveEditMode = () => {
    isCurveEditMode = !isCurveEditMode;
    
    if (isCurveEditMode) {
        isConnectionMode = false;
        isDrawMode = false;
        isParentSelectionMode = false;
        // Aktualizacja przycisków innych trybów
        const connBtn = document.getElementById('toggle-connection-mode-btn');
        if (connBtn) { connBtn.innerText = "TRYB ŁĄCZENIA: WYŁ"; connBtn.style.background = "#475569"; }
        const drawBtn = document.getElementById('toggle-draw-mode-btn');
        if (drawBtn) { drawBtn.innerText = "TRYB RYSOWANIA: WYŁ"; drawBtn.style.background = "#475569"; }
    }

    const btn = document.getElementById('toggle-curve-edit-btn');
    if (btn) {
        btn.innerText = isCurveEditMode ? "EDYCJA KRZYWYCH: WŁ" : "EDYCJA KRZYWYCH: WYŁ";
        btn.style.background = isCurveEditMode ? "var(--success)" : "#475569";
    }
    renderBase();
};

window.addConnection = (stA, stB) => {
    // stA to stacja kliknięta jako pierwsza (OD)
    // stB to stacja kliknięta jako druga (DO)
    // Chcemy, aby stA (OD) została dodana jako nadrzędna do stB (DO)
    window.toggleParent(stB, stA);
};

window.updateCurve = (id, cx, cy) => {
    const conn = connectionsData[id] || {};
    set(ref(db, `stats/polaczenia/${id}`), { ...conn, type: 'curve', cx, cy }).then(() => {
        renderBase();
    });
};

window.editConnection = (id) => {
    const conn = connectionsData[id];
    if (!conn) return;

    const typeOptions = [
        { value: 'regio', label: 'REGIO (Czerwony)' },
        { value: 'skm', label: 'SKM (Żółty)' },
        { value: 'ic', label: 'IC (Niebieski)' },
        { value: 'custom', label: 'WŁASNY KOLOR' }
    ];

    const fields = [
        { id: 'connType', label: 'Typ linii', value: conn.connType || 'regio', type: 'select', options: typeOptions },
        { id: 'color', label: 'Kolor (jeśli własny)', value: conn.color || '#ffffff', type: 'color' },
        { id: 'width', label: 'Szerokość linii', value: conn.width || 4, type: 'number' }
    ];

    if (conn.isCustom) {
        fields.push({ id: 'x1', label: 'Start X', value: conn.x1, type: 'number' });
        fields.push({ id: 'y1', label: 'Start Y', value: conn.y1, type: 'number' });
        fields.push({ id: 'x2', label: 'End X', value: conn.x2, type: 'number' });
        fields.push({ id: 'y2', label: 'End Y', value: conn.y2, type: 'number' });
    }

    window.openUniversalEdit("Edytuj Połączenie", fields, (res) => {
        const updatedConn = {
            ...conn,
            connType: res.connType,
            color: res.color,
            width: parseFloat(res.width) || 4
        };

        if (conn.isCustom) {
            updatedConn.x1 = parseInt(res.x1);
            updatedConn.y1 = parseInt(res.y1);
            updatedConn.x2 = parseInt(res.x2);
            updatedConn.y2 = parseInt(res.y2);
        }

        set(ref(db, `stats/polaczenia/${id}`), updatedConn).then(() => {
            window.showToast("Połączenie zaktualizowane!", "success");
        });
    });
};

window.toggleParentSelectionMode = (sourceName) => {
    if (isParentSelectionMode && parentSelectionSource === sourceName) {
        isParentSelectionMode = false;
        parentSelectionSource = null;
        window.showToast("Wyłączono tryb wyboru nadrzędnych", "info");
    } else {
        isParentSelectionMode = true;
        parentSelectionSource = sourceName;
        isConnectionMode = false;
        isCurveEditMode = false;
        isDrawMode = false;
        
        // Aktualizacja przycisków innych trybów
        const connBtn = document.getElementById('toggle-connection-mode-btn');
        if (connBtn) { connBtn.innerText = "TRYB ŁĄCZENIA: WYŁ"; connBtn.style.background = "#475569"; }
        const curveBtn = document.getElementById('toggle-curve-edit-btn');
        if (curveBtn) { curveBtn.innerText = "EDYCJA KRZYWYCH: WYŁ"; curveBtn.style.background = "#475569"; }
        const drawBtn = document.getElementById('toggle-draw-mode-btn');
        if (drawBtn) { drawBtn.innerText = "TRYB RYSOWANIA: WYŁ"; drawBtn.style.background = "#475569"; }

        window.showToast(`Tryb wyboru nadrzędnych dla ${sourceName.toUpperCase()} - klikaj inne stacje`, "info");
    }
    renderBase();
};

window.toggleParent = (sourceName, targetName) => {
    if (sourceName === targetName) return;
    const s = stations[sourceName];
    if (!s) return;

    let parents = getParents(s);
    const targetIdx = parents.indexOf(targetName.toLowerCase());

    if (targetIdx > -1) {
        parents.splice(targetIdx, 1);
        window.showToast(`Usunięto ${targetName.toUpperCase()} z nadrzędnych`, "info");
        
        // DODATKOWO: Usuwamy z polaczenia, jeśli tam istniało (żeby linia nie została)
        const connId = [sourceName.toLowerCase(), targetName.toLowerCase()].sort().join('|');
        remove(ref(db, `stats/polaczenia/${connId}`));
    } else {
        parents.push(targetName.toLowerCase());
        window.showToast(`Dodano ${targetName.toUpperCase()} do nadrzędnych`, "success");
    }

    const newParentStr = parents.join(', ');
    update(ref(db, `stats/stacje_siec/${sourceName}`), { parent: newParentStr }).then(() => {
        renderBase();
    });
};

function renderAdminConnections() {
    const container = document.getElementById('admin-connections-list');
    if (!container) return;
    container.innerHTML = "";

    const customConns = Object.entries(connectionsData).filter(([id, conn]) => conn.isCustom);
    
    if (customConns.length === 0) {
        container.innerHTML = `<div style="font-size: 9px; opacity: 0.4; text-align: center; padding: 10px;">Brak narysowanych linii</div>`;
        return;
    }

    customConns.forEach(([id, conn]) => {
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px; border-radius:8px; font-size:10px; border-left: 3px solid " + (conn.color || "var(--warning)") + "; cursor: pointer;";
        
        const label = conn.isCustom ? `Linia (${conn.x1},${conn.y1} → ${conn.x2},${conn.y2})` : id;
        
        div.innerHTML = `
            <div style="flex-grow: 1;">
                <b>${label}</b><br>
                <small style="opacity:0.7">W: ${conn.width || 4} | T: ${conn.connType.toUpperCase()}</small>
            </div>
            <div style="display: flex; gap: 5px;">
                <i class="fa-solid fa-pen" onclick="event.stopPropagation(); window.editConnection(\`${id}\`)"></i>
                <i class="fa-solid fa-trash" style="color: var(--danger);" onclick="event.stopPropagation(); window.openDeleteConfirm('Czy chcesz usunąć tę linię?', () => remove(ref(db, \`stats/polaczenia/${id}\`)))"></i>
            </div>
        `;
        div.onclick = () => {
            // Można tu dodać centrowanie na linii
        };
        container.appendChild(div);
    });
}

window.toggleDrawMode = () => {
    // Funkcja wyłączona - zastąpiona przez widoczność mapy
    window.showToast("Tryb rysownika został wyłączony", "info");
};

window.clearDrawTemp = () => {
    // Funkcja wyłączona
};

window.startFreeDrawing = () => {
    // Ta funkcja została zastąpiona przez toggleDrawMode
};

function renderAdminStations(filter = "") {
    const adminStationsList = document.getElementById('admin-stations-list');
    if (!adminStationsList) return;
    adminStationsList.innerHTML = "";
    
    const q = filter.toLowerCase().trim();
    Object.keys(stations).sort().forEach(key => {
        if (key.includes(q)) {
            appendAdminStationItem(adminStationsList, key, stations[key]);
        }
    });
}

function appendAdminStationItem(container, key, data) {
    const div = document.createElement('div');
    div.className = "admin-list-item";
    div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px; border-radius:10px; font-size:12px; border-left: 3px solid #fbbf24; cursor: pointer;";
    div.innerHTML = `
        <div>
            <b style="color:#fbbf24">${key.toUpperCase()}</b><br>
            <small style="opacity:0.7">KM: ${data.km} | P: ${data.parent || '-'}</small>
        </div>
        <i class="fa-solid fa-ellipsis-vertical" style="padding: 10px; opacity: 0.5;"></i>
    `;
    div.onclick = (e) => window.showActionMenu(e, [
        { label: '🔗 Wybierz nadrzędne (klikaniem)', icon: 'fa-link', onClick: () => window.toggleParentSelectionMode(key) },
        { label: 'Edytuj stację', icon: 'fa-pen', onClick: () => window.editStationName(key) },
        { label: 'Usuń stację', icon: 'fa-trash', type: 'danger', onClick: () => window.deleteStation(key) }
    ]);
    container.appendChild(div);
}

window.editStationName = (key) => {
    const oldData = stations[key.toLowerCase().trim()];
    
    const labelOptions = [
        { value: 'right', label: 'Bok (Prawy)' },
        { value: 'left', label: 'Bok (Lewy)' },
        { value: 'top', label: 'Góra' },
        { value: 'bottom', label: 'Dół' },
        { value: 'top-right', label: 'Skos (Góra-Prawo)' },
        { value: 'top-left', label: 'Skos (Góra-Lewo)' },
        { value: 'bottom-right', label: 'Skos (Dół-Prawo)' },
        { value: 'bottom-left', label: 'Skos (Dół-Lewo)' }
    ];

    window.openUniversalEdit("Edytuj Stację", [
        { id: 'name', label: 'Nazwa stacji (użyj | dla nowej linii)', value: key.toUpperCase() },
        { id: 'km', label: 'Kilometry (KM)', value: oldData.km, type: 'number', placeholder: '0' },
        { id: 'x', label: 'Pozycja X', value: oldData.x, type: 'number' },
        { id: 'y', label: 'Pozycja Y', value: oldData.y, type: 'number' },
        { id: 'labelPos', label: 'Pozycja nazwy', value: oldData.labelPos || 'right', type: 'select', options: labelOptions },
        { id: 'fontSize', label: 'Rozmiar tekstu (px)', value: oldData.fontSize, type: 'number', placeholder: '14' },
        { id: 'rotation', label: 'Obrót tekstu (stopnie)', value: oldData.rotation, type: 'number', placeholder: '0' },
        { id: 'radius', label: 'Rozmiar kropki (Radius)', value: oldData.radius, type: 'number', placeholder: globalPinSize.toString() },
        { id: 'offX', label: 'Offset X tekstu', value: oldData.offX, type: 'number', placeholder: '0' },
        { id: 'offY', label: 'Offset Y tekstu', value: oldData.offY, type: 'number', placeholder: '0' },
        { id: 'color', label: 'Kolor kropki', value: oldData.color || globalPinColor, type: 'color' },
        { id: 'parent', label: 'Stacje nadrzędne', value: oldData.parent || "", type: 'tags' }
    ], (res) => {
        const newName = res.name.toLowerCase().trim();
        
        // Funkcja pomocnicza do parsowania lub usuwania wartości
        const pInt = (v) => (v === "" || v === null || v === undefined) ? null : parseInt(v);
        const pFloat = (v) => (v === "" || v === null || v === undefined) ? null : parseFloat(v);

        const updatedData = {
            ...oldData,
            km: pFloat(res.km),
            x: pInt(res.x) || 0,
            y: pInt(res.y) || 0,
            labelPos: res.labelPos,
            fontSize: pInt(res.fontSize),
            rotation: pInt(res.rotation),
            radius: pInt(res.radius),
            offX: pInt(res.offX),
            offY: pInt(res.offY),
            color: res.color,
            parent: res.parent ? res.parent.toLowerCase().trim() : null
        };

        // Usuwamy klucze z wartością null, aby Firebase ich nie zapisywał (użycie domyślnych)
        Object.keys(updatedData).forEach(k => {
            if (updatedData[k] === null) delete updatedData[k];
        });

        // Czyścimy polaczenia w bazie dla usuniętych nadrzędnych
        const oldParents = getParents(oldData);
        const currentParents = updatedData.parent ? updatedData.parent.split(',').map(p => p.trim().toLowerCase()).filter(p => p) : [];
        oldParents.forEach(oldP => {
            if (!currentParents.includes(oldP)) {
                const connId = [key.toLowerCase().trim(), oldP].sort().join('|');
                remove(ref(db, `stats/polaczenia/${connId}`));
            }
        });

        set(ref(db, `stats/stacje_siec/${newName}`), updatedData).then(() => {
            if (newName !== key.toLowerCase().trim()) {
                remove(ref(db, `stats/stacje_siec/${key}`));
                Object.keys(stations).forEach(sKey => {
                    const sParents = getParents(stations[sKey]);
                    if (sParents.includes(key.toLowerCase().trim())) {
                        const newParents = sParents.map(p => p === key.toLowerCase().trim() ? newName : p).join(', ');
                        set(ref(db, `stats/stacje_siec/${sKey}/parent`), newParents);
                    }
                });
            }
            window.showToast("Stacja zaktualizowana!", "success");
        });
    });
};

window.deleteStation = (key) => {
    window.openDeleteConfirm(`To trwale usunie stację ${key.toUpperCase()} z bazy danych.`, () => {
        remove(ref(db, `stats/stacje_siec/${key}`)).then(() => {
            // Czyścimy połączenia w polaczeniaData dla tej stacji
            Object.keys(connectionsData).forEach(id => {
                if (id.includes(key.toLowerCase().trim())) {
                    remove(ref(db, `stats/polaczenia/${id}`));
                }
            });
            window.showToast("Stacja usunięta.", "success");
        });
    });
};
window.toggleGalleryCompleted = (key) => {
    const item = galleryData.find(g => g.key === key);
    if (!item) return;
    
    // Statusy: 0 - brak, 1 - X, 2 - ✓ (z skreśleniem)
    let currentStatus = item.status || 0;
    // Starsze rekordy mogły mieć pole 'completed' (true/false)
    if (currentStatus === 0 && item.completed) currentStatus = 2;

    let nextStatus = (currentStatus + 1) % 3;

    update(ref(db, `stats/schematy/${key}`), {
        status: nextStatus,
        completed: nextStatus === 2 // Kompatybilność wsteczna
    }).then(() => {
        let msg = "Zmieniono status";
        if (nextStatus === 0) msg = "Wyczyszczono status";
        if (nextStatus === 1) msg = "Oznaczono jako X ❌";
        if (nextStatus === 2) msg = "Ukończono i skreślono ✓";
        window.showToast(msg, "success");
    });
};

function renderGallery() {
    const list = document.getElementById('gallery-list');
    const adminList = document.getElementById('admin-gallery-list');
    const galleryTabs = document.getElementById('gallery-tabs');
    const galleryModalTitle = document.getElementById('gallery-modal-title');
    const menuGalleryText = document.getElementById('menu-gallery-text');
    const galleryAddPanelTitle = document.getElementById('gallery-add-panel-title');
    const quickGalleryAddBtn = document.getElementById('quick-gallery-add-btn');

    if (list) list.innerHTML = "";
    if (adminList) adminList.innerHTML = "";

    // Update UI based on mode
    if (isGalleryTodoMode) {
        if (galleryTabs) galleryTabs.style.display = 'none';
        if (galleryModalTitle) galleryModalTitle.textContent = '✅ TO DO';
        if (menuGalleryText) menuGalleryText.textContent = 'TO DO';
        if (galleryAddPanelTitle) galleryAddPanelTitle.textContent = '➕ DODAJ ZADANIE';
        if (quickGalleryAddBtn) quickGalleryAddBtn.textContent = 'DODAJ ZADANIE';
    } else {
        if (galleryTabs) galleryTabs.style.display = 'flex';
        if (galleryModalTitle) galleryModalTitle.textContent = '🖼️ Schematy i Map';
        if (menuGalleryText) menuGalleryText.textContent = 'Schematy';
        if (galleryAddPanelTitle) galleryAddPanelTitle.textContent = '➕ SZYBKIE DODAWANIE';
        if (quickGalleryAddBtn) quickGalleryAddBtn.textContent = 'DODAJ SCHEMAT';
    }

    // Filter data based on mode and active tab
    let filteredData = [];
    if (isGalleryTodoMode) {
        // Full todo mode - show only items with type=todo
        filteredData = galleryData.filter(item => item.type === 'todo');
    } else {
        // Split by type - default type is 'schemat' if not specified
        if (activeGalleryTab === 'schematy') {
            filteredData = galleryData.filter(item => !item.type || item.type === 'schemat');
        } else {
            filteredData = galleryData.filter(item => item.type === 'todo');
        }
    }

    if (filteredData.length > 0) {
        filteredData.forEach((item, idx) => {
            const key = item.key;
            const status = item.status || (item.completed ? 2 : 0);
            const isTodoMode = isGalleryTodoMode || item.type === 'todo';
            
            // 1. Widok dla użytkownika
            const div = document.createElement('div');
            
            // In todo mode, no symbols or line-through!
            if (!isTodoMode) {
                div.className = 'gallery-item';
                if (status === 2) div.classList.add('completed');
                if (status === 1) div.classList.add('status-x');
            } else {
                div.className = item.src ? 'gallery-item' : 'text-note-item';
            }
            
            div.setAttribute('data-key', key);

            let symbol = '';
            let textStyle = '';
            if (!isTodoMode) {
                if (status === 1) symbol = `<span class="gallery-symbol-x">X </span>`;
                if (status === 2) {
                    symbol = `<span class="gallery-checkmark">✓ </span>`;
                    textStyle = 'text-decoration: line-through; opacity: 0.6;';
                }
            }

            if (item.src) {
                const w = item.w || 1600;
                const h = item.h || 2000;

                div.innerHTML = `
                    <div style="font-weight:600; margin-bottom:10px; color:var(--accent); display:flex; justify-content:space-between; align-items:center;">
                        <span style="display:flex; align-items:center; cursor:pointer; ${textStyle}" onclick="window.toggleGalleryCompleted('${key}')">${symbol}${item.title || 'Bez tytułu'}</span>
                        <small style="opacity:0.5; font-size:10px;">${w}x${h}px</small>
                    </div>
                    <img src="${item.src}" class="schemat-thumb" 
                         onclick="window.fullView(${galleryData.findIndex(g => g.key === key)})" 
                         alt="${item.title}"
                         style="width:100%; height:auto; border-radius:12px; display:block;">
                `;
            } else {
                div.className = 'text-note-item';
                div.style.cursor = 'pointer';
                if (!isTodoMode) {
                    if (status === 1) div.classList.add('status-x');
                    if (status === 2) div.classList.add('completed');
                }

                const isLink = item.title.trim().startsWith('http://') || item.title.trim().startsWith('https://');
                if (isLink) {
                    const linkUrl = item.title.trim();
                    div.innerHTML = `
                        <div style="cursor: pointer; width: 100%; display:flex; align-items:center; ${textStyle}" onclick="window.toggleGalleryCompleted('${key}')">
                            ${symbol}
                            <i class="fa-solid fa-link" style="margin-right: 10px; color: var(--accent);"></i>
                            <b onclick="event.stopPropagation(); window.open('${linkUrl}', '_blank')">${item.title}</b>
                        </div>
                    `;
                } else {
                    div.innerHTML = `<div style="display:flex; align-items:center; width:100%; height:100%; ${textStyle}" onclick="window.toggleGalleryCompleted('${key}')">${symbol}<b>${item.title}</b></div>`;
                }
            }
            if (list) list.appendChild(div);

            // 2. Widok dla admina (do usuwania i zmiany kolejności)
            if (adminList) {
                const adminDiv = document.createElement('div');
                adminDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px; border-radius:10px; font-size:12px; cursor: pointer;";
                
                let adminSymbol = "";
                if (!isTodoMode) {
                    if (status === 1) adminSymbol = '<span style="color:var(--danger); margin-right:5px;">[X]</span> ';
                    if (status === 2) adminSymbol = '<span style="color:var(--success); margin-right:5px;">[✓]</span> ';
                }

                adminDiv.innerHTML = `
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${adminSymbol}${item.title}</span>
                    <i class="fa-solid fa-ellipsis-vertical" style="padding: 10px; opacity: 0.5;"></i>
                `;
                
                const menuItems = [
                    { label: 'Przesuń w górę', icon: 'fa-arrow-up', onClick: () => window.reorderGalleryItem(key, 'up') },
                    { label: 'Przesuń w dół', icon: 'fa-arrow-down', onClick: () => window.reorderGalleryItem(key, 'down') }
                ];
                
                if (!isTodoMode) {
                    menuItems.push({ label: item.completed ? 'Cofnij ukończenie' : 'DODAJ CHECKMARK', icon: 'fa-check', onClick: () => window.toggleGalleryCompleted(key) });
                }
                
                menuItems.push(
                    { label: 'Edytuj element', icon: 'fa-pen', onClick: () => window.editGalleryItem(key) },
                    { label: 'Usuń element', icon: 'fa-trash', type: 'danger', onClick: () => window.deleteGalleryItem(key) }
                );
                
                adminDiv.onclick = (e) => window.showActionMenu(e, menuItems);
                adminList.appendChild(adminDiv);
            }
        });
    } else {
        const emptyMsg = isGalleryTodoMode 
            ? 'Brak zadań w bazie.' 
            : (activeGalleryTab === 'schematy' ? 'Brak schematów w bazie.' : 'Brak zadań w bazie.');
        if (list) list.innerHTML = `<p style="text-align:center; opacity:0.5;">${emptyMsg}</p>`;
        if (adminList) adminList.innerHTML = '<p style="text-align:center; opacity:0.5; font-size:11px;">Baza pusta.</p>';
    }
}

onValue(schematyRef, (s) => {
    galleryData = [];

    if(s.exists()) {
        s.forEach(child => {
            const item = child.val();
            const key = child.key;
            galleryData.push({ ...item, key: key });
        });

        // Sortowanie według pola 'order'
        galleryData.sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    
    renderGallery();
});
onValue(tripsRef, (s) => {
    tripsData = [];
    totalDistance = 0;
    totalIcTrips = 0;
    totalPrTrips = 0;
    totalSkmTrips = 0;
    
    if(s.exists()) {
        s.forEach(child => {
            const t = child.val();
            const key = child.key;
            tripsData.push({ ...t, key: key });
            
            // Calculate total distance
            if (t.km) {
                totalDistance += parseFloat(t.km);
            }
            
            // Check for train types
            if (t.regioNum) {
                const numStr = t.regioNum.toString().toUpperCase();
                if (numStr.includes('IC')) {
                    totalIcTrips += 1;
                }
                if (numStr.includes('PR')) {
                    totalPrTrips += 1;
                }
                if (numStr.includes('SKM')) {
                    totalSkmTrips += 1;
                }
            }
        });
        
        // Check for achievement updates
        checkAchievements();
        
        renderFullHistory();
        renderMainHistoryList();
        renderAdminTrips();
        updateLeaderboards();
        renderHeat(); // Dodane: Odśwież heatmapę przy nowych danych
        updateProgressUI();
    }
    updateHotRoutesUI();
});

// Listen to monthly ticket data
onValue(ticketRef, (s) => {
    ticketData = s.val() || null;
    if (ticketData && ticketData.startTime) {
        // Calculate end time
        const startTime = new Date(ticketData.startTime + 'T00:00:00');
        const endTime = new Date(startTime);
        endTime.setMonth(endTime.getMonth() + 1);
        endTime.setDate(endTime.getDate() - 1);
        endTime.setHours(23, 59, 0, 0);
        ticketData.endTime = endTime;
        // Check for expiration reminders
        checkTicketExpiration();
    }
});

// Listen to user achievements
onValue(achievementsRef, (s) => {
    userAchievements = s.exists() ? s.val() : {};
    renderAchievements();
    if (document.getElementById('admin-achievements-list')) renderAdminAchievements();
});

// Load monthly tickets
loadMonthlyTickets();

function renderFullHistory() {
    const tableBody = document.getElementById('full-history-table-body');
    const tableHeader = document.querySelector('#history-modal thead');
    const simulationInfo = document.getElementById('history-simulation-info');
    if (!tableBody) return;
    console.log("renderFullHistory called, isAdminUnlocked:", isAdminUnlocked);

    // Get current ticket (simulated or active)
    let ticket = null;
    let tripsToShow = [];
    if (simulatedTicketId) {
        ticket = monthlyTickets.find(t => t.id === simulatedTicketId);
        if (ticket) {
            // Show simulation info
            const ticketName = ticket.customName || ticket.type;
            simulationInfo.style.display = 'block';
            simulationInfo.textContent = `🎭 Symulacja biletu: ${ticketName}`;
        }
    } else {
        const activeTickets = monthlyTickets.filter(t => !t.archived);
        if (activeTickets.length > 0) {
            ticket = activeTickets[0];
        }
        simulationInfo.style.display = 'none';
    }

    if (ticket) {
        const ticketTripKeys = new Set(ticket.trips || []);
        tripsToShow = tripsData.filter(t => ticketTripKeys.has(t.key));
    }

    // Podświetlanie aktywnego sortowania w nagłówku
    if (tableHeader) {
        tableHeader.querySelectorAll('th[onclick]').forEach(th => {
            const onclickAttr = th.getAttribute('onclick');
            const keyMatch = onclickAttr ? onclickAttr.match(/'(.*?)'/) : null;
            if (keyMatch && keyMatch[1] === historySortConfig.key) {
                th.style.color = "var(--accent)";
                th.style.fontWeight = "900";
                const arrow = historySortConfig.direction === 'asc' ? ' ↑' : ' ↓';
                // Usuwamy stare strzałki
                th.innerHTML = th.innerHTML.replace(/[↑↓]/g, '').trim() + arrow;
            } else {
                th.style.color = "";
                th.style.fontWeight = "";
                th.innerHTML = th.innerHTML.replace(/[↑↓]/g, '').trim();
            }
        });
    }

    tableBody.innerHTML = "";
    const sorted = [...tripsToShow].sort((a, b) => {
        let valA = a[historySortConfig.key];
        let valB = b[historySortConfig.key];

        // Specjalna obsługa daty DD.MM.RRRR
        if (historySortConfig.key === 'data') {
            const partsA = (valA || '').split('.');
            const partsB = (valB || '').split('.');
            valA = new Date(partsA[2], partsA[1] - 1, partsA[0]).getTime();
            valB = new Date(partsB[2], partsB[1] - 1, partsB[0]).getTime();
        }

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return historySortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return historySortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    sorted.forEach(t => {
        const noteHtml = t.note ? `<td onclick="window.showNote(\`${t.note.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)" style="font-size:10px; opacity:0.7; max-width:150px; overflow:hidden; text-overflow:ellipsis; cursor: pointer; color: var(--warning);">${t.note}</td>` : `<td style="opacity:0.3">---</td>`;
        const rawZl = parseFloat(t.zl || t.cost || 0);
        const isPart = !!t.isPart;
        const priceDisplay = isPart ? "- zł" : `${(isNaN(rawZl) ? 0 : rawZl).toFixed(2)} zł`;
        const priceColor = isPart ? "opacity: 0.3;" : "color:var(--success); font-weight:900";
        const editIconHtml = isAdminUnlocked && !ticket?.archived ? `<span onclick="event.stopPropagation(); window.editTrip('${t.key}')" style="display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; background:var(--accent); border-radius:6px; margin-right:8px; cursor:pointer; transition:transform 0.2s;"><i class="fa-solid fa-pen" style="font-size:12px; color:white;"></i></span>` : '';
        
        const row = `
            <tr>
                <td>${editIconHtml}${t.data || t.date || '---'}</td>
                <td>${t.nr || t.trainNumber || '---'}</td>
                <td>${t.unit || '---'}</td>
                <td>${(t.od || t.from || '').toUpperCase()}</td>
                <td>${(t.do || t.to || '').toUpperCase()}</td>
                <td style="${priceColor}">${priceDisplay}</td>
                ${noteHtml}
            </tr>
        `;
        tableBody.innerHTML += row;
    });
}

function renderMainHistoryList() {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = "";

    // Pobierz wartości z inputów, aby wiedzieć co podświetlić
    const inputFrom = document.getElementById('route-from');
    const inputTo = document.getElementById('route-to');
    
    const currentFrom = inputFrom ? inputFrom.value.toLowerCase().trim() : "";
    const currentTo = inputTo ? inputTo.value.toLowerCase().trim() : "";

    // Pobierz bilet (symulowany lub aktywny) i jego wybrane przejazdy
    let ticket = null;
    if (simulatedTicketId) {
        ticket = monthlyTickets.find(t => t.id === simulatedTicketId);
    } else {
        const activeTickets = monthlyTickets.filter(t => !t.archived);
        if (activeTickets.length > 0) ticket = activeTickets[0];
    }

    let tripsToShow = [];
    if (ticket) {
        const ticketTripKeys = new Set(ticket.trips || []);
        tripsToShow = tripsData.filter(t => ticketTripKeys.has(t.key)).slice(-3).reverse();
    }

    // Pokazuj tylko przejazdy z aktywnego biletu
    tripsToShow.forEach(t => {
        const tOd = t.od.toLowerCase().trim();
        const tDo = t.do.toLowerCase().trim();
        
        // Sprawdź czy trasa pasuje do obecnie wpisywanej (w obie strony)
        const isActive = (tOd === currentFrom && tDo === currentTo) || (tOd === currentTo && tDo === currentFrom);
        const activeStyle = isActive ? "border: 2px solid var(--accent); background: rgba(129, 140, 248, 0.15); box-shadow: 0 0 15px rgba(129, 140, 248, 0.2);" : "";

        const div = document.createElement('div');
        div.className = 'history-item';
        div.style.cursor = 'pointer';
        div.style.userSelect = 'none';
        
        // Ręczne wykrywanie podwójnego kliknięcia (Double Tap)
        let lastClick = 0;
        let clickTimer = null;

        const handleTap = (e) => {
            const now = Date.now();
            const delay = now - lastClick;
            
            // Sprawdź w co dokładnie kliknięto
            const isNoteClick = e.target.classList.contains('history-note');
            const isDateClick = e.target.classList.contains('history-date');
            const isEditBtnClick = e.target.classList.contains('history-edit-btn');

            if (delay < 400 && delay > 0) {
                // DOUBLE TAP - EDYCJA (gdziekolwiek w kartę)
                clearTimeout(clickTimer);
                e.preventDefault();
                e.stopPropagation();
                triggerEdit();
                lastClick = 0;
            } else {
                // SINGLE TAP
                lastClick = now;
                
                clickTimer = setTimeout(() => {
                    if (isEditBtnClick) {
                        // Kliknięcie w ołówek -> Od razu edycja
                        e.preventDefault();
                        e.stopPropagation();
                        triggerEdit();
                    } else if (isDateClick) {
                        // Kliknięcie w datę (pojedyncze) -> Otwórz edycję
                        triggerEdit();
                    } else if (isNoteClick && t.note) {
                        // Kliknięcie w notatkę -> Pokaż treść
                        window.showNote(t.note);
                    }
                }, 300);
            }
        };

        const triggerEdit = () => {
            if (isAdminUnlocked) {
                window.editTrip(t.key);
            } else {
                window.showUniversalLogin(() => {
                    window.editTrip(t.key);
                });
            }
        };

        div.addEventListener('click', handleTap);


        if (isActive) div.style.cssText += activeStyle;

        const rawZl = parseFloat(t.zl);
        const isPart = !!t.isPart;
        const priceDisplay = isPart ? "- zł" : `+${(isNaN(rawZl) ? 0 : rawZl).toFixed(2)} zł`;
        const priceColor = isPart ? "rgba(255,255,255,0.3)" : (isActive ? 'var(--accent)' : 'var(--success)');

        const isAdmin = isAdminUnlocked;

        div.innerHTML = `
            <div style="flex: 1;">
                <b style="color:#fff">${t.nr || '---'}</b> ${t.unit ? `<small style="opacity:0.6">[${t.unit}]</small>` : ''} | <small class="history-date" style="padding: 2px 5px; background: rgba(255,255,255,0.05); border-radius: 4px;">${t.data}</small><br>
                <span style="${isActive ? 'color: var(--accent); font-weight: 800;' : ''}">${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()}</span>
                ${t.note ? `<br><small class="history-note" style="color:var(--warning); font-style:italic; cursor: pointer; display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.note}</small>` : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
                ${isAdmin ? `<i class="fa-solid fa-pen history-edit-btn" style="color: var(--accent); opacity: 0.6; padding: 10px; cursor: pointer; font-size: 14px;"></i>` : ''}
                <div style="color:${priceColor}; font-weight:900">${priceDisplay}</div>
            </div>
        `;
        list.appendChild(div);
    });
}

window.addVisitedCity = () => {
    const nameInput = document.getElementById('new-city-name');
    const countInput = document.getElementById('new-city-count');
    const name = nameInput.value.trim().toUpperCase();
    const count = parseInt(countInput.value) || 0;

    if (!name) return window.showToast("Podaj nazwę miasta!", "error");

    set(ref(db, `stats/visited_cities/${name}`), count).then(() => {
        nameInput.value = "";
        countInput.value = "1";
        window.showToast("Zaktualizowano wizyty miasta", "success");
    });
};

function renderAdminCities() {
    const container = document.getElementById('admin-cities-list');
    if (!container) return;
    container.innerHTML = "";

    // Sortowanie alfabetyczne miast
    const sortedCities = Object.entries(visitedCitiesData).sort((a, b) => a[0].localeCompare(b[0]));

    sortedCities.forEach(([name, count]) => {
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px; border-radius:10px; font-size:12px; border-left: 3px solid #38bdf8; cursor: pointer;";
        div.innerHTML = `
            <div>
                <b style="color:#38bdf8">${name}</b><br>
                <small style="opacity:0.7">Wizyt: ${count}</small>
            </div>
            <i class="fa-solid fa-ellipsis-vertical" style="padding: 10px; opacity: 0.5;"></i>
        `;
        div.onclick = (e) => window.showActionMenu(e, [
            { label: 'Pokaż Cykl Podróży', icon: 'fa-route', onClick: () => window.showCityTripDetails(name) },
            { label: 'Edytuj liczbę wizyt', icon: 'fa-pen', onClick: () => window.editCityCount(name, count) },
            { label: 'Usuń miasto', icon: 'fa-trash', type: 'danger', onClick: () => window.deleteCity(name) }
        ]);
        container.appendChild(div);
    });
}

window.editCityCount = (name, oldCount) => {
    window.openUniversalEdit(`Edytuj: ${name}`, [
        { id: 'count', label: 'Liczba wizyt', value: oldCount, type: 'number' }
    ], (res) => {
        const newCount = parseInt(res.count) || 0;
        set(ref(db, `stats/visited_cities/${name}`), newCount).then(() => {
            window.showToast("Zaktualizowano!", "success");
        });
    });
};

window.deleteCity = (name) => {
    window.openDeleteConfirm(`Czy na pewno usunąć miasto ${name} z rankingu?`, () => {
        remove(ref(db, `stats/visited_cities/${name}`)).then(() => {
            window.showToast("Miasto usunięte.", "success");
        });
    });
};

window.showCityTripDetails = (cityName) => {
    const normalizedCity = cityName.toLowerCase().trim();
    // Filtrujemy przejazdy gdzie miasto występuje jako start lub koniec
    const cityTrips = tripsData.filter(t => 
        (t.od && t.od.toLowerCase().includes(normalizedCity)) || 
        (t.do && t.do.toLowerCase().includes(normalizedCity))
    ).sort((a, b) => {
        // Sortowanie po dacie (najnowsze na górze)
        const partsA = a.data.split('.');
        const partsB = b.data.split('.');
        const dateA = new Date(partsA[2], partsA[1]-1, partsA[0]).getTime();
        const dateB = new Date(partsB[2], partsB[1]-1, partsB[0]).getTime();
        return dateB - dateA;
    });

    if (cityTrips.length === 0) {
        return window.showToast("Brak historii dla tego miasta w przejazdach.", "info");
    }

    const rankingData = cityTrips.map((t, idx) => ({
        label: `${t.data} | ${t.nr || '---'}`,
        value: `${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()} ${t.unit ? `[${t.unit}]` : ''}`
    }));

    window.showFullRanking(`Cykl podróży: ${cityName.toUpperCase()}`, rankingData);
};

function updateLeaderboards() {
    const leaderModal = document.getElementById('leaderboards-modal');
    if (!leaderModal || !leaderModal.classList.contains('active')) return;
    
    // Get ticket (simulated or active)
    let ticket = null;
    if (simulatedTicketId) {
        ticket = monthlyTickets.find(t => t.id === simulatedTicketId);
    } else {
        const activeTickets = monthlyTickets.filter(t => !t.archived);
        if (activeTickets.length > 0) ticket = activeTickets[0];
    }
    
    let relevantTrips = [];
    if (ticket) {
        const ticketTripKeys = new Set(ticket.trips || []);
        relevantTrips = tripsData.filter(t => ticketTripKeys.has(t.key));
    }
    
    // 1. TOP SERIES (np. EN57)
    const seriesCounts = {};
    relevantTrips.forEach(t => {
        if (t.unit) {
            const series = t.unit.split('-')[0].trim().toUpperCase();
            seriesCounts[series] = (seriesCounts[series] || 0) + 1;
        }
    });
    renderTopList('top-series-list', seriesCounts, 'x', 3); // Tylko TOP 3

    // 2. TOP ROUTES
    const routeCounts = {};
    relevantTrips.forEach(t => {
        if (t.od || t.from) {
            const r = `${(t.od || t.from || '?').toUpperCase()} ➔ ${(t.do || t.to || '?').toUpperCase()}`;
            routeCounts[r] = (routeCounts[r] || 0) + 1;
        }
    });
    renderTopList('top-routes-list', routeCounts, 'x');

    // 3. TOP CITIES (z oddzielnej bazy) - keep global? Or also ticket-specific?
    renderTopList('top-cities-list', visitedCitiesData, ' wizyt');

    // 4. NAJDROŻSZY I NAJTAŃSZY
    // Update renderPriceRanking to accept relevantTrips? Let's check:
    renderPriceRanking(relevantTrips);

    // 5. TOP CARRIERS (na podstawie nr pociągu)
    const carrierCounts = {};
    relevantTrips.forEach(t => {
        if (t.nr || t.trainNumber) {
            const firstPart = (t.nr || t.trainNumber || '').trim().split(' ')[0].toUpperCase();
            let carrier = "INNY";
            if (firstPart.startsWith('S')) carrier = "SKM TRÓJMIASTO";
            else if (firstPart.startsWith('IC') || firstPart.startsWith('EIP') || firstPart.startsWith('EIC') || firstPart.startsWith('TLK')) carrier = "PKP INTERCITY";
            else if (firstPart.startsWith('R') || firstPart.startsWith('KW') || firstPart.startsWith('KD')) carrier = "POLREGIO";
            
            carrierCounts[carrier] = (carrierCounts[carrier] || 0) + 1;
        }
    });
    renderTopList('top-carriers-list', carrierCounts, 'x');

    // 6. TOP UNITS (na sam dół)
    const unitCounts = {};
    relevantTrips.forEach(t => {
        if (t.unit) {
            const u = t.unit.trim().toUpperCase();
            unitCounts[u] = (unitCounts[u] || 0) + 1;
        }
    });
    renderTopList('top-units-list', unitCounts, 'x');
}

function renderPriceRanking(tripsToUse = tripsData) {
    const container = document.getElementById('price-ranking-list');
    if (!container || tripsToUse.length === 0) return;
    container.innerHTML = "";

    // Filtrujemy części trasy, bo mają 0 zł i psują statystyki
    const realTrips = tripsToUse.filter(t => !t.isPart);
    if (realTrips.length === 0) return;

    const sortedByPrice = [...realTrips].sort((a, b) => {
        const zlA = parseFloat(a.zl || a.cost || 0);
        const zlB = parseFloat(b.zl || b.cost || 0);
        return zlB - zlA;
    });
    
    const mostExpensive = sortedByPrice[0];
    const cheapest = sortedByPrice[sortedByPrice.length - 1];

    const items = [
        { label: "NAJDROŻSZY", data: mostExpensive, icon: "🔥", color: "var(--danger)" },
        { label: "NAJTAŃSZY", data: cheapest, icon: "💎", color: "var(--success)" }
    ];

    items.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = `display:flex; flex-direction:column; gap:2px; background:rgba(255,255,255,0.03); padding:8px 10px; border-radius:8px; font-size:11px; border-left: 3px solid ${item.color}; cursor: pointer; user-select: none;`;
        
        let lastClick = 0;
        div.addEventListener('click', (e) => {
            const now = Date.now();
            const delay = now - lastClick;
            
            if (delay < 400 && delay > 0) {
                e.preventDefault();
                e.stopPropagation();
                
                const val = parseFloat(item.data.zl || item.data.cost || 0);
                const fullText = `${item.label}: ${(item.data.od || item.data.from || '?').toUpperCase()} ➔ ${(item.data.do || item.data.to || '?').toUpperCase()} (${val.toFixed(2)} zł) - ${item.data.data || item.data.date || '?'}`;
                window.showFullRanking("Rekord Ceny", [
                    { label: item.label, value: fullText }
                ]);
                lastClick = 0;
            } else {
                lastClick = now;
            }
        });

        const val = parseFloat(item.data.zl || item.data.cost || 0);
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:800; color:${item.color}; letter-spacing:1px;">${item.icon} ${item.label}</span>
                <span style="font-weight:900; color:#fff;">${val.toFixed(2)} zł</span>
            </div>
            <div style="opacity:0.6;">${(item.data.od || item.data.from || '?').toUpperCase()} ➔ ${(item.data.do || item.data.to || '?').toUpperCase()}</div>
            <div style="font-size:9px; opacity:0.4;">${item.data.data || item.data.date || '?'} | ${item.data.nr || item.data.trainNumber || item.data.regioNum || '---'}</div>
        `;
        container.appendChild(div);
    });
}

function renderTopList(elementId, dataMap, suffix) {
    const container = document.getElementById(elementId);
    if (!container) return;
    container.innerHTML = "";

    const allSorted = Object.entries(dataMap)
        .sort((a, b) => b[1] - a[1]);
        
    const top3 = allSorted.slice(0, 3);

    if (top3.length === 0) {
        container.innerHTML = '<div style="font-size:10px; opacity:0.3;">Brak danych...</div>';
        return;
    }

    top3.forEach(([label, count], idx) => {
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:6px 10px; border-radius:8px; font-size:12px; cursor: pointer; user-select: none;";
        
        let lastClick = 0;
        div.addEventListener('click', (e) => {
            const now = Date.now();
            const delay = now - lastClick;
            
            if (delay < 400 && delay > 0) {
                e.preventDefault();
                e.stopPropagation();
                
                // Pobierz tytuł z nagłówka karty
                const title = container.previousElementSibling ? container.previousElementSibling.innerText : "Ranking";
                const fullData = allSorted.map(([l, c], i) => ({ 
                    label: `${i + 1}. ${l}`, 
                    value: `${c}${suffix}` 
                }));
                
                window.showFullRanking(title, fullData);
                lastClick = 0;
            } else {
                lastClick = now;
            }
        });

        let medal = "";
        if (idx === 0) medal = "🥇 ";
        if (idx === 1) medal = "🥈 ";
        if (idx === 2) medal = "🥉 ";

        div.innerHTML = `
            <span style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${medal}${label}</span>
            <span style="font-weight:900; color:var(--accent);">${count}${suffix}</span>
        `;
        container.appendChild(div);
    });
}

function renderAdminTrips(filter = "") {
    const adminTripsList = document.getElementById('admin-trips-list');
    if (!adminTripsList) return;
    adminTripsList.innerHTML = "";

    const q = filter.toLowerCase().trim();
    tripsData.slice().reverse().forEach(t => {
        const searchText = `${t.od} ${t.do} ${t.nr} ${t.unit} ${t.data}`.toLowerCase();
        if (searchText.includes(q)) {
            const div = document.createElement('div');
            div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px; border-radius:10px; font-size:11px; border-left: 3px solid #f87171; cursor: pointer;";
            
            const rawZl = parseFloat(t.zl);
            const priceText = t.isPart ? "- zł" : `${(isNaN(rawZl) ? 0 : rawZl).toFixed(2)} zł`;

            div.innerHTML = `
                <div style="flex: 1;">
                    <b>${t.data} | ${t.nr || 'BRAK'} ${t.unit ? `[${t.unit}]` : ''}</b><br>
                    <small>${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()}</small> | <small style="color:var(--success)">${priceText}</small>
                </div>
                <i class="fa-solid fa-ellipsis-vertical" style="padding: 10px; opacity: 0.5;"></i>
            `;
            div.onclick = (e) => window.showActionMenu(e, [
                { label: 'Edytuj przejazd', icon: 'fa-pen', onClick: () => window.editTrip(t.key) },
                { label: 'Usuń przejazd', icon: 'fa-trash', type: 'danger', onClick: () => window.deleteTrip(t.key, t.zl) }
            ]);
            adminTripsList.appendChild(div);
        }
    });
}

window.deleteTrip = (key, amount) => {
    const trip = tripsData.find(t => t.key === key);
    const details = trip ? `To usunie historię przejazdu: ${trip.od.toUpperCase()} ➔ ${trip.do.toUpperCase()} (${trip.data})` : "To usunie historię przejazdu";
    
    window.openDeleteConfirm(details, () => {
        remove(ref(db, `stats/przejazdy/${key}`)).then(() => {
            set(statsRef, earnedSoFar - amount);
            window.showToast("Przejazd usunięty.", "success");
        });
    });
};

window.editTrip = (key) => {
    const trip = tripsData.find(t => t.key === key);
    if (!trip) return;

    window.openUniversalEdit("Edytuj Przejazd", [
        { id: 'nr', label: 'Numer pociągu', value: trip.nr || "" },
        { id: 'unit', label: 'Numer Jednostki', value: trip.unit || "" },
        { id: 'note', label: 'Notatki', value: trip.note || "" },
        { id: 'data', label: 'Data (DD.MM.RRRR)', value: trip.data },
        { id: 'od', label: 'Stacja początkowa', value: trip.od.toUpperCase() },
        { id: 'do', label: 'Stacja końcowa', value: trip.do.toUpperCase() },
        { id: 'zl', label: 'Cena (zł)', value: trip.isPart ? "-" : trip.zl }
    ], (res) => {
        const oldZl = parseFloat(trip.zl) || 0;
        const updatedZl = res.zl === "-" ? 0 : (parseFloat(res.zl) || 0);
        
        const updatedTrip = {
            ...trip,
            nr: res.nr,
            unit: res.unit,
            note: res.note,
            data: res.data,
            od: res.od.toLowerCase().trim(),
            do: res.do.toLowerCase().trim(),
            zl: updatedZl
        };
        delete updatedTrip.key;

        set(ref(db, `stats/przejazdy/${key}`), updatedTrip).then(() => {
            if (!trip.isPart && oldZl !== updatedZl) {
                set(statsRef, earnedSoFar - oldZl + updatedZl);
            }
            window.showToast("Przejazd zaktualizowany!", "success");
        });
    });
};

window.editTripNote = (key) => {
    const trip = tripsData.find(t => t.key === key);
    if (!trip) return;

    // Upewnij się, że modal jest czysty i gotowy
    window.openUniversalEdit("Edytuj Notatkę", [
        { id: 'note', label: 'Treść notatki', value: trip.note || "", type: 'textarea', placeholder: 'Wpisz notatkę tutaj...' }
    ], (res) => {
        update(ref(db, `stats/przejazdy/${key}`), { note: res.note }).then(() => {
            window.showToast("Notatka zaktualizowana!", "success");
        }).catch(err => {
            console.error("Błąd zapisu notatki:", err);
            window.showToast("Błąd zapisu!", "error");
        });
    });
};

// --- SYSTEM ZOOM & PAN ---
function setupSVGInteractions(svgId, state, renderFn) {
    const svg = document.getElementById(svgId);
    let dragging = false;
    let moved = false; // Flaga wykrywająca ruch, aby odróżnić przesuwanie od kliknięcia
    let lastPos = { x: 0, y: 0 };
    let initialDist = 0;
    let initialScale = 1;

    // Szybka aktualizacja tylko transformacji (bez przebudowywania DOM)
    const fastTransform = () => {
        const g = svg.querySelector('g');
        if (g) {
            g.setAttribute("transform", `translate(${state.x},${state.y}) scale(${state.scale})`);
        }
    };

    svg.addEventListener('wheel', e => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.min(Math.max(state.scale * factor, 0.05), 5);
        
        const pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        const p1 = pt.matrixTransform(svg.getScreenCTM().inverse());
        
        state.scale = newScale;
        
        // Aktualizuj suwak zoomu jeśli istnieje
        const sliderId = svgId === 'svg-map' ? 'map-zoom-slider' : 'heat-zoom-slider';
        const slider = document.getElementById(sliderId);
        if (slider) slider.value = newScale;

        const p2 = pt.matrixTransform(svg.getScreenCTM().inverse());
        state.x += (p2.x - p1.x) * state.scale;
        state.y += (p2.y - p1.y) * state.scale;
        
        // Przy zoomowaniu musimy przeliczyć niektóre elementy (np. rozmiary pinezek), 
        // ale możemy to zrobić nieco rzadziej lub użyć fastTransform dla płynności
        fastTransform();
        
        // Opcjonalnie: pełny render po krótkim czasie bezczynności (debounce)
        clearTimeout(svg._renderTimeout);
        svg._renderTimeout = setTimeout(renderFn, 100);
    });

    const getDist = (touches) => Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);

    const start = (x, y, touches) => {
        dragging = true;
        moved = false; // Resetujemy flagę przy starcie
        if (touches && touches.length === 2) {
            initialDist = getDist(touches);
            initialScale = state.scale;
        } else {
            lastPos = { x: x - state.x, y: y - state.y };
        }
    };

    const move = (x, y, touches) => {
        if (!dragging) return;
        
        // Jeśli przesunięcie jest minimalne, nie uznajemy tego za ruch (eliminacja drgań)
        moved = true; 

        requestAnimationFrame(() => {
            if (touches && touches.length === 2) {
                const currentDist = getDist(touches);
                const newScale = Math.min(Math.max(initialScale * (currentDist / initialDist), 0.05), 5);
                state.scale = newScale;
                
                const sliderId = svgId === 'svg-map' ? 'map-zoom-slider' : 'heat-zoom-slider';
                const slider = document.getElementById(sliderId);
                if (slider) slider.value = newScale;

                fastTransform();
            } else if (touches && touches.length === 1) {
                state.x = touches[0].clientX - lastPos.x;
                state.y = touches[0].clientY - lastPos.y;
                fastTransform();
            } else {
                state.x = x - lastPos.x;
                state.y = y - lastPos.y;
                fastTransform();
            }
        });
    };

    const stop = () => {
        if (dragging && moved) {
            // Tylko jeśli faktycznie przesunęliśmy mapę, wywołujemy pełny render.
            // Zapobiega to usuwaniu elementów z DOM podczas zwykłego kliknięcia.
            renderFn();
        }
        dragging = false;
        document.body.style.cursor = 'default';
    };

    svg.addEventListener('mousedown', e => {
        e.preventDefault(); // Blokuj zaznaczanie tekstu
        document.body.style.cursor = 'grabbing';
        start(e.clientX, e.clientY);
    });
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

// --- REUSABLE BFS & GRAPH ---
let globalAdj = {};
// Helper do znajdowania klucza stacji (canonical key) na podstawie dowolnej nazwy
const findStationKey = (name) => {
    if (!name) return null;
    const normSearch = normalizeStationName(name);
    const keys = Object.keys(stations);
    
    // 1. Szukamy po dokładnym kluczu (case-insensitive)
    const exactMatch = keys.find(k => k.toLowerCase() === name.toLowerCase().trim());
    if (exactMatch) return exactMatch;
    
    // 2. Szukamy po znormalizowanej nazwie (bez ogonków)
    const normMatch = keys.find(k => normalizeStationName(k) === normSearch);
    if (normMatch) return normMatch;
    
    return null;
};

function buildGlobalGraph() {
    globalAdj = {};
    const stationKeys = Object.keys(stations);
    
    const addEdge = (u, v) => {
        const uKey = findStationKey(u);
        const vKey = findStationKey(v);
        
        if (uKey && vKey) {
            if (!globalAdj[uKey]) globalAdj[uKey] = [];
            if (!globalAdj[vKey]) globalAdj[vKey] = [];
            if (!globalAdj[uKey].includes(vKey)) globalAdj[uKey].push(vKey);
            if (!globalAdj[vKey].includes(uKey)) globalAdj[vKey].push(uKey);
        }
    };

    // 1. Połączenia z bazy (Connections) - identycznie jak w renderMapElements
    Object.keys(connectionsData).forEach(id => {
        const conn = connectionsData[id];
        if (!conn.isCustom) {
            const [a, b] = splitConnectionId(id);
            if (a && b) addEdge(a, b);
        }
    });

    // 2. Połączenia parent-child
    stationKeys.forEach(name => {
        const s = stations[name];
        getParents(s).forEach(pKey => {
            addEdge(name, pKey);
        });
    });
}

function findPathBFS(start, end) {
    const sKey = findStationKey(start);
    const eKey = findStationKey(end);
    
    if (!sKey || !eKey || !stations[sKey] || !stations[eKey]) return [];
    if (sKey === eKey) return [];
    
    const queue = [[sKey]];
    const visited = new Set([sKey]);

    while (queue.length > 0) {
        const path = queue.shift();
        const node = path[path.length - 1];

        if (node === eKey) {
            const segs = [];
            for (let i = 0; i < path.length - 1; i++) {
                segs.push([path[i], path[i+1]]);
            }
            return segs;
        }

        const neighbors = globalAdj[node] || [];
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push([...path, neighbor]);
            }
        }
    }
    return [];
}

window.autoCountCities = (odRaw, doRaw) => {
    buildGlobalGraph();
    const odKey = findStationKey(odRaw);
    const dKey = findStationKey(doRaw);
    
    if (!odKey || !dKey) return;
    
    const segments = findPathBFS(odKey, dKey);
    const visitedInThisTrip = new Set();
    visitedInThisTrip.add(odKey.toUpperCase());
    visitedInThisTrip.add(dKey.toUpperCase());
    
    segments.forEach(seg => {
        visitedInThisTrip.add(seg[0].toUpperCase());
        visitedInThisTrip.add(seg[1].toUpperCase());
    });

    // NOWE: Sprawdzamy czy to podróż powrotna (Y -> X jeśli ostatnio było X -> Y)
    // tripsData zawiera już ten właśnie dodany przejazd na końcu
    const lastTrip = tripsData[tripsData.length - 1]; 
    const prevTrip = tripsData[tripsData.length - 2];

    if (lastTrip && prevTrip) {
        const lastOd = lastTrip.od.toLowerCase().trim();
        const lastDo = lastTrip.do.toLowerCase().trim();
        const prevOd = prevTrip.od.toLowerCase().trim();
        const prevDo = prevTrip.do.toLowerCase().trim();

        // Jeśli obecny przejazd jest DOKŁADNYM odwróceniem poprzedniego (X->Y i Y->X)
        // to nie doliczamy wizyt ponownie, bo to ten sam "cykl" / pobyt.
        if (lastOd === prevDo && lastDo === prevOd) {
            console.log("Wykryto podróż powrotną (X->Y->X). Pomijam ponowne naliczanie wizyt.");
            window.showToast("Podróż powrotna - wizyty nie są liczone podwójnie.", "info");
            return; 
        }
    }

    visitedInThisTrip.forEach(cityName => {
        const cityRef = ref(db, `stats/visited_cities/${cityName}`);
        get(cityRef).then(s => {
            const count = s.val() || 0;
            set(cityRef, count + 1);
        });
    });
    window.showToast(`Automatycznie zaktualizowano ${visitedInThisTrip.size} miast!`, "info");
};

// --- RENDERING MAP ---
window.showHeatDetails = (id, type) => {
    const modal = document.getElementById('heat-details-modal');
    const title = document.getElementById('heat-details-title');
    const countDisplay = document.getElementById('heat-details-count');
    const unitsContainer = document.getElementById('heat-details-units');
    const recentContainer = document.getElementById('heat-details-recent');

    if (!modal || !tripsData) return;

    const normalizedId = id.toLowerCase();
    const isConn = type === 'connection';
    
    // Filtrujemy przejazdy
    const relatedTrips = tripsData.filter(t => {
        const odKey = findStationKey(t.od);
        const dKey = findStationKey(t.do);

        if (!odKey || !dKey) return false;

        if (isConn) {
            const segments = findPathBFS(odKey, dKey);
            return segments.some(seg => [seg[0].toLowerCase(), seg[1].toLowerCase()].sort().join('|') === normalizedId);
        } else {
            // Stacja (używamy kluczy kanonicznych do porównania)
            if (odKey.toLowerCase() === normalizedId || dKey.toLowerCase() === normalizedId) return true;
            const segments = findPathBFS(odKey, dKey);
            return segments.some(seg => seg[0].toLowerCase() === normalizedId || seg[1].toLowerCase() === normalizedId);
        }
    });

    // Tytuł
    title.innerHTML = isConn ? `<i class="fa-solid fa-route"></i> Odcinek: ${id}` : `<i class="fa-solid fa-location-dot"></i> Stacja: ${id.toUpperCase()}`;
    
    // Licznik
    countDisplay.innerText = relatedTrips.length;

    // Składy
    const units = [...new Set(relatedTrips.map(t => t.unit).filter(u => u && u !== "Brak"))];
    unitsContainer.innerHTML = units.length > 0 
        ? units.map(u => `<span class="unit-pill" style="background: var(--accent); color: #000; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 800;">${u}</span>`).join('')
        : '<p style="font-size: 11px; opacity: 0.5;">Brak danych o składach.</p>';

    // Ostatnie przejazdy
    const recent = [...relatedTrips].reverse().slice(0, 5);
    recentContainer.innerHTML = recent.length > 0
        ? recent.map(t => `
            <div class="card" style="background: rgba(255,255,255,0.03); padding: 10px; border: 1px solid rgba(255,255,255,0.05); font-size: 11px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span style="color: var(--accent); font-weight: 800;">${t.nr || '---'}</span>
                    <span style="opacity: 0.5;">${t.data}</span>
                </div>
                <div style="display: flex; gap: 5px; align-items: center;">
                    <span style="font-weight: 700;">${t.od}</span>
                    <i class="fa-solid fa-arrow-right" style="font-size: 8px; opacity: 0.3;"></i>
                    <span style="font-weight: 700;">${t.do}</span>
                </div>
            </div>
        `).join('')
        : '<p style="font-size: 11px; opacity: 0.5;">Brak historii dla tego punktu.</p>';

    modal.classList.add('active');
};

// NOWE: Przełącznik trybu testowego heatmapy
window.toggleHeatTestMode = () => {
    isHeatTestMode = !isHeatTestMode;
    const btn = document.getElementById('heat-test-btn');
    if (btn) {
        btn.innerText = isHeatTestMode ? "🧪 TEST: ON" : "🧪 TEST";
        btn.style.background = isHeatTestMode ? "var(--warning)" : "rgba(255,255,255,0.05)";
        btn.style.color = isHeatTestMode ? "#000" : "var(--warning)";
    }
    renderHeat();
};

function getTariffPrice(km) {
    if (isNaN(km) || km <= 0) return 0;
    
    // Używamy cennika miejskiego dla Funkcji KM (zgodnie z życzeniem integracji)
    const rows = tariffsData.miejska || [];
    if (rows.length === 0) return 0;

    // Sortujemy KM rosnąco
    const sorted = [...rows].sort((a, b) => a.km - b.km);
    
    // Szukamy pierwszego progu, który jest >= km
    const match = sorted.find(r => r.km >= km);
    const finalRow = match ? match : sorted[sorted.length - 1];
    
    // Zwracamy normalny (zniżki liczymy w calculatePrice)
    return finalRow.normal;
}

// Liczenie natężenia - ujednolicona normalizacja
const getUsageData = (filteredTrips = null) => {
    const usage = {};
    const tripsToUse = filteredTrips || tripsData;
    if (!tripsToUse || tripsToUse.length === 0) return usage;
    if (!stations || Object.keys(stations).length === 0) {
        console.warn("Brak danych stacji przy liczeniu natężenia");
        return usage;
    }

    buildGlobalGraph();

    tripsToUse.forEach(t => {
        const odKey = findStationKey(t.od);
        const dKey = findStationKey(t.do);
        
        if (!odKey || !dKey) return;

        // Zliczamy stacje końcowe
        usage[odKey] = (usage[odKey] || 0) + 1;
        usage[dKey] = (usage[dKey] || 0) + 1;

        const segments = findPathBFS(odKey, dKey);
        if (segments.length > 0) {
            console.log(`Znalazłem ścieżkę (${segments.length} seg): ${odKey} -> ${dKey}`);
        } else if (odKey !== dKey) {
            console.warn(`BRAK ŚCIEŻKI: ${odKey} -> ${dKey}`);
        }
        segments.forEach(seg => {
            const s1 = seg[0];
            const s2 = seg[1];
            
            // Używamy oryginalnych kluczy stacji, sortujemy je alfabetycznie dla spójności
            const k = [s1, s2].sort().join('|');
            usage[k] = (usage[k] || 0) + 1;
            
            // Zliczamy stacje pośrednie
            usage[s1] = (usage[s1] || 0) + 1;
            usage[s2] = (usage[s2] || 0) + 1;
        });
    });
    return usage;
};

const heatThemes = {
    classic: ["#fbbf24", "#f59e0b", "#ea580c", "#dc2626", "#991b1b", "#7f1d1d", "#4c0519", "#25020c"],
    electric: ["#22d3ee", "#0ea5e9", "#2563eb", "#4f46e5", "#7c3aed", "#9333ea", "#c026d3", "#4c1d95"],
    nature: ["#bef264", "#84cc16", "#22c55e", "#16a34a", "#15803d", "#166534", "#064e3b", "#022c22"],
    sunset: ["#fda4af", "#fb7185", "#f43f5e", "#e11d48", "#be123c", "#9f1239", "#881337", "#4c0519"],
    royal: ["#fef08a", "#fde047", "#facc15", "#eab308", "#a855f7", "#9333ea", "#7e22ce", "#581c87"]
};

const getHeatColor = (count) => {
    if (count === 0) return "#334155"; 
    const colors = heatThemes[heatColorTheme] || heatThemes.classic;
    
    if (count < 5) return colors[0];
    if (count < 10) return colors[1];
    if (count < 20) return colors[2];
    if (count < 25) return colors[3];
    if (count < 30) return colors[4];
    if (count < 40) return colors[5];
    if (count < 50) return colors[6];
    return colors[7];
};

function renderMapElements(svgId, state, mode = 'base', customUsage = null) {
    const svg = document.getElementById(svgId);
    if (!svg) return;
    
    // Czyścimy wszystko poza <defs>
    const defs = svg.querySelector('defs');
    svg.innerHTML = "";
    if (defs) svg.appendChild(defs);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${state.x},${state.y}) scale(${state.scale})`);

    const w = mapBgSettings.w || 1200;
    const h = mapBgSettings.h || 1800;
    const offX = mapBgSettings.offX || 0;
    const offY = mapBgSettings.offY || 0;

    // 0. Background Image (tylko w edytorze)
    if (mode === 'base' && stationEditorBg && showEditorBg) {
        const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
        img.setAttributeNS(null, "href", stationEditorBg);
        img.setAttributeNS(null, "x", offX);
        img.setAttributeNS(null, "y", offY);
        img.setAttributeNS(null, "width", w);
        img.setAttributeNS(null, "height", h);
        img.setAttributeNS(null, "preserveAspectRatio", "xMidYMid meet");
        img.style.opacity = "0.5";
        img.style.cursor = "crosshair";
        
        img.onmousemove = (e) => {
            const pt = svg.createSVGPoint();
            pt.x = e.clientX; pt.y = e.clientY;
            const cursorpt = pt.matrixTransform(g.getScreenCTM().inverse());
            const x = Math.round(cursorpt.x);
            const y = Math.round(cursorpt.y);
            const tip = document.getElementById('coord-info');
            if (tip) {
                tip.style.display = 'block'; tip.style.left = e.pageX+15+'px'; tip.style.top = e.pageY+15+'px';
                tip.innerText = `Celownik: X=${x}, Y=${y}`;
            }
        };
        img.onmouseout = () => {
            const tip = document.getElementById('coord-info');
            if (tip) tip.style.display = 'none';
        };
        img.onclick = (e) => {
            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const cursorpt = pt.matrixTransform(g.getScreenCTM().inverse());
            const x = Math.round(cursorpt.x);
            const y = Math.round(cursorpt.y);

            if (isDrawMode) {
                drawPoints.push({ x, y });
                if (drawPoints.length === 2) {
                    const id = `custom_${Date.now()}`;
                    const type = document.getElementById('conn-type-select')?.value || 'regio';
                    set(ref(db, `stats/polaczenia/${id}`), { 
                        type: 'line', 
                        connType: type,
                        color: '#ffffff',
                        x1: drawPoints[0].x,
                        y1: drawPoints[0].y,
                        x2: drawPoints[1].x,
                        y2: drawPoints[1].y,
                        isCustom: true
                    }).then(() => {
                        drawPoints = [];
                        window.showToast("Narysowano swobodną linię", "success");
                    });
                }
                renderBase();
                return;
            }

            document.getElementById('new-st-x').value = x;
            document.getElementById('new-st-y').value = y;
            tempMarker = { x, y };
            renderBase();
            window.showToast(`Wybrano: X=${x}, Y=${y}`, "success");
        };
        g.appendChild(img);
    }

    // 0.5 Tymczasowa pinezka (tylko w edytorze)
    if (mode === 'base' && tempMarker) {
        const pin = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        pin.setAttribute("cx", tempMarker.x); pin.setAttribute("cy", tempMarker.y); pin.setAttribute("r", (globalPinSize + 2)/state.scale);
        pin.setAttribute("fill", "#f87171");
        pin.setAttribute("stroke", "#fff");
        pin.setAttribute("stroke-width", 2/state.scale);
        g.appendChild(pin);
    }

    // 1. Grid (tylko w edytorze)
    if (mode === 'base' && gridActive) {
        const step = 40;
        const gridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        
        // Linie pionowe
        for(let x=offX; x<=offX+w; x+=step) {
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", x); line.setAttribute("y1", offY);
            line.setAttribute("x2", x); line.setAttribute("y2", offY+h);
            line.setAttribute("stroke", "rgba(255,255,255,0.3)");
            line.setAttribute("stroke-width", 1.5/state.scale);
            gridGroup.appendChild(line);
        }
        // Linie poziome
        for(let y=offY; y<=offY+h; y+=step) {
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", offX); line.setAttribute("y1", y);
            line.setAttribute("x2", offX+w); line.setAttribute("y2", y);
            line.setAttribute("stroke", "rgba(255,255,255,0.3)");
            line.setAttribute("stroke-width", 1.5/state.scale);
            gridGroup.appendChild(line);
        }
        
        // Niewidzialny prostokąt do klikania w siatkę
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", offX);
        rect.setAttribute("y", offY);
        rect.setAttribute("width", w);
        rect.setAttribute("height", h);
        rect.setAttribute("fill", "transparent");
        rect.style.cursor = "crosshair";
        
        rect.onmousemove = (e) => {
            const pt = svg.createSVGPoint();
            pt.x = e.clientX; pt.y = e.clientY;
            const cursorpt = pt.matrixTransform(g.getScreenCTM().inverse());
            const x = Math.round(cursorpt.x);
            const y = Math.round(cursorpt.y);
            const tip = document.getElementById('coord-info');
            if (tip) {
                tip.style.display = 'block'; tip.style.left = e.pageX+15+'px'; tip.style.top = e.pageY+15+'px';
                tip.innerText = `Celownik: X=${x}, Y=${y}`;
            }
        };
        rect.onmouseout = () => {
            const tip = document.getElementById('coord-info');
            if (tip) tip.style.display = 'none';
        };
        rect.onclick = (e) => {
            const pt = svg.createSVGPoint();
            pt.x = e.clientX; pt.y = e.clientY;
            const cursorpt = pt.matrixTransform(g.getScreenCTM().inverse());
            const x = Math.round(cursorpt.x);
            const y = Math.round(cursorpt.y);

            if (isDrawMode) {
                drawPoints.push({ x, y });
                if (drawPoints.length === 2) {
                    const id = `custom_${Date.now()}`;
                    const type = document.getElementById('conn-type-select')?.value || 'regio';
                    set(ref(db, `stats/polaczenia/${id}`), { 
                        type: 'line', 
                        connType: type,
                        x1: drawPoints[0].x,
                        y1: drawPoints[0].y,
                        x2: drawPoints[1].x,
                        y2: drawPoints[1].y,
                        isCustom: true
                    }).then(() => {
                        drawPoints = [];
                        window.showToast("Narysowano swobodną linię", "success");
                    });
                }
                renderBase();
                return;
            }

            document.getElementById('new-st-x').value = x;
            document.getElementById('new-st-y').value = y;
            tempMarker = { x, y };
            renderBase();
            window.showToast(`Wybrano: X=${x}, Y=${y}`, "success");
        };
        gridGroup.appendChild(rect);
        
        g.appendChild(gridGroup);
    }

    // 2. Połączenia (Heatmap logic)
    let usage;
    if (mode === 'heat') {
        if (customUsage) {
            usage = customUsage;
        } else {
            usage = getUsageData();
        }
    } else {
        usage = {};
    }

    // Rysuj połączenia z bazy connectionsData
    Object.keys(connectionsData).forEach(id => {
        const conn = connectionsData[id];
        let s, p;

        if (conn.isCustom) {
            s = { x: conn.x1, y: conn.y1 };
            p = { x: conn.x2, y: conn.y2 };
        } else {
            const [a, b] = splitConnectionId(id);
            if (stations[a] && stations[b]) {
                s = stations[a];
                p = stations[b];
            }
        }

        if (s && p) {
            // Walidacja współrzędnych przed renderowaniem
            if (s.x === undefined || s.y === undefined || p.x === undefined || p.y === undefined) {
                console.error(`Błąd danych połączenia ${id}:`, { s, p });
                return;
            }

            let pathData;
            if (conn.type === 'curve' && conn.cx !== undefined && conn.cy !== undefined) {
                pathData = `M ${s.x} ${s.y} Q ${conn.cx} ${conn.cy} ${p.x} ${p.y}`;
            } else {
                pathData = `M ${s.x} ${s.y} L ${p.x} ${p.y}`;
            }

            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", pathData);
            path.setAttribute("fill", "none");
            
            // Kolory na podstawie typu
            let strokeColor = "#6366f1"; // Default
            if (conn.connType === 'regio') strokeColor = "#ef4444"; // Czerwony
            else if (conn.connType === 'skm') strokeColor = "#fbbf24"; // Żółty
            else if (conn.connType === 'ic') strokeColor = "#3b82f6"; // Niebieski
            else if (conn.connType === 'custom') strokeColor = conn.color || "#ffffff"; // Własny kolor

            if(mode === 'heat') {
                // Szukamy count dla id (używając kanonicznych kluczy ze splitConnectionId)
                const [a, b] = splitConnectionId(id);
                let count = 0;
                if (a && b) {
                    const normalizedId = [a, b].sort().join('|');
                    count = usage[normalizedId] || 0;
                }
                
                // TRYB TESTOWY: Wszystko na żółto (count = 1)
                if (isHeatTestMode) count = 1;
                
                path.setAttribute("stroke", getHeatColor(count));
                // Stała grubość niezależna od zoomu, żeby nie było "ciapy"
                const baseW = heatLineThickness * globalHeatWidth;
                const extraW = Math.min(count * 1.5, 25);
                path.setAttribute("stroke-width", baseW + extraW);
                path.setAttribute("stroke-linecap", "round");
                path.setAttribute("stroke-linejoin", "round");
                path.setAttribute("filter", "url(#heat-glow)");
                path.style.opacity = count > 0 ? 0.8 : 0.1;

                // NOWE: Szczegóły w heatmapie (brak edycji)
                path.style.cursor = "pointer";
                path.onclick = (e) => {
                    e.stopPropagation();
                    window.showHeatDetails(id, 'connection');
                };
            } else {
                path.setAttribute("stroke", strokeColor);
                path.setAttribute("stroke-width", (conn.width || globalLineWidth));
                path.style.opacity = 0.6;
                if (mode === 'base') {
                    path.style.cursor = "pointer";
                    path.onclick = (e) => {
                        e.stopPropagation();
                        if (isCurveEditMode) {
                            // W trybie krzywych, kliknięcie w linię bez punktu zgięcia tworzy go w miejscu kliknięcia
                            const pt = svg.createSVGPoint();
                            pt.x = e.clientX; pt.y = e.clientY;
                            const cursorpt = pt.matrixTransform(g.getScreenCTM().inverse());
                            window.updateCurve(id, Math.round(cursorpt.x), Math.round(cursorpt.y));
                        } else {
                            window.showActionMenu(e, [
                                { label: 'Edytuj połączenie', icon: 'fa-pen', onClick: () => window.editConnection(id) },
                                { label: 'Usuń połączenie', icon: 'fa-trash', type: 'danger', onClick: () => {
                                    window.openDeleteConfirm(`Czy chcesz trwale usunąć to połączenie?`, () => {
                                        remove(ref(db, `stats/polaczenia/${id}`));
                                    });
                                }}
                            ]);
                        }
                    };
                }
            }
            g.appendChild(path);

            // Jeśli tryb edycji krzywych i to jest krzywa, narysuj uchwyt
            if (mode === 'base' && isCurveEditMode && conn.type === 'curve') {
                const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                handle.setAttribute("cx", conn.cx); handle.setAttribute("cy", conn.cy);
                handle.setAttribute("r", 8 / state.scale);
                handle.setAttribute("fill", "var(--warning)");
                handle.setAttribute("stroke", "#fff");
                handle.setAttribute("stroke-width", 2 / state.scale);
                handle.style.cursor = "move";
                handle.onclick = (e) => e.stopPropagation();
                
                handle.onmousedown = (e) => { 
                    e.stopPropagation();
                    let isDraggingHandle = true;
                    
                    const onMouseMove = (moveEvent) => {
                        if (!isDraggingHandle) return;
                        const pt = svg.createSVGPoint();
                        pt.x = moveEvent.clientX; pt.y = moveEvent.clientY;
                        const cursorpt = pt.matrixTransform(g.getScreenCTM().inverse());
                        conn.cx = Math.round(cursorpt.x);
                        conn.cy = Math.round(cursorpt.y);
                        handle.setAttribute("cx", conn.cx);
                        handle.setAttribute("cy", conn.cy);
                        path.setAttribute("d", `M ${s.x} ${s.y} Q ${conn.cx} ${conn.cy} ${p.x} ${p.y}`);
                    };

                    const onMouseUp = () => {
                        isDraggingHandle = false;
                        window.removeEventListener('mousemove', onMouseMove);
                        window.removeEventListener('mouseup', onMouseUp);
                        window.updateCurve(id, conn.cx, conn.cy);
                    };

                    window.addEventListener('mousemove', onMouseMove);
                    window.addEventListener('mouseup', onMouseUp);
                };
                g.appendChild(handle);
            }
        }
    });

    // Rysuj tymczasowy punkt rysownika
    if (mode === 'base' && isDrawMode && drawPoints.length > 0) {
        drawPoints.forEach(p => {
            const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y);
            dot.setAttribute("r", 5 / state.scale);
            dot.setAttribute("fill", "var(--warning)");
            g.appendChild(dot);
        });
    }

    // Zachowujemy stare połączenia parent-child dla kompatybilności
    Object.keys(stations).forEach(name => {
        const s = stations[name];
        getParents(s).forEach(pName => {
            if (stations[pName]) {
                const p = stations[pName];
                const id = [name, pName].sort().join('|');
                // Jeśli to połączenie już istnieje w connectionsData, nie rysuj go drugi raz
                if (connectionsData[id]) return;

                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", `M ${s.x} ${s.y} L ${p.x} ${p.y}`);
                path.setAttribute("fill", "none");
                
                if(mode === 'heat') {
                    // name i pName są już kluczami kanonicznymi
                    const normalizedId = [name, pName].sort().join('|');
                    let count = usage[normalizedId] || 0;

                    // TRYB TESTOWY: Wszystko na żółto (count = 1)
                    if (isHeatTestMode) count = 1;

                    path.setAttribute("stroke", getHeatColor(count));
                    const baseW = heatLineThickness * globalHeatWidth;
                    const extraW = Math.min(count * 1.5, 25);
                    path.setAttribute("stroke-width", baseW + extraW);
                    path.setAttribute("stroke-linecap", "round");
                    path.setAttribute("stroke-linejoin", "round");
                    path.setAttribute("filter", "url(#heat-glow)");
                    path.style.opacity = count > 0 ? 0.8 : 0.1;

                    // NOWE: Szczegóły w heatmapie (brak edycji)
                    path.style.cursor = "pointer";
                    path.onclick = (e) => {
                        e.stopPropagation();
                        window.showHeatDetails(id, 'connection');
                    };
                } else {
                    path.setAttribute("stroke", "#6366f1");
                    path.setAttribute("stroke-width", globalLineWidth);
                    path.style.opacity = 0.6;
                    
                    if (mode === 'base') {
                        path.style.cursor = "pointer";
                        path.onclick = (e) => {
                            e.stopPropagation();
                            if (isCurveEditMode) {
                                const pt = svg.createSVGPoint();
                                pt.x = e.clientX; pt.y = e.clientY;
                                const cursorpt = pt.matrixTransform(g.getScreenCTM().inverse());
                                window.updateCurve(id, Math.round(cursorpt.x), Math.round(cursorpt.y));
                            }
                        };
                    }
                }
                g.appendChild(path);
            }
        });
    });

    // 3. Stacje i Etykiety
    Object.keys(stations).forEach((name, index) => {
        const s = stations[name];
        if (!s || s.x === undefined || s.y === undefined || isNaN(s.x) || isNaN(s.y)) return;
        
        let showLabel = true;
        if (mode === 'heat') {
            if (state.scale < 1.5) showLabel = false;
        }

        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", s.x); dot.setAttribute("cy", s.y); 
        
        if (mode === 'heat') {
            const stationUsage = usage[name.toLowerCase()] || 0;
            const r = ( (s.radius || globalPinSize) * 0.5 + Math.min(stationUsage, 6));
            dot.setAttribute("r", r);
            dot.setAttribute("fill", getHeatColor(stationUsage));
            dot.setAttribute("stroke", "#fff");
            dot.setAttribute("stroke-width", 0.5);
            dot.style.opacity = stationUsage > 0 ? 0.9 : 0.05;

            // NOWE: Interakcja w heatmapie (brak edycji)
            dot.style.cursor = "pointer";
            dot.onclick = (e) => {
                e.stopPropagation();
                window.showHeatDetails(name, 'station');
            };
        } else {
            // Nowy styl kropek przystankowych (Ring Style)
            const r = (s.radius || globalPinSize);
            dot.setAttribute("r", r);
            let fillColor = s.color || globalPinColor;
            if (isConnectionMode && connectionStartStation === name) fillColor = "var(--accent)";
            if (isParentSelectionMode && parentSelectionSource === name) fillColor = "var(--warning)";
            if (isParentSelectionMode && parentSelectionSource !== name) {
                const sourceParents = getParents(stations[parentSelectionSource]);
                if (sourceParents.includes(name.toLowerCase())) fillColor = "var(--success)";
            }
            
            dot.setAttribute("fill", "transparent");
            dot.setAttribute("stroke", fillColor);
            dot.setAttribute("stroke-width", 2.5);
            dot.style.opacity = "1";

            // Dodaj wewnętrzną kropkę dla efektu
            const innerDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            innerDot.setAttribute("cx", s.x); innerDot.setAttribute("cy", s.y);
            innerDot.setAttribute("r", r * 0.4);
            innerDot.setAttribute("fill", fillColor);
            innerDot.style.pointerEvents = "none";
            g.appendChild(innerDot);
        }
        dot.style.cursor = "pointer";
        dot.onclick = (e) => {
            e.stopPropagation();
            
            // NOWE: Obsługa kliknięcia w trybie Heatmapy
            if (mode === 'heat') {
                window.showHeatDetails(name, 'station');
                return;
            }

            if (isParentSelectionMode) {
                window.toggleParent(parentSelectionSource, name);
                return;
            }
            if (isConnectionMode) {
                if (!connectionStartStation) {
                    connectionStartStation = name;
                    window.showToast(`START (OD): ${name.toUpperCase()} - wybierz stację końcową`, "info");
                    renderBase();
                } else if (connectionStartStation === name) {
                    connectionStartStation = null;
                    renderBase();
                } else {
                    window.addConnection(connectionStartStation, name);
                    // Nie resetujemy startu, aby móc łączyć stację OD z wieloma DO po kolei
                    window.showToast(`DODANO POŁĄCZENIE: ${connectionStartStation.toUpperCase()} ➔ ${name.toUpperCase()}`, "success");
                    renderBase();
                }
            } else {
                window.editStationName(name);
            }
        };
        g.appendChild(dot);

        if (showLabel) {
            const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
            const pos = s.labelPos || 'right';
            
            // Ograniczenie nazw na heatmapie
            if (mode === 'heat') {
                if (state.scale < 1.5) return; 
            } 
            
            let dx = 12;
            let dy = 5;
            let anchor = "start";

            if (pos === 'left') { dx = -12; anchor = "end"; }
            else if (pos === 'top') { dx = 0; dy = -15; anchor = "middle"; }
            else if (pos === 'bottom') { dx = 0; dy = 25; anchor = "middle"; }
            else if (pos === 'top-right') { dx = 12; dy = -12; anchor = "start"; }
            else if (pos === 'top-left') { dx = -12; dy = -12; anchor = "end"; }
            else if (pos === 'bottom-right') { dx = 12; dy = 20; anchor = "start"; }
            else if (pos === 'bottom-left') { dx = -12; dy = 20; anchor = "end"; }
            else if (pos === 'center') { dx = 0; dy = 5; anchor = "middle"; }

            // Użyj customowego offsetu jeśli istnieje
            const finalDx = s.offX !== undefined ? s.offX : dx;
            const finalDy = s.offY !== undefined ? s.offY : dy;

            const posX = s.x + finalDx;
            const posY = s.y + finalDy;
            if (isNaN(posX) || isNaN(posY)) return;

            txt.setAttribute("x", posX); 
            txt.setAttribute("y", posY);
            txt.setAttribute("text-anchor", anchor);
            
            // Aplikuj rotację (indywidualną lub globalną)
            const rotation = s.rotation !== undefined ? s.rotation : globalTextRotation;
            if (rotation !== 0) {
                txt.setAttribute("transform", `rotate(${rotation} ${posX} ${posY})`);
            }

            txt.setAttribute("fill", s.color || (mode === 'base' ? "#fff" : "#cbd5e1")); 
            
            // Stała wielkość czcionki w jednostkach SVG
            let baseFS = s.fontSize || 13;
            if (state.scale < 0.6) baseFS *= 0.8; // Delikatne zmniejszenie przy dużym oddaleniu
            
            txt.setAttribute("font-size", baseFS + "px");
            txt.setAttribute("font-weight", "700");
            
            // Cień zamiast obrysu dla czystszego wyglądu
            txt.style.textShadow = "1px 1px 2px rgba(0,0,0,0.8)";

            // Interakcja w trybie Heatmapy
            if (mode === 'heat') {
                txt.style.cursor = "pointer";
                txt.style.pointerEvents = "auto";
                txt.onclick = (e) => {
                    e.stopPropagation();
                    window.showHeatDetails(name, 'station');
                };
            }

            if (pos === 'center' && s.offX === undefined) {
                txt.setAttribute("text-anchor", "middle");
                txt.setAttribute("y", s.y + 5);
                txt.setAttribute("x", s.x);
                // Dla środka też aplikujemy rotację
                if (rotation !== 0) {
                    txt.setAttribute("transform", `rotate(${rotation} ${s.x} ${s.y + 5})`);
                }
                txt.setAttribute("fill", "#000"); // Czarny napis na białej kropce
                txt.style.textShadow = "none";
                txt.setAttribute("font-size", "8px");
            }

            if (mode === 'base') {
                if (isLabelEditMode) {
                    txt.style.cursor = "move";
                    txt.style.pointerEvents = "auto";
                    txt.style.userSelect = "none";
                    txt.style.fontWeight = "900";
                    txt.setAttribute("fill", "var(--accent)"); // Zmiana koloru zamiast rozmycia

                    txt.onmousedown = (e) => {
                        e.stopPropagation();
                        
                        // Wybieramy stację do obrotu pokrętłem
                        window.selectLabelForRotation(name, txt, s, finalDx, finalDy);

                        // Usuwamy poświatę na czas przeciągania, żeby nie "rozmywało"
                        txt.style.filter = "none"; 
                        
                        draggedLabel = {
                            name: name,
                            startX: e.clientX,
                            startY: e.clientY,
                            initialOffX: finalDx,
                            initialOffY: finalDy,
                            initialRotation: rotation
                        };

                        const onMouseMove = (moveEvent) => {
                            if (!draggedLabel) return;
                            
                            if (moveEvent.shiftKey) {
                                // Rotacja za pomocą Shift + ruch myszy (lewo/prawo)
                                const deltaRot = (moveEvent.clientX - draggedLabel.startX) / 2;
                                const newRot = (draggedLabel.initialRotation + deltaRot) % 360;
                                txt.setAttribute("transform", `rotate(${newRot} ${s.x + finalDx} ${s.y + finalDy})`);
                                draggedLabel.currentRotation = newRot;
                            } else {
                                // Przesuwanie
                                const deltaX = (moveEvent.clientX - draggedLabel.startX) / state.scale;
                                const deltaY = (moveEvent.clientY - draggedLabel.startY) / state.scale;
                                
                                const newOffX = draggedLabel.initialOffX + deltaX;
                                const newOffY = draggedLabel.initialOffY + deltaY;
                                
                                txt.setAttribute("x", s.x + newOffX);
                                txt.setAttribute("y", s.y + newOffY);
                                
                                const r = draggedLabel.currentRotation !== undefined ? draggedLabel.currentRotation : rotation;
                                if (r !== 0) {
                                    txt.setAttribute("transform", `rotate(${r} ${s.x + newOffX} ${s.y + newOffY})`);
                                }
                                
                                draggedLabel.currentOffX = newOffX;
                                draggedLabel.currentOffY = newOffY;
                            }
                        };

                        const onMouseUp = (upEvent) => {
                            if (draggedLabel) {
                                const updates = {};
                                if (draggedLabel.currentOffX !== undefined) {
                                    updates.offX = Math.round(draggedLabel.currentOffX);
                                    updates.offY = Math.round(draggedLabel.currentOffY);
                                }
                                if (draggedLabel.currentRotation !== undefined) {
                                    updates.rotation = Math.round(draggedLabel.currentRotation);
                                }

                                if (Object.keys(updates).length > 0) {
                                    update(ref(db, `stats/stacje_siec/${draggedLabel.name}`), updates).then(() => {
                                        console.log(`Zapisano pozycję dla ${draggedLabel.name}`);
                                    });
                                }
                                
                                draggedLabel = null;
                                // Przywracamy kolor po zakończeniu
                                renderBase(); 
                            }
                            window.removeEventListener('mousemove', onMouseMove);
                            window.removeEventListener('mouseup', onMouseUp);
                        };

                        window.addEventListener('mousemove', onMouseMove);
                        window.addEventListener('mouseup', onMouseUp);
                    };
                } else {
                    txt.style.pointerEvents = "none";
                }
            } else {
                txt.style.pointerEvents = "none";
            }

            // Obsługa nazw wielowierszowych (separator |)
            const lines = name.toUpperCase().split('|');
            if (lines.length > 1) {
                lines.forEach((lineText, i) => {
                    const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
                    tspan.textContent = lineText.trim();
                    tspan.setAttribute("x", s.x + finalDx);
                    // Odstęp między wierszami (line-height) zależny od wielkości czcionki
                    tspan.setAttribute("dy", i === 0 ? 0 : (baseFS * 1.1));
                    tspan.setAttribute("font-size", baseFS + "px");
                    txt.appendChild(tspan);
                });
                
                // Centrowanie pionowe dla wielu linii
                if (lines.length > 1) {
                    const totalHeight = (lines.length - 1) * (baseFS * 1.1);
                    const currentY = parseFloat(txt.getAttribute("y"));
                    txt.setAttribute("y", currentY - totalHeight / 2);
                }
            } else {
                txt.textContent = name.toUpperCase();
            }
            
            g.appendChild(txt);
        }
    });

    svg.appendChild(g);
}

// --- OBSŁUGA TRYBU OFFLINE ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then((reg) => {
            console.log('Service Worker zarejestrowany:', reg.scope);
        }).catch((err) => {
            console.warn('Rejestracja Service Workera nieudana:', err);
        });
    });
}

function updateOnlineStatus() {
    const offlineOverlay = document.getElementById('offline-overlay');
    const headerBadge = document.getElementById('offline-badge-header');
    const mDot = document.getElementById('m-online-dot');
    const mText = document.getElementById('m-online-text');

    if (!navigator.onLine) {
        if (offlineOverlay) {
            offlineOverlay.classList.add('active');
            initSky('offline-sky');
        }
        if (headerBadge) headerBadge.style.display = 'block';
        if (mDot) {
            mDot.style.background = "#94a3b8";
            mDot.style.boxShadow = "0 0 10px #94a3b8";
        }
        if (mText) mText.innerText = "OFFLINE";
    } else {
        if (offlineOverlay) {
            offlineOverlay.classList.remove('active');
            stopOfflineSky();
        }
        if (headerBadge) headerBadge.style.display = 'none';
        if (mDot) {
            mDot.style.background = "var(--success)";
            mDot.style.boxShadow = "0 0 10px var(--success)";
        }
        if (mText) mText.innerText = "ONLINE";
    }
}

let offlineSkyInterval = null;

function createShootingStar(containerId = 'offline-sky') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const star = document.createElement('div');
    star.className = 'shooting-star';
    
    // Losuj pozycję startową (z prawej strony)
    const startX = 60 + Math.random() * 40; // 60-100% szerokości
    const startY = Math.random() * 40; // 0-40% wysokości
    
    star.style.left = `${startX}%`;
    star.style.top = `${startY}%`;
    star.style.setProperty('--duration', `${1 + Math.random() * 1.5}s`); // Szybszy, bardziej realistyczny przelot
    
    container.appendChild(star);
    setTimeout(() => star.remove(), 4000);
}

let mainSkyInterval = null;
function initSky(containerId) {
    const container = document.getElementById(containerId);
    if (!container || container.children.length > 0) return;

    // Generuj stałe gwiazdy
    for (let i = 0; i < 150; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        const size = Math.random() * 3;
        star.style.width = `${size}px`;
        star.style.height = `${size}px`;
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        star.style.setProperty('--duration', `${2 + Math.random() * 3}s`);
        star.style.animationDelay = `${Math.random() * 5}s`;
        container.appendChild(star);
    }

    // Logika spadających gwiazd
    const interval = setInterval(() => {
        if (Math.random() > 0.8) {
            createShootingStar(containerId);
        }
    }, 3000);

    if (containerId === 'offline-sky') offlineSkyInterval = interval;
    else mainSkyInterval = interval;
}

function stopOfflineSky() {
    const container = document.getElementById('offline-sky');
    if (container) container.innerHTML = "";
    if (offlineSkyInterval) clearInterval(offlineSkyInterval);
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus(); // Sprawdź na starcie

// Inicjalizacja gwiazd na stronie głównej
setTimeout(() => initSky('main-sky'), 1000);

// --- LOGIKA BIZNESOWA ---
const findStation = (input) => {
    if (!input) return null;
    const normalizedInput = normalizeStationName(input);
    const key = Object.keys(stations).find(k => normalizeStationName(k) === normalizedInput);
    return key ? { ...stations[key], name: key } : null;
};

window.calculatePrice = (event) => {
    if (isCalcDisabled) {
        window.showCustomDialog("🔒 Funkcja Zablokowana", calcDisabledMsg);
        return;
    }
    const fInputElem = document.getElementById('route-from');
    const tInputElem = document.getElementById('route-to');
    const d = parseFloat(document.getElementById('discount-select').value);

    // Resetowanie błędów
    [fInputElem, tInputElem].forEach(input => {
        if (input) {
            input.classList.remove('invalid');
            input.oninput = () => input.classList.remove('invalid');
        }
    });
    
    let hasError = false;
    if(!fInputElem.value) { fInputElem.classList.add('invalid'); hasError = true; }
    if(!tInputElem.value) { tInputElem.classList.add('invalid'); hasError = true; }

    if(hasError) return window.showToast("Wpisz lub wybierz stacje!", "error");

    const stFrom = findStation(fInputElem.value);
    const stTo = findStation(tInputElem.value);
    
    if (stFrom) fInputElem.value = stFrom.name.toUpperCase();
    if (stTo) tInputElem.value = stTo.name.toUpperCase();
    
    if(!stFrom || !stTo) {
        window.showToast("Stacja poza bazą. Wpisz cenę ręcznie.", "warning");
        return;
    }
    
    const dist = Math.abs(stFrom.km - stTo.km);
    
    // ZINTEGROWANY WYBÓR TARYFY PRZEZ DIALOG
    window.showActionMenu(event, [
        { label: 'MIEJSKA (PR/SKMT)', icon: 'fa-train-subway', onClick: () => {
            const price = getTariffFromData(dist, 'miejska', d);
            applyCalculatedPrice(dist, price, 'MIEJSKA');
        }},
        { label: 'WOJEWÓDZKA (IC)', icon: 'fa-train', onClick: () => {
            const price = getTariffFromData(dist, 'wojewodzka', d);
            applyCalculatedPrice(dist, price, 'WOJEWÓDZKA');
        }}
    ]);
};

function getTariffFromData(dist, type, discount) {
    const rows = tariffsData[type] || [];
    if (rows.length === 0) return 0;
    const sorted = [...rows].sort((a, b) => a.km - b.km);
    const match = sorted.find(r => r.km >= dist);
    const finalRow = match ? match : sorted[sorted.length - 1];
    
    // Obliczamy cenę na podstawie zniżki (discount to ułamek, np. 0.37 dla 37%)
    return finalRow.normal * (1 - discount);
}

function applyCalculatedPrice(dist, price, label) {
    document.getElementById('trip-amount').value = price.toFixed(2);
    window.showToast(`Dystans: ${dist} km | Taryfa: ${label} | Cena: ${price.toFixed(2)} zł`, "success");
}

window.toggleFancyPartMenu = () => {
    const menu = document.getElementById('fancy-part-menu');
    const btn = document.getElementById('fancy-part-btn');
    const cenaInput = document.getElementById('trip-amount');
    if (!menu || !btn) return;

    const isOpen = menu.classList.toggle('open');
    btn.classList.toggle('active');
    
    if (isOpen) {
        window.populateTripLinkSelect();
        if (cenaInput) {
            cenaInput.value = "- zł"; // Zmienione na "- zł"
            cenaInput.style.color = "rgba(255,255,255,0.3)";
        }
    } else {
        // Reset values when closing
        document.getElementById('trip-link-to').value = "";
        document.getElementById('trip-part-order').value = "";
        if (cenaInput) {
            cenaInput.value = "";
            cenaInput.style.color = "var(--success)";
        }
    }
};

window.handleTripLinkChange = () => {
    const select = document.getElementById('trip-link-to');
    const cenaInput = document.getElementById('trip-amount');
    if (!select || !cenaInput) return;

    const tripKey = select.value;
    if (!tripKey) return;

    const linkedTrip = tripsData.find(t => t.key === tripKey);
    if (linkedTrip) {
        cenaInput.value = "- zł"; // Zmienione na "- zł" zgodnie z prośbą
        cenaInput.style.color = "rgba(255,255,255,0.3)";
        window.showToast("Cena ustawiona na '- zł' (część trasy)", "info");
    }
};

window.populateTripLinkSelect = () => {
    const select = document.getElementById('trip-link-to');
    if (!select) return;
    select.innerHTML = '<option value="">Wybierz przejazd do linkowania...</option>';
    
    // Bierzemy ostatnie 10 przejazdów
    const recent = tripsData.slice(-10).reverse();
    recent.forEach(t => {
        const option = document.createElement('option');
        option.value = t.key;
        option.innerText = `${t.od} -> ${t.do} (${t.zl}zł) - ${t.data}`;
        select.appendChild(option);
    });
};

window.addNewTrip = () => {
    const fInputElem = document.getElementById('route-from');
    const tInputElem = document.getElementById('route-to');
    const cenaInput = document.getElementById('trip-amount');
    const zl = parseFloat(cenaInput.value);
    const nr = document.getElementById('regio-num').value;
    const unit = document.getElementById('unit-num').value;
    const note = document.getElementById('trip-note').value;
    const discount = document.getElementById('discount-select').value;
    
    const menu = document.getElementById('fancy-part-menu');
    const isPart = menu ? menu.classList.contains('open') : false;
    const linkTo = document.getElementById('trip-link-to').value;
    const partOrder = document.getElementById('trip-part-order').value;

    // Resetowanie błędów
    [fInputElem, tInputElem, cenaInput].forEach(input => {
        if (input) {
            input.classList.remove('invalid');
            input.oninput = () => input.classList.remove('invalid');
        }
    });
    
    let hasError = false;
    if(!fInputElem.value) { fInputElem.classList.add('invalid'); hasError = true; }
    if(!tInputElem.value) { tInputElem.classList.add('invalid'); hasError = true; }
    
    // Cena wymagana tylko jeśli to NIE jest część trasy
    if(!isPart && (isNaN(zl) || cenaInput.value === "")) { 
        cenaInput.classList.add('invalid'); 
        hasError = true; 
    }

    if(hasError) return window.showToast("Uzupełnij podświetlone pola!", "error");

    // Autokorekta przed zapisem
    const stFrom = findStation(fInputElem.value);
    const stTo = findStation(tInputElem.value);
    
    const finalFrom = stFrom ? stFrom.name.toUpperCase() : fInputElem.value.trim().toUpperCase();
    const finalTo = stTo ? stTo.name.toUpperCase() : tInputElem.value.trim().toUpperCase();

    const tripDataToSave = {
        od: finalFrom,
        do: finalTo,
        zl: isPart ? 0 : zl, // Zapisujemy 0 w bazie, ale w UI było "-"
        nr: nr,
        unit: unit || "",
        note: note || "",
        data: new Date().toLocaleDateString('pl-PL'),
        isPart: isPart,
        linkTo: linkTo || null,
        partOrder: partOrder || null,
        discount: discount
    };

    const newTripRef = push(tripsRef, tripDataToSave);
    newTripRef.then(() => {
        const tripId = newTripRef.key;
        
        if (!isPart) {
            set(statsRef, earnedSoFar + zl);
        }
        
        // Dodaj do aktywnego biletu miesięcznego
        const now = new Date();
        const activeTicket = monthlyTickets.find(t => new Date(t.startDate) <= now && new Date(t.endDate) > now);
        if (activeTicket) {
            const ticketRef = ref(db, `stats/bilety_miesieczne/${activeTicket.id}`);
            get(ticketRef).then((snap) => {
                const currentData = snap.val();
                const currentTrips = currentData.trips || [];
                update(ticketRef, {
                    tripCount: (currentData.tripCount || 0) + 1,
                    totalCost: (currentData.totalCost || 0) + (isPart ? 0 : zl),
                    trips: [...currentTrips, tripId]
                });
            });
        }
        
        fInputElem.value = "";
        tInputElem.value = "";
        cenaInput.value = "";
        document.getElementById('regio-num').value = "";
        document.getElementById('unit-num').value = "";
        document.getElementById('trip-note').value = "";
        
        // Reset fancy menu
        if (isPart) window.toggleFancyPartMenu();

        // Auto-zliczanie miast
        window.autoCountCities(finalFrom, finalTo);
        
        window.showToast("Przejazd zapisany!", "success");
    });
};

window.saveNewStation = () => {
    const nameInput = document.getElementById('new-st-name');
    const kmInput = document.getElementById('new-st-km');
    const xInput = document.getElementById('new-st-x');
    const yInput = document.getElementById('new-st-y');
    const labelPosInput = document.getElementById('new-st-label-pos');

    // Resetowanie błędów
    [nameInput, xInput, yInput].forEach(input => {
        if (input) {
            input.classList.remove('invalid');
            // Usuń poprzedni listener jeśli istnieje, żeby nie dublować
            input.oninput = () => input.classList.remove('invalid');
        }
    });

    const name = nameInput.value.toLowerCase().trim();
    const km = kmInput.value === "" ? 0 : parseFloat(kmInput.value);
    const x = parseInt(xInput.value);
    const y = parseInt(yInput.value);
    const p = newStationParentHandler ? newStationParentHandler.getTags().join(', ') : "";
    const lp = labelPosInput.value;

    let hasError = false;
    if (!name) { nameInput.classList.add('invalid'); hasError = true; }
    if (isNaN(x)) { xInput.classList.add('invalid'); hasError = true; }
    if (isNaN(y)) { yInput.classList.add('invalid'); hasError = true; }

    if (hasError) {
        return window.showToast("Uzupełnij podświetlone pola!", "error");
    }

    const newStationData = { 
        km, 
        x, 
        y, 
        parent: p || null, 
        labelPos: lp,
        fontSize: 14,
        rotation: 0,
        radius: globalPinSize,
        offX: 0,
        offY: 0,
        color: globalPinColor
    };

    set(ref(db, `stats/stacje_siec/${name}`), newStationData).then(() => {
        tempMarker = null;
        nameInput.value = "";
        kmInput.value = "";
        xInput.value = "";
        yInput.value = "";
        if (newStationParentHandler) newStationParentHandler.setTags([]);
        renderBase();
        window.showToast("Stacja dodana do bazy!", "success");
    }).catch(e => {
        console.error("Błąd dodawania stacji:", e);
        window.showToast("Błąd podczas zapisywania stacji.", "error");
    });
};

window.deleteGalleryItem = (key) => {
    const item = galleryData.find(g => g.key === key);
    window.openDeleteConfirm(`To usunie schemat "${item ? item.title : key}" z galerii.`, () => {
        remove(ref(db, `stats/schematy/${key}`)).then(() => window.showToast("Element usunięty.", "success"));
    });
};

window.editGalleryItem = (key) => {
    const item = galleryData.find(g => g.key === key);
    if (!item) return;

    window.openUniversalEdit("Edytuj Schemat", [
        { id: 'title', label: 'Tytuł schematu / Tekst', value: item.title },
        { id: 'src', label: 'Link do zdjęcia (opcjonalnie)', value: item.src || "" },
        { id: 'w', label: 'Szerokość (px)', value: item.w || 1600, type: 'number' },
        { id: 'h', label: 'Wysokość (px)', value: item.h || 2000, type: 'number' },
        { id: 'completed', label: 'Ukończono / Odhaczono', value: item.completed || false, type: 'checkbox' }
    ], (res) => {
        const updatedItem = {
            ...item,
            title: res.title,
            src: res.src || null,
            w: parseInt(res.w) || 1600,
            h: parseInt(res.h) || 2000,
            completed: res.completed
        };
        delete updatedItem.key; // Usuwamy klucz przed zapisem do Firebase

        set(ref(db, `stats/schematy/${key}`), updatedItem).then(() => {
            window.showToast("Schemat zaktualizowany!", "success");
        });
    });
};

window.addNewGalleryItem = (isQuick = false) => {
    const prefix = isQuick ? 'quick-' : 'new-';
    const title = document.getElementById(`${prefix}gallery-title`).value;
    const src = document.getElementById(`${prefix}gallery-src`).value;
    const w = parseInt(document.getElementById(`${prefix}gallery-w`).value) || 1600;
    const h = parseInt(document.getElementById(`${prefix}gallery-h`).value) || 2000;
    const completed = isQuick ? false : document.getElementById('new-gallery-completed').checked;
    
    if(!title) return window.showToast("Podaj chociaż tytuł!", "error");
    
    // Obliczamy index na podstawie aktualnej długości listy
    const orderIndex = galleryData.length;
    
    // Determine type based on mode and active tab
    let type = 'schemat';
    if (isGalleryTodoMode) {
        type = 'todo';
    } else {
        if (activeGalleryTab === 'todo') {
            type = 'todo';
        }
    }
    
    const newItem = { 
        title: title, 
        src: src || null,
        order: orderIndex,
        w: w,
        h: h,
        completed: completed,
        type: type
    };
    
    push(schematyRef, newItem).then(() => {
        document.getElementById(`${prefix}gallery-title`).value = "";
        document.getElementById(`${prefix}gallery-src`).value = "";
        if (!isQuick) {
            document.getElementById('new-gallery-completed').checked = false;
            window.toggleGalleryEditor(); // Zamknij po dodaniu w adminie
        }
        window.showToast(isGalleryTodoMode ? "Zadanie dodane pomyślnie!" : "Schemat dodany pomyślnie!", "success");
    });
};

window.editGalleryItem = (key) => {
    const item = galleryData.find(g => g.key === key);
    if (!item) return;

    const fields = [
        { id: 'title', label: 'Tytuł schematu / Tekst', value: item.title },
        { id: 'src', label: 'Link do zdjęcia (opcjonalnie)', value: item.src || "" },
        { id: 'w', label: 'Szerokość (px)', value: item.w || 1600, type: 'number' },
        { id: 'h', label: 'Wysokość (px)', value: item.h || 2000, type: 'number' }
    ];
    
    // Add type field only if not in full todo mode
    if (!isGalleryTodoMode) {
        fields.push({ 
            id: 'type', 
            label: 'Typ', 
            value: item.type || 'schemat', 
            options: [
                { label: 'Schemat', value: 'schemat' },
                { label: 'Zadanie (TO DO)', value: 'todo' }
            ]
        });
        fields.push({ id: 'completed', label: 'Ukończono / Odhaczono', value: item.completed || false, type: 'checkbox' });
    }

    window.openUniversalEdit("Edytuj Element", fields, (res) => {
        const updatedItem = {
            ...item,
            title: res.title,
            src: res.src || null,
            w: parseInt(res.w) || 1600,
            h: parseInt(res.h) || 2000
        };
        
        if (!isGalleryTodoMode) {
            updatedItem.completed = res.completed;
            updatedItem.type = res.type;
        }
        
        delete updatedItem.key; // Usuwamy klucz przed zapisem do Firebase

        set(ref(db, `stats/schematy/${key}`), updatedItem).then(() => {
            window.showToast("Element zaktualizowany!", "success");
        });
    });
};

window.reorderGalleryItem = (key, direction) => {
    const idx = galleryData.findIndex(g => g.key === key);
    if (idx === -1) return;
    
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= galleryData.length) return;
    
    const currentItem = galleryData[idx];
    const targetItem = galleryData[newIdx];
    
    // Zamiana wartości 'order'
    const currentOrder = currentItem.order || idx;
    const targetOrder = targetItem.order || newIdx;
    
    set(ref(db, `stats/schematy/${currentItem.key}/order`), targetOrder);
    set(ref(db, `stats/schematy/${targetItem.key}/order`), currentOrder).then(() => {
        window.showToast("Kolejność zmieniona!", "success");
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
    // Jeśli już odblokowano gestem (10 kliknięć), po prostu otwórz panel
    if (isAdminUnlocked) {
        window.openSecretPanel();
        return;
    }

    // Sprawdź czy już użyto 10 kliknięć raz
    if (localStorage.getItem('adminUnlockedOnce') === 'true') {
        return;
    }

    // Inaczej naliczaj kliknięcia
    busClicks++;
    
    if (busClicks === 10) {
        busClicks = 0;
        isAdminUnlocked = true; // Odblokowujemy dostęp gestem
        localStorage.setItem('adminUnlockedOnce', 'true'); // Zapisz że już użyto
        renderFullHistory();
        window.showToast("Dostęp odblokowany! Podaj hasło", "info");
        window.openSecretPanel();
    }
};

window.openSecretPanel = () => {
    window.closeAllModals();
    document.getElementById('secret-modal').classList.add('active');
    document.body.classList.add('no-scroll');
    
    // ZAWSZE prosimy o hasło w tajnym panelu po odświeżeniu strony, 
    // nawet jeśli użytkownik jest zalogowany w Beta Tests.
    if (isSecretPanelAuth) {
        document.getElementById('secret-login-view').style.display = 'none';
        document.getElementById('secret-content-view').style.display = 'flex';
        updateAdminPanelFields();
    } else {
        document.getElementById('secret-login-view').style.display = 'block';
        document.getElementById('secret-content-view').style.display = 'none';

        const statusText = document.getElementById('secret-status-text');
        if (!storedPassword) {
            statusText.innerText = "Witaj w Panelu Tajnym! Wymyśl hasło, aby je zapisać:";
            document.querySelector('#secret-login-view button').innerText = "USTAW HASŁO";
        } else {
            statusText.innerText = "Wpisz hasło, aby wejść:";
            document.querySelector('#secret-login-view button').innerText = "ZALOGUJ";
        }
    }

    // Załaduj aktualne dane biletu do pól edycji
    onValue(ref(db, 'stats/config/isGalleryAddModeActive'), (s) => {
        isGalleryAddModeActive = !!s.val();
        updateGalleryAddModeUI();
    });

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

    // Załaduj czas konserwacji
    if (maintenanceEndTime) {
        document.getElementById('m-end-time-input').value = maintenanceEndTime;
    }
    
    renderInviteCodes();
};

window.renderInviteCodes = () => {
    const list = document.getElementById('admin-invite-codes-list');
    if (!list) return;
    list.innerHTML = '';
    inviteCodes.forEach((code, index) => {
        const item = document.createElement('div');
        item.className = 'secret-gadget';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.padding = '10px';
        item.style.borderRadius = '8px';
        item.style.background = 'rgba(255,255,255,0.05)';
        item.innerHTML = `
            <span style="font-family: monospace; font-size: 12px;">${code}</span>
            <button onclick="window.removeInviteCode(${index})" style="width: auto; padding: 5px 10px; font-size: 10px; background: var(--danger);">USUŃ</button>
        `;
        list.appendChild(item);
    });
};

window.addInviteCode = () => {
    const input = document.getElementById('new-invite-code');
    if (!input) return;
    const newCode = input.value.trim();
    if (!newCode) return window.showToast('Wprowadź kod zaproszenia!', 'error');
    if (inviteCodes.includes(newCode)) return window.showToast('Ten kod już istnieje!', 'error');
    
    inviteCodes.push(newCode);
    renderInviteCodes();
    update(configRef, { inviteCodes }).then(() => {
        window.showToast('Kod zaproszenia dodany!', 'success');
        input.value = '';
    });
};

window.removeInviteCode = (index) => {
    inviteCodes.splice(index, 1);
    renderInviteCodes();
    update(configRef, { inviteCodes }).then(() => {
        window.showToast('Kod zaproszenia usunięty!', 'success');
    });
};

window.switchAdminTab = (tabName) => {
    // Hide all tab contents
    document.querySelectorAll('[id^="tab-content-"]').forEach(el => {
        el.style.display = 'none';
    });
    // Reset all tab buttons styles
    document.querySelectorAll('[id^="tab-"]').forEach(el => {
        if (el.tagName === 'BUTTON') {
            el.style.background = 'rgba(255,255,255,0.1)';
        }
    });
    // Show selected tab content and highlight button
    const selectedContent = document.getElementById(`tab-content-${tabName}`);
    const selectedButton = document.getElementById(`tab-${tabName}`);
    if (selectedContent) {
        selectedContent.style.display = 'block';
        if (tabName === 'system') {
            selectedContent.style.background = 'linear-gradient(135deg, #1e1b4b 0%, #4c1d95 100%)';
        }
    }
    if (selectedButton) {
        selectedButton.style.background = 'var(--accent)';
    }
    
    // Render appropriate lists for each tab
    switch(tabName) {
        case 'stations-trips':
            renderAdminStations();
            renderAdminTrips();
            break;
        case 'cities':
            renderAdminCities();
            break;
        case 'tariffs':
            renderAdminTariffs();
            break;
        case 'achievements':
            renderAdminAchievements();
            break;
        case 'monthly-tickets':
            renderAdminMonthlyTickets();
            break;
    }
};

window.unarchiveTicket = (ticketId) => {
    const ticketRef = ref(db, `stats/bilety_miesieczne/${ticketId}`);
    update(ticketRef, { archived: false });
    window.showToast('Cofnięto archiwizację!', 'success');
};

window.updateTicketStats = (ticketId, field, value) => {
    const ticketRef = ref(db, `stats/bilety_miesieczne/${ticketId}`);
    update(ticketRef, { [field]: value });
};

window.renderAdminMonthlyTickets = () => {
    const container = document.getElementById('admin-monthly-tickets-list');
    if (!container) return;

    if (monthlyTickets && monthlyTickets.length > 0) {
        container.innerHTML = monthlyTickets.map(ticket => {
            const savings = (ticket.totalCost || 0) - (ticket.price || 0);
            const ticketName = ticket.customName || ticket.type;
            const isArchived = ticket.archived || false;
            
            return `
            <div class="card" style="background: rgba(0,0,0,0.2);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                    <div>
                        <h5 style="margin: 0; color: ${isArchived ? 'rgba(255,255,255,0.6)' : 'var(--accent)'}; font-size: 14px;">${ticketName}</h5>
                        <p style="margin: 4px 0 0 0; font-size: 11px; opacity: 0.7;">
                            ${new Date(ticket.startDate).toLocaleDateString('pl-PL')} - ${new Date(ticket.endDate).toLocaleDateString('pl-PL')}
                            ${isArchived ? '<span style="margin-left:8px; background: rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px;">📦 Zarchiwizowany</span>' : ''}
                        </p>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; margin-bottom: 10px;">
                    <div style="background: rgba(0,0,0,0.2); padding: 6px; border-radius: 6px; text-align: center;">
                        <div style="opacity:0.6;">Cena biletu</div>
                        <div style="font-weight: 800; color: var(--warning);">${(ticket.price || 0).toFixed(2)} zł</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.2); padding: 6px; border-radius: 6px; text-align: center;">
                        <div style="opacity:0.6;">Przejazdy</div>
                        <div style="font-weight: 800;">${ticket.tripCount || 0}</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.2); padding: 6px; border-radius: 6px; text-align: center;">
                        <div style="opacity:0.6;">Wartość</div>
                        <div style="font-weight: 800;">${(ticket.totalCost || 0).toFixed(2)} zł</div>
                    </div>
                    <div style="background: ${savings > 0 ? 'var(--success)' : 'rgba(0,0,0,0.2)'}; padding: 6px; border-radius: 6px; text-align: center;">
                        <div style="opacity:0.8;">Oszczędności</div>
                        <div style="font-weight: 800;">${savings >= 0 ? '+' : ''}${savings.toFixed(2)} zł</div>
                    </div>
                </div>
                <div style="display:flex; gap:8px; margin-bottom:8px;">
                    ${isArchived ? `<button onclick="window.unarchiveTicket('${ticket.id}')" style="flex:1; padding:10px; background:var(--accent); border:none; border-radius:8px; font-weight:800; cursor:pointer;">
                        ↩️ Cofnij zakończenie
                    </button>` : ''}
                    <button onclick="window.openTicketDetails('${ticket.id}')" style="flex:1; padding:10px; background:var(--info); border:none; border-radius:8px; font-weight:800; cursor:pointer;">
                        ✏️ Zarządzaj
                    </button>
                </div>
                <button onclick="window.confirmDeleteTicket('${ticket.id}')" style="width:100%; padding:10px; background:var(--danger); border:none; border-radius:8px; font-weight:800; cursor:pointer;">
                    🗑️ Usuń bilet
                </button>
            </div>`;
        }).join('');
    } else {
        container.innerHTML = '<p style="text-align:center; opacity:0.5;">Brak biletów miesięcznych</p>';
    }
};

window.checkSecretPassword = () => {
    const input = document.getElementById('secret-password-input');
    const pass = input.value;
    if (!pass) return alert("Wpisz hasło!");

    if (!storedPassword) {
        // Ustawianie hasła po raz pierwszy - używamy konkretnej ścieżki, by nie nadpisać reszty configu
        set(ref(db, 'stats/config/password'), pass).then(() => {
            alert("Hasło zostało ustawione i zapisane w chmurze! ✅");
            window.showSecretContent();
        });
    } else {
        // Logowanie
        if (pass === storedPassword) {
            window.showSecretContent();
        } else {
            alert("Błędne hasło! ❌");
            window.addConsoleLog(`NIEPOPRAWNE HASŁO ( ${pass} ) - PRÓBA LOGOWANIA PANEL TAJNY`, "error");
            logFailedPassword(pass, "PANEL_TAJNY");
        }
    }
    input.value = "";
};

function logFailedPassword(pass, context) {
    const failedRef = ref(db, 'stats/config/failedPasswords');
    onValue(failedRef, (s) => {
        let list = s.val() || [];
        if (!Array.isArray(list)) list = [];
        
        // Dodaj nowe hasło na początek
        list.unshift({
            pass: pass,
            date: new Date().toLocaleString(),
            context: context
        });
        
        // Zachowaj tylko 5 ostatnie
        const limited = list.slice(0, 5);
        set(failedRef, limited);
    }, { onlyOnce: true });
}

window.showSecretContent = () => {
    document.getElementById('secret-login-view').style.display = 'none';
    document.getElementById('secret-content-view').style.display = 'flex';
    isSecretPanelAuth = true; 
    isAdminUnlocked = true;
    localStorage.setItem('isSecretPanelAuth', 'true');
    updateMenuSettingsItem();
    
    // UI Updates
    const busTrigger = document.getElementById('admin-bus-trigger');
    if (busTrigger) {
        busTrigger.classList.add('admin-unlocked'); // LGBTQ Tęcza
        busTrigger.classList.add('admin-active');
        busTrigger.style.background = "var(--success)"; // Zmiana koloru na zielony po pełnym zalogowaniu
        busTrigger.style.color = "#000";
    }
    const labelPanel = document.getElementById('admin-label-edit-panel');
    if (labelPanel) labelPanel.style.display = 'block';

    updateMaintenanceUI();
    updateGalleryAddModeUI(); // NOWE
    updateCalcBtnUI();
    updateAdminPanelFields();
    
    // Initialize admin tabs and render initial content
    window.switchAdminTab('system');
    
    // Pokaż pływające GUI
    const floatingGui = document.getElementById('floating-admin-gui');
    if (floatingGui) {
        floatingGui.style.display = 'block';
        floatingGui.classList.add('active');
    }

    window.showToast("Zalogowano pomyślnie!", "success");
    window.addConsoleLog("Administrator zalogowany", "success");
    
    // Załaduj statystyki
    const stationsCount = Object.keys(stations).length;
    const tripsCount = tripsData.length;
    const totalEarned = earnedSoFar.toFixed(2);
    document.getElementById('adv-stats-text').innerHTML = `
        🚀 Aktywne stacje: <b>${stationsCount}</b><br>
        📅 Wszystkie przejazdy: <b>${tripsCount}</b><br>
        💎 Łączny zysk: <b>${totalEarned} zł</b><br>
        ⚡ Czas ładowania: <b>${loadTimeValue}ms</b><br>
        🛰️ System: <b>RegioPomorskie PRO 2.0</b>
    `;
};

window.requestPasswordChange = () => {
    window.openUniversalEdit("Zmień Hasło", [
        { id: 'securityCode', label: 'Kod Zabezpieczający', value: "", placeholder: "Wpisz kod..." },
        { id: 'newPassword', label: 'Nowe Hasło', value: "", placeholder: "Wpisz nowe hasło..." }
    ], (res) => {
        if (res.securityCode !== "2583") {
            return window.showToast("Błędny kod zabezpieczający! ❌", "error");
        }
        if (!res.newPassword) {
            return window.showToast("Hasło nie może być puste!", "error");
        }

        window.openDeleteConfirm(`Czy na pewno chcesz zmienić hasło na: ${res.newPassword}?`, () => {
             set(ref(db, 'stats/config/password'), res.newPassword).then(() => {
                 window.showToast("Hasło zmienione pomyślnie! ✅", "success");
                 storedPassword = res.newPassword;
             }).catch(e => {
                 console.error("Błąd zmiany hasła:", e);
                 window.showToast("Błąd podczas zapisu!", "error");
             });
         }, "TAK, ZMIEŃ");
    });
};

// BAJERY
window.updateMapZoom = (val) => {
    mapState.scale = parseFloat(val);
    renderBase();
};

window.updateHeatZoom = (val) => {
    heatState.scale = parseFloat(val);
    renderHeat();
};

let rainbowActive = false;
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
    const sideMenu = document.getElementById('side-menu');
    const menuOverlay = document.getElementById('menu-overlay');
    const isOpening = !sideMenu.classList.contains('active');
    
    sideMenu.classList.toggle('active');
    menuOverlay.classList.toggle('active');
    
    if (isOpening) {
        document.body.classList.add('no-scroll');
        // Zamknij menu edytora jeśli jest otwarte
        const editorMenu = document.getElementById('editor-side-menu');
        if (editorMenu) editorMenu.classList.remove('active');
    } else {
        const anyModalActive = !!document.querySelector('.modal.active');
        if (!anyModalActive) {
            document.body.classList.remove('no-scroll');
        }
    }
};
window.closeMenu = () => {
    document.getElementById('side-menu').classList.remove('active');
    document.getElementById('menu-overlay').classList.remove('active');
    const anyModalActive = !!document.querySelector('.modal.active');
    if (!anyModalActive) {
        document.body.classList.remove('no-scroll');
    }
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

// --- CAPS LOCK DETECTION ---
const initCapsLockDetection = () => {
    const passwordInputs = ['m-password-input', 'secret-password-input'];
    
    passwordInputs.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;

        const updateWarning = (e) => {
            const warningId = id === 'm-password-input' ? 'm-caps-warning' : 'secret-caps-warning';
            const warning = document.getElementById(warningId);
            if (!warning) return;

            const isCaps = e.getModifierState && e.getModifierState('CapsLock');
            if (isCaps) {
                warning.classList.add('active');
            } else {
                warning.classList.remove('active');
            }
        };

        input.addEventListener('keydown', updateWarning);
         input.addEventListener('keyup', updateWarning);
         input.addEventListener('mousedown', updateWarning);
         
         // Dodatkowo przy focusie, żeby od razu sprawdzić stan
         input.addEventListener('focus', (e) => {
             // Niektóre przeglądarki pozwalają sprawdzić stan przy focusie
             if (e.getModifierState) {
                updateWarning(e);
             }
         });
    });
};

// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', () => {
    initCapsLockDetection();
    initAdminSearch();
    handleStationInputBlur('route-from');
    handleStationInputBlur('route-to');

    // Obliczanie czasu ładowania
    loadTimeValue = Math.round(performance.now() - startTime);
});
// Ponieważ app.js może być ładowany asynchronicznie, wywołajmy też od razu
initCapsLockDetection();

window.handleLandingLogoClick = () => {
    // Funkcja pusta - zapobiega błędom i logom przy kliknięciu w logo na ekranie startowym
};

function initAdminSearch() {
    const stSearch = document.getElementById('admin-station-search');
    const trSearch = document.getElementById('admin-trip-search');
    
    if (stSearch) stSearch.addEventListener('input', (e) => renderAdminStations(e.target.value));
    if (trSearch) trSearch.addEventListener('input', (e) => renderAdminTrips(e.target.value));
}

function handleStationInputBlur(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('blur', () => {
        const val = input.value;
        if (!val) return;
        const match = findStation(val);
        if (match) {
            input.value = match.name.toUpperCase();
        }
    });
}

function updateProgressUI() {
    const fill = document.getElementById('bar-fill');
    const label = document.getElementById('percentage-label');
    const earnedText = document.getElementById('earned-val');
    if (!fill || !label || !earnedText) return;

    let ticket = null;
    if (simulatedTicketId) {
        ticket = monthlyTickets.find(t => t.id === simulatedTicketId);
    } else {
        const activeTickets = monthlyTickets.filter(t => !t.archived);
        if (activeTickets.length > 0) ticket = activeTickets[0];
    }

    let currentEarned = 0;
    if (ticket) {
        currentEarned = (ticket.totalCost || 0); // Licz od zera, nie odejmuj ceny biletu!
    }

    const goal = 150.0;
    const rawPercent = (currentEarned / goal) * 100;
    const percent = Math.min(rawPercent, 1000); // Limit wizualny
    
    fill.style.width = Math.min(percent, 100) + "%"; // Pasek graficznie do 100%
    label.innerText = Math.floor(rawPercent) + "%";
    earnedText.innerText = currentEarned.toFixed(2) + " zł";

    // Sprawdzanie progów konfetti (co 50%) - skip for now since we're using ticket-specific data
    if (!isInitialConfigLoaded) return;

    // Efekt animacji po przekroczeniu 100%
    if (rawPercent >= 100) {
        fill.classList.add('goal-reached');
        fill.style.width = "100%"; // Zawsze pełny jeśli powyżej 100%
    } else {
        fill.classList.remove('goal-reached');
    }
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
    if (!isAdminUnlocked) {
        return window.showToast("Dostęp tylko dla administratora!", "error");
    }
    window.closeAllModals();
    const modal = document.getElementById('station-editor-modal');
    if (modal) modal.classList.add('active'); 
    window.setActiveMenuItem('menu-map');
    document.body.classList.add('no-scroll');
    renderBase(); 
};
window.closeMap = () => {
    document.getElementById('map-modal').classList.remove('active');
    document.body.classList.remove('no-scroll');
};

window.openHeatmap = () => { 
    window.closeAllModals();
    document.getElementById('heatmap-modal').classList.add('active'); 
    window.setActiveMenuItem('menu-heatmap');
    document.body.classList.add('no-scroll');
    // Set color picker to current heatmap bg color
    const colorPicker = document.getElementById('heat-bg-color-picker');
    if (colorPicker) {
        colorPicker.value = currentHeatmapBg;
    }
    
    // Get trips from active or simulated ticket
    let customUsage = null;
    const now = new Date();
    let ticket = null;
    
    if (simulatedTicketId) {
        ticket = monthlyTickets.find(t => t.id === simulatedTicketId);
    } else {
        const activeTickets = monthlyTickets.filter(t => !t.archived);
        if (activeTickets.length > 0) {
            ticket = activeTickets[0];
        }
    }
    
    if (ticket) {
        const ticketTrips = (ticket.trips || []).map(tripId => {
            const trip = tripsData.find(t => t.key === tripId);
            return trip || null;
        }).filter(t => t !== null);
        customUsage = getUsageData(ticketTrips);
        window.showToast(`Heatmapa dla ${ticket.customName || ticket.type}!`, "success");
    }
    
    renderHeat(customUsage); 
};
window.closeHeatmap = () => {
    document.getElementById('heatmap-modal').classList.remove('active');
    document.body.classList.remove('no-scroll');
};

window.openGallery = () => { 
    window.closeAllModals();
    document.getElementById('gallery-modal').classList.add('active'); 
    window.setActiveMenuItem('menu-gallery');
    document.body.classList.add('no-scroll');
};
window.closeGallery = () => {
    document.getElementById('gallery-modal').classList.remove('active');
    document.body.classList.remove('no-scroll');
};

let selectedReadonlyTariffType = 'miejska';

window.switchSettingsTab = (tab) => {
    const stationsBtn = document.getElementById('settings-tab-stations');
    const tablesBtn = document.getElementById('settings-tab-tables');
    const stationsView = document.getElementById('settings-view-stations');
    const tablesView = document.getElementById('settings-view-tables');

    if (tab === 'stations') {
        stationsBtn.classList.add('active');
        tablesBtn.classList.remove('active');
        stationsView.style.display = 'block';
        tablesView.style.display = 'none';
    } else {
        stationsBtn.classList.remove('active');
        tablesBtn.classList.add('active');
        stationsView.style.display = 'none';
        tablesView.style.display = 'block';
        renderReadonlyTariffs();
    }
};

window.switchReadonlyTariffTab = (type) => {
    selectedReadonlyTariffType = type;
    const miejskaBtn = document.getElementById('readonly-tariff-tab-miejska');
    const wojewodzkaBtn = document.getElementById('readonly-tariff-tab-wojewodzka');
    
    if (miejskaBtn) miejskaBtn.style.background = type === 'miejska' ? 'var(--accent)' : 'rgba(255,255,255,0.05)';
    if (wojewodzkaBtn) wojewodzkaBtn.style.background = type === 'wojewodzka' ? 'var(--accent)' : 'rgba(255,255,255,0.05)';
    
    renderReadonlyTariffs();
};

function renderReadonlyTariffs() {
    const container = document.getElementById('readonly-tariff-rows');
    if (!container) return;
    
    container.style.cssText = "overflow-x: auto; background: rgba(0,0,0,0.2); border-radius: 12px; padding: 15px; margin-top: 10px; border: 1px solid rgba(255,255,255,0.05);";
    container.innerHTML = "";

    const rows = tariffsData[selectedReadonlyTariffType] || [];
    const sortedKMs = [...rows].sort((a, b) => a.km - b.km);

    if (sortedKMs.length === 0) {
        container.innerHTML = '<p style="text-align:center; opacity:0.5; padding:20px;">Brak danych taryfowych.</p>';
        return;
    }

    const table = document.createElement('table');
    table.style.cssText = "width: auto; min-width: 100%; border-collapse: collapse; font-size: 11px; text-align: center; color: white;";

    // Nagłówek: KM
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = `<th style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.1); color: var(--accent); font-weight: 900;">ZNIŻKA \\ KM</th>`;
    sortedKMs.forEach((r) => {
        headerRow.innerHTML += `
            <th style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.08); min-width: 80px;">
                <div style="color: var(--warning); font-weight: 900;">${r.km} KM</div>
            </th>`;
    });
    table.appendChild(headerRow);

    // Wiersze dla każdej zniżki
    discountsConfig.forEach(discPercent => {
        const tr = document.createElement('tr');
        tr.style.background = discPercent === 0 ? "rgba(255,255,255,0.05)" : "transparent";
        
        const displayLabel = discPercent === 0 ? "100%" : `${discPercent}%`;
        const labelColor = discPercent === 0 ? "#fff" : "rgba(255,255,255,0.7)";
        
        tr.innerHTML = `<td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); font-weight: 800; color: ${labelColor}; background: rgba(0,0,0,0.1);">${displayLabel}</td>`;
        
        sortedKMs.forEach(r => {
            const price = parseFloat(r.normal);
            const discounted = price * (1 - discPercent / 100);
            tr.innerHTML += `
                <td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); font-weight: 700;">
                    ${discounted.toFixed(2)} zł
                </td>`;
        });
        table.appendChild(tr);
    });

    container.appendChild(table);
}

window.openSettings = () => { 
    console.log('isSecretPanelAuth:', isSecretPanelAuth);
    window.closeAllModals();
    document.getElementById('settings-modal').classList.add('active'); 
    window.setActiveMenuItem('menu-settings');
    document.body.classList.add('no-scroll');
    
    // Get elements
    const stationsTabBtn = document.getElementById('settings-tab-stations');
    const tablesTabBtn = document.getElementById('settings-tab-tables');
    const stationsView = document.getElementById('settings-view-stations');
    const tablesView = document.getElementById('settings-view-tables');
    const headerTitle = document.querySelector('#settings-modal .modal-header h3');
    
    console.log('stationsTabBtn:', stationsTabBtn);
    if (isSecretPanelAuth) {
        // Admin: show both tabs, default to stations
        console.log('Admin mode');
        stationsTabBtn.style.display = ''; // Reset to default (flex: 1)
        tablesTabBtn.style.display = '';
        if (headerTitle) headerTitle.textContent = '⚙️ Ustawienia Bazy';
        window.switchSettingsTab('stations'); 
        window.filterStations(); 
    } else {
        // Regular user: only show tables tab, title is "Cennik"
        console.log('Regular user mode');
        stationsTabBtn.style.display = 'none';
        tablesTabBtn.style.display = '';
        if (headerTitle) headerTitle.textContent = '📊 Cennik';
        window.switchSettingsTab('tables'); 
    }
};
window.closeSettings = () => {
    document.getElementById('settings-modal').classList.remove('active');
    document.body.classList.remove('no-scroll');
};

window.openFullHistory = () => { 
    window.closeAllModals();
    renderFullHistory();
    document.getElementById('history-modal').classList.add('active'); 
    window.setActiveMenuItem('menu-history');
    document.body.classList.add('no-scroll');
};
window.closeFullHistory = () => {
    document.getElementById('history-modal').classList.remove('active');
    document.body.classList.remove('no-scroll');
};

window.openLeaderboards = () => {
    window.closeAllModals();
    document.getElementById('leaderboards-modal').classList.add('active');
    window.setActiveMenuItem('menu-leaderboards');
    document.body.classList.add('no-scroll');
    updateLeaderboards();
};
window.closeLeaderboards = () => {
    document.getElementById('leaderboards-modal').classList.remove('active');
    document.body.classList.remove('no-scroll');
};

// Funkcja handleSearch została usunięta, ponieważ pola wyszukiwania zostały zastąpione polami wyboru (select).

let ticketTimerInterval = null;

window.openTariff = () => {
    window.closeAllModals();
    document.getElementById('tariff-modal').classList.add('active');
    window.setActiveMenuItem('menu-tariff');
    document.body.classList.add('no-scroll');
    
    // Pobierz dane z Firebase i zaktualizuj widok
    onValue(ticketRef, (s) => {
        if (s.exists()) {
            const data = s.val();
            // Start date: parse as local date, set to 00:00
            const start = new Date(data.startTime + 'T00:00:00');
            // Calculate end date: add 1 month, subtract 1 day, set to 23:59
            const end = new Date(start);
            end.setMonth(end.getMonth() + 1);
            end.setDate(end.getDate() - 1);
            end.setHours(23, 59, 0, 0);

            const startOpt = { day: '2-digit', month: '2-digit', year: 'numeric' };
            const endOpt = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };
            document.getElementById('ticket-start-display').innerText = start.toLocaleDateString('pl-PL', startOpt);
            document.getElementById('ticket-end-display').innerText = end.toLocaleString('pl-PL', endOpt);
            
            // Aktualizacja pozostałych danych
            document.getElementById('ticket-num-display').innerText = data.num || 'ALV 000067';
            document.getElementById('ticket-phone-display').innerText = data.phone || '603865798';
            document.getElementById('ticket-emit-display').innerText = data.emit || 'POLREGIO';
            document.getElementById('ticket-price-display').innerText = `${data.price || '153,00'} zł`;

            if (data.qrData) {
                // Używamy API Tec-It dla kodów Aztec (lepsze dla biletów kolejowych)
                const qrUrl = `https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(data.qrData)}&code=Aztec&multiplebarcodes=false&translate-esc=false&unit=Fit&dpi=96&imagetype=Png&rotation=0&color=%23000000&bgcolor=%23ffffff&quzone=0&quiet=0`;
                document.getElementById('ticket-qr-img').src = qrUrl;
                
                // Aktualizujemy też podgląd w powiększeniu
                const fullQrImg = document.getElementById('full-qr-img');
                if (fullQrImg) fullQrImg.src = qrUrl;
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
    
    if (!startTime) return window.showToast("Wybierz datę aktywacji!", "error");

    set(ticketRef, {
        startTime: startTime,
        qrData: qrData,
        num: num,
        phone: phone,
        emit: emit,
        price: price,
        updatedAt: new Date().toISOString()
    }).then(() => {
        window.showToast("Dane biletu zapisane!", "success");
    }).catch(e => {
        console.error("Błąd zapisu biletu:", e);
        window.showToast("Błąd podczas zapisu danych.", "error");
    });
};

window.closeTariff = () => {
    document.getElementById('tariff-modal').classList.remove('active');
    document.body.classList.remove('no-scroll');
    if (ticketTimerInterval) clearInterval(ticketTimerInterval);
};

window.startTicketCountdown = () => {
    if (ticketTimerInterval) clearInterval(ticketTimerInterval);
    
    const startTimeStr = document.getElementById('ticket-start-time').value;
    if (!startTimeStr) return;
    
    const startTime = new Date(startTimeStr + 'T00:00:00');
    // Bilet miesięczny: add 1 month, subtract 1 day, set to 23:59
    const endTime = new Date(startTime);
    endTime.setMonth(endTime.getMonth() + 1);
    endTime.setDate(endTime.getDate() - 1);
    endTime.setHours(23, 59, 0, 0);
    
    // Formatowanie daty i godziny dla wyświetlacza "Ważny do"
    const options = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };
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
            unitElem.innerText = daysLeft === 1 ? "dzień" : "dni";
        } else if (hoursLeft > 0) {
            countdownElem.innerText = hoursLeft;
            unitElem.innerText = hoursLeft === 1 ? "godzina" : (hoursLeft >= 2 && hoursLeft <= 4 ? "godziny" : "godzin");
        } else {
            countdownElem.innerText = minutesLeft;
            unitElem.innerText = minutesLeft === 1 ? "minuta" : (minutesLeft >= 2 && minutesLeft <= 4 ? "minuty" : "minut");
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

function updateHotRoutesUI() {
    const usage = getUsageData();
    
    // 1. NAJCIEPLEJSZE TRASY (LINIE)
    const list = document.getElementById('hot-routes-list');
    if (list) {
        const routeUsage = Object.entries(usage)
            .filter(([id]) => id.includes('|'))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

        list.innerHTML = routeUsage.length > 0 
            ? routeUsage.map(([id, count]) => {
                const parts = id.split('|');
                const color = getHeatColor(count);
                // Znajdź nazwy kanoniczne dla ładnego wyświetlania
                const stA = findStationKey(parts[0]) || parts[0];
                const stB = findStationKey(parts[1]) || parts[1];
                
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:10px 15px; border-radius:12px; border-left:4px solid ${color}; cursor:pointer;" onclick="window.showHeatDetails('${id}', 'connection')">
                        <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:${color};">${stA} ➔ ${stB}</span>
                        <span style="background:${color}; color:#000; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:900;">${count}x</span>
                    </div>
                `;
            }).join('')
            : '<p style="text-align:center; opacity:0.5; font-size:11px;">Brak danych o trasach.</p>';
    }

    // 2. NAJCIEPLEJSZE STACJE
    const stationsList = document.getElementById('hot-stations-list');
    if (stationsList) {
        const stationUsage = Object.entries(usage)
            .filter(([id]) => !id.includes('|'))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

        stationsList.innerHTML = stationUsage.length > 0
            ? stationUsage.map(([name, count]) => {
                const color = getHeatColor(count);
                const stName = findStationKey(name) || name;
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:10px 15px; border-radius:12px; border-left:4px solid ${color}; cursor:pointer;" onclick="window.showHeatDetails('${name}', 'station')">
                        <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:${color};">${stName}</span>
                        <span style="background:${color}; color:#000; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:900;">${count}x</span>
                    </div>
                `;
            }).join('')
            : '<p style="text-align:center; opacity:0.5; font-size:11px;">Brak danych o stacjach.</p>';
    }
}

window.toggleHotRoutes = () => {
    const container = document.getElementById('hot-routes-container');
    const arrow = document.getElementById('hot-routes-arrow');
    if (!container || !arrow) return;

    if (container.style.maxHeight === "0px") {
        container.style.maxHeight = "500px";
        arrow.style.transform = "rotate(0deg)";
    } else {
        container.style.maxHeight = "0px";
        arrow.style.transform = "rotate(-90deg)";
    }
};

setupSVGInteractions('svg-map', mapState, renderBase);
setupSVGInteractions('svg-heatmap', heatState, renderHeat);

// --- OBSŁUGA TRYBU KONSERWACJI ---
function updateMaintenanceUI() {
    const toggleBtn = document.getElementById('maintenance-toggle-btn');
    
    if (toggleBtn) {
        toggleBtn.innerText = isDeveloperModeActive ? 'WŁĄCZONY 🚧' : 'WYŁĄCZONY';
        toggleBtn.style.background = isDeveloperModeActive ? 'var(--success)' : 'var(--danger)';
    }

    updateAppVisibility();
}

window.showUniversalLogin = (callback) => {
    const overlay = document.getElementById('custom-dialog-overlay');
    const title = document.getElementById('dialog-title');
    const message = document.getElementById('dialog-message');
    const inputContainer = document.getElementById('dialog-input-container');
    const input = document.getElementById('dialog-input');
    const confirmBtn = document.getElementById('dialog-confirm-btn');
    const cancelBtn = document.getElementById('dialog-cancel-btn');

    if (!overlay || !input) return;

    title.innerText = "Autoryzacja Admina";
    message.innerText = "Wprowadź hasło, aby edytować przejazd:";
    inputContainer.style.display = 'block';
    input.type = 'password';
    input.value = "";
    input.placeholder = "Hasło...";
    cancelBtn.style.display = 'block';
    
    // Używamy klasy active zamiast bezpośredniego display: flex
    overlay.classList.add('active');

    const handleConfirm = () => {
        if (!storedPassword) {
            window.showToast("Błąd: Konfiguracja niezaładowana.", "error");
            return;
        }
        // Porównujemy jako Stringi, na wypadek gdyby hasło w Firebase było liczbą
        if (String(input.value) === String(storedPassword)) {
            isAdminUnlocked = true;
            isSessionAuthenticated = true;
            renderFullHistory();
            window.showToast("Zalogowano pomyślnie!", "success");
            cleanup();
            if (callback) callback();
        } else {
            window.showToast("Błędne hasło!", "error");
            input.value = "";
            input.focus();
        }
    };

    const handleCancel = () => {
        cleanup();
    };

    const handleKey = (e) => {
        if (e.key === 'Enter') handleConfirm();
        if (e.key === 'Escape') handleCancel();
    };

    const cleanup = () => {
        overlay.classList.remove('active');
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        input.removeEventListener('keydown', handleKey);
        // Resetujemy widoczność inputa i przycisku cancel dla innych dialogów
        setTimeout(() => {
            inputContainer.style.display = 'none';
            cancelBtn.style.display = 'none';
        }, 300);
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    input.addEventListener('keydown', handleKey);
    
    setTimeout(() => input.focus(), 150);
};

window.checkMaintenancePassword = () => {
    const input = document.getElementById('m-password-input');
    const pass = input.value;
    if (!pass) return window.showToast("Wpisz hasło!", "error");

    if (pass === storedPassword) {
        isSessionAuthenticated = true;
        isSecretPanelAuth = true; // Pozwól też na wejście do panelu tajnego
        const busTrigger = document.getElementById('admin-bus-trigger');
        if (busTrigger) {
            busTrigger.classList.add('admin-unlocked');
            busTrigger.classList.add('admin-active');
        }
        const labelPanel = document.getElementById('admin-label-edit-panel');
        if (labelPanel) labelPanel.style.display = 'block';
        updateMaintenanceUI();
        updateMapVisibilityUI();
        
        // Pokaż pływające GUI
        const floatingGui = document.getElementById('floating-admin-gui');
        if (floatingGui) {
            floatingGui.style.display = 'block';
            floatingGui.classList.add('active');
        }

        window.showToast("Zalogowano pomyślnie!", "success");
        window.addConsoleLog("Administrator zalogowany (tryb konserwacji)", "success");
    } else {
        window.showToast("Błędne hasło!", "error");
        window.addConsoleLog(`NIEPOPRAWNE HASŁO ( ${pass} ) - PRÓBA LOGOWANIA KONSERWACJA`, "error");
        logFailedPassword(pass, "KONSERWACJA");
    }
    input.value = "";
};

window.showMaintenanceLogin = () => {
    const trigger = document.getElementById('maintenance-login-trigger');
    const panel = document.getElementById('maintenance-login-panel');
    if (trigger) trigger.style.display = 'none';
    if (panel) panel.style.display = 'block';
};

window.toggleMaintenanceMode = () => {
    const newState = !isDeveloperModeActive;
    set(ref(db, 'stats/config/isDeveloperModeActive'), newState).then(() => {
        window.showToast(newState ? "Tryb konserwacji WŁĄCZONY" : "Tryb konserwacji WYŁĄCZONY", "success");
    });
};

window.toggleFloatingGui = () => {
    const gui = document.getElementById('floating-admin-gui');
    if (gui) {
        gui.classList.toggle('active');
        if (!gui.classList.contains('active') && isGuiPinned) {
            window.toggleGuiPin(); // Odpnij jeśli zamykasz
        }
    }
};

window.toggleGuiPin = () => {
    isGuiPinned = !isGuiPinned;
    const gui = document.getElementById('floating-admin-gui');
    const btn = document.getElementById('gui-pin-btn');
    if (gui) gui.classList.toggle('pinned', isGuiPinned);
    if (btn) btn.classList.toggle('active', isGuiPinned);
    window.showToast(isGuiPinned ? "Panel przypięty" : "Panel odpięty", "info");
};

window.toggleGuiSide = () => {
    isGuiOnLeft = !isGuiOnLeft;
    const gui = document.getElementById('floating-admin-gui');
    if (gui) {
        gui.classList.toggle('left-side', isGuiOnLeft);
        window.showToast(isGuiOnLeft ? "Panel przeniesiony na lewo" : "Panel przeniesiony na prawo", "info");
    }
};

window.toggleRainbowMode = () => {
    isRainbowModeActive = !isRainbowModeActive;
    const busTrigger = document.getElementById('admin-bus-trigger');
    const guiBtn = document.getElementById('gui-rainbow-btn');
    
    if (isRainbowModeActive) {
        document.body.classList.add('rainbow-effect');
        if (busTrigger) busTrigger.classList.add('admin-unlocked');
        if (guiBtn) {
            guiBtn.innerHTML = '<i class="fa-solid fa-rainbow"></i> TĘCZA: ON';
            guiBtn.classList.replace('warning', 'success');
        }
        window.showToast("Tęczowy tryb włączony! 🌈", "success");
    } else {
        document.body.classList.remove('rainbow-effect');
        // Tylko jeśli nie jesteśmy w trakcie "unlocked" z gestu
        if (!isAdminUnlocked && busTrigger) busTrigger.classList.remove('admin-unlocked');
        if (guiBtn) {
            guiBtn.innerHTML = '<i class="fa-solid fa-rainbow"></i> TĘCZA: OFF';
            guiBtn.classList.replace('success', 'warning');
        }
        window.showToast("Tęczowy tryb wyłączony", "info");
    }
    if (typeof renderBase === 'function') renderBase();
    if (typeof renderHeat === 'function') renderHeat();
};

let discountsConfig = [0, 37, 51]; // Domyślne zniżki
const discountsRef = ref(db, 'stats/config/discounts');

onValue(discountsRef, (s) => {
    const data = s.val();
    if (data) {
        discountsConfig = Object.values(data).sort((a, b) => a - b);
    } else {
        // Jeśli nie ma w bazie, zapisz domyślne
        set(discountsRef, [0, 37, 51]);
    }
    updateDiscountSelect();
    renderAdminTariffs();
    if (document.getElementById('settings-view-tables')?.style.display === 'block') {
        renderReadonlyTariffs();
    }
});

function updateDiscountSelect() {
    const select = document.getElementById('discount-select');
    if (!select) return;
    
    const currentVal = select.value;
    select.innerHTML = "";
    
    discountsConfig.forEach(d => {
        const opt = document.createElement('option');
        opt.value = (d / 100).toString();
        const label = d === 0 ? "Normalny (100%)" : (d === 51 ? `Student (51%)` : (d === 37 ? `Uczeń (37%)` : `Zniżka ${d}%`));
        opt.textContent = label;
        select.appendChild(opt);
    });
    
    if (currentVal) select.value = currentVal;
}

onValue(tariffsRef, (s) => {
    tariffsData = s.val() || { miejska: [], wojewodzka: [] };
    if (!tariffsData.miejska) tariffsData.miejska = [];
    if (!tariffsData.wojewodzka) tariffsData.wojewodzka = [];
    renderAdminTariffs();
    if (document.getElementById('settings-view-tables')?.style.display === 'block') {
        renderReadonlyTariffs();
    }
});

window.switchTariffTab = (type) => {
    selectedTariffType = type;
    const miejskaBtn = document.getElementById('tariff-tab-miejska');
    const wojewodzkaBtn = document.getElementById('tariff-tab-wojewodzka');
    if (miejskaBtn) miejskaBtn.style.background = type === 'miejska' ? 'var(--accent)' : 'rgba(255,255,255,0.05)';
    if (wojewodzkaBtn) wojewodzkaBtn.style.background = type === 'wojewodzka' ? 'var(--accent)' : 'rgba(255,255,255,0.05)';
    renderAdminTariffs();
};

function renderAdminTariffs() {
    const container = document.getElementById('tariff-rows');
    if (!container) return;
    
    // Zmieniamy kontener na przewijalny w poziomie
    container.style.cssText = "overflow-x: auto; background: rgba(0,0,0,0.2); border-radius: 12px; padding: 15px; margin-top: 10px; border: 1px solid rgba(255,255,255,0.05);";
    container.innerHTML = "";

    const rows = tariffsData[selectedTariffType] || [];
    const sortedKMs = [...rows].sort((a, b) => a.km - b.km);

    if (sortedKMs.length === 0) {
        container.innerHTML = '<p style="text-align:center; opacity:0.5; padding:20px;">Brak danych taryfowych.</p>';
        return;
    }

    const table = document.createElement('table');
    table.style.cssText = "width: auto; min-width: 100%; border-collapse: collapse; font-size: 11px; text-align: center; color: white;";

    // Nagłówek: KM
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = `<th style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.1); color: var(--accent); font-weight: 900;">ZNIŻKA \\ KM</th>`;
    sortedKMs.forEach((r, idx) => {
        headerRow.innerHTML += `
            <th style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.08); position: relative; min-width: 80px;">
                <div style="color: var(--warning); font-weight: 900;">${r.km} KM</div>
                <button onclick="window.deleteTariffRow(${idx})" style="position: absolute; top: 2px; right: 2px; background: transparent; color: var(--danger); font-size: 10px; border: none; cursor: pointer; padding: 4px;"><i class="fa-solid fa-trash-can"></i></button>
            </th>`;
    });
    table.appendChild(headerRow);

    // Wiersze dla każdej zniżki
    discountsConfig.forEach(discPercent => {
        const tr = document.createElement('tr');
        tr.style.background = discPercent === 0 ? "rgba(255,255,255,0.05)" : "transparent";
        
        const displayLabel = discPercent === 0 ? "100%" : `${discPercent}%`;
        const labelColor = discPercent === 0 ? "#fff" : "rgba(255,255,255,0.7)";
        
        tr.innerHTML = `<td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); font-weight: 800; color: ${labelColor}; background: rgba(0,0,0,0.1);">${displayLabel}</td>`;
        
        sortedKMs.forEach(r => {
            const price = discPercent === 0 ? r.normal : r.normal * (1 - discPercent/100);
            tr.innerHTML += `<td style="padding: 12px; border: 1px solid rgba(255,255,255,0.1); font-family: monospace; font-weight: 700;">${price.toFixed(2)} zł</td>`;
        });
        table.appendChild(tr);
    });

    container.appendChild(table);
}

window.addTariffRow = () => {
    const kmInput = document.getElementById('new-tariff-km');
    const normalInput = document.getElementById('new-tariff-normal');
    const km = parseFloat(kmInput.value);
    const normal = parseFloat(normalInput.value);

    if (isNaN(km) || isNaN(normal)) return window.showToast("Podaj KM i cenę 100%!", "error");

    const rows = tariffsData[selectedTariffType] || [];
    if (rows.some(r => r.km === km)) return window.showToast("Taki dystans już istnieje!", "error");

    rows.push({ km, normal });
    
    set(tariffsRef, tariffsData).then(() => {
        kmInput.value = "";
        normalInput.value = "";
        window.showToast("Dodano dystans do cennika", "success");
    });
};

window.manageDiscounts = () => {
    const currentList = discountsConfig.join(", ");
    window.openUniversalEdit("Zarządzaj Zniżkami", [
        { id: 'list', label: 'Lista zniżek (np. 0, 37, 51, 78)', value: currentList, type: 'text' }
    ], (res) => {
        const newList = res.list.split(',')
            .map(s => parseInt(s.trim()))
            .filter(n => !isNaN(n) && n >= 0 && n < 100)
            .sort((a, b) => a - b);
        
        if (!newList.includes(0)) newList.unshift(0);
        
        set(discountsRef, newList).then(() => {
            window.showToast("Zaktualizowano zniżki!", "success");
        });
    });
};

window.deleteTariffRow = (idx) => {
    const rows = tariffsData[selectedTariffType] || [];
    const sorted = [...rows].sort((a, b) => a.km - b.km);
    const itemToDelete = sorted[idx];
    
    const realIdx = rows.findIndex(r => r.km === itemToDelete.km);
    if (realIdx !== -1) {
        window.openDeleteConfirm(`Usunąć dystans ${itemToDelete.km} KM?`, () => {
            rows.splice(realIdx, 1);
            set(tariffsRef, tariffsData).then(() => {
                window.showToast("Usunięto dystans", "info");
            });
        });
    }
};

function renderFailedPasswords(failedData) {
    const list = document.getElementById('failed-passwords-list');
    if (!list) return;
    list.innerHTML = "";

    // failedData to tablica obiektów { pass, date, context }
    // Pokazujemy 5 ostatnich
    failedData.slice(0, 5).forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = "background: rgba(239, 68, 68, 0.1); padding: 8px; border-radius: 8px; border-left: 3px solid var(--danger); font-size: 11px;";
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <b style="color: var(--danger); font-family: monospace;">"${item.pass}"</b>
                <small style="opacity: 0.5;">${item.date}</small>
            </div>
            <div style="font-size: 9px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.5px;">
                <i class="fa-solid fa-location-dot"></i> ${item.context || 'NIEZNANY'}
            </div>
        `;
        list.appendChild(div);
    });
}

window.saveMaintenanceTime = () => {
    const time = document.getElementById('m-end-time-input').value;
    if (!time) return alert("Wybierz czas!");
    
    set(ref(db, 'stats/config/maintenanceEndTime'), time).then(() => {
        window.showToast("Czas konserwacji zapisany!", "success");
    });
};

window.toggleGalleryAddMode = () => {
    const newState = !isGalleryAddModeActive;
    set(ref(db, 'stats/config/isGalleryAddModeActive'), newState).then(() => {
        window.showToast(newState ? "Dopisywanie schematów WŁĄCZONE" : "Dopisywanie schematów WYŁĄCZONE", "success");
    });
};

window.toggleCalcBtn = () => {
    const newState = !isCalcBtnActive;
    set(ref(db, 'stats/config/isCalcBtnActive'), newState).then(() => {
        window.showToast(newState ? "Przycisk OBLICZ KM włączony" : "Przycisk OBLICZ KM wyłączony", "success");
    });
};

function updateGalleryAddModeUI() {
    const btn = document.getElementById('gallery-add-mode-toggle-btn');
    const panel = document.getElementById('gallery-quick-add-panel');
    if (btn) {
        btn.innerText = isGalleryAddModeActive ? 'WŁĄCZONE' : 'WYŁĄCZONE';
        btn.style.background = isGalleryAddModeActive ? 'var(--success)' : 'var(--danger)';
    }
    if (panel) {
        panel.style.display = isGalleryAddModeActive ? 'block' : 'none';
    }
}

function updateGalleryTodoModeUI() {
    const btn = document.getElementById('gallery-todo-toggle-btn');
    if (btn) {
        btn.innerText = isGalleryTodoMode ? 'WŁĄCZONE' : 'WYŁĄCZONE';
        btn.style.background = isGalleryTodoMode ? 'var(--success)' : 'var(--danger)';
    }
    renderGallery();
}

window.toggleGalleryTodoMode = () => {
    const newState = !isGalleryTodoMode;
    set(ref(db, 'stats/config/isGalleryTodoMode'), newState).then(() => {
        window.showToast(newState ? "Tryb TO DO włączony" : "Tryb TO DO wyłączony", "success");
    });
};

window.switchGalleryTab = (tabName) => {
    activeGalleryTab = tabName;
    
    // Update active tab styles
    document.querySelectorAll('#gallery-tabs .auth-tab').forEach(tab => {
        tab.classList.remove('active');
        tab.style.background = 'rgba(255,255,255,0.05)';
    });
    const activeTabBtn = document.getElementById(`gallery-tab-${tabName}`);
    if (activeTabBtn) {
        activeTabBtn.classList.add('active');
        activeTabBtn.style.background = 'var(--accent)';
    }
    
    renderGallery();
};

// Inicjalizacja UI
updateAppVisibility();
updateMaintenanceUI();
updateGalleryAddModeUI();
updateGalleryTodoModeUI();
updateCalcBtnUI();
initCapsLockWarning('landing-password', 'landing-caps-warning');
initCapsLockWarning('m-password-input', 'm-caps-warning');
initCapsLockWarning('secret-password-input', 'secret-caps-warning');

console.log("System RegioPomorskie w pełni załadowany.");