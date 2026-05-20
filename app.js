import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import PhotoSwipeLightbox from 'https://unpkg.com/photoswipe@5.4.3/dist/photoswipe-lightbox.esm.js';

// --- KONFIGURACJA ---
const startTime = performance.now();

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

// --- LOGOWANIE DO TAJNEJ KONSOLI ---
const originalLog = console.log;
const originalError = console.error;
const secretConsole = () => document.getElementById('secret-console');

const errorBook = {
    "36": "Nieoczekiwany błąd systemu (Generic Error)",
    "01": "Błąd połączenia z bazą Firebase",
    "02": "Nieprawidłowe hasło administratora",
    "03": "Stacja nie została znaleziona w bazie",
    "04": "Błąd podczas zapisu danych (Permission Denied)",
    "05": "Przekroczono limit zapytań API",
    "10": "Błąd skalowania mapy - nieprawidłowe wymiary",
    "15": "Błąd PhotoSwipe - nie można załadować obrazu"
};

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
    originalError(`( KOD BŁĘDU ${errorCode} skontaktuj sie z administratorem )`);
    
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

const statsRef = ref(db, 'stats/oszczednosci');
const tripsRef = ref(db, 'stats/przejazdy');
const stationsRef = ref(db, 'stats/stacje_siec');
const schematyRef = ref(db, 'stats/schematy');
const ticketRef = ref(db, 'stats/bilet_miesieczny');
const configRef = ref(db, 'stats/config');
const visitedCitiesRef = ref(db, 'stats/visited_cities');

let earnedSoFar = 0;
let stations = {};
let tripsData = [];
let galleryData = [];
let visitedCitiesData = {};
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
let gridActive = false;
let busClicks = 0;
let isAdminUnlocked = false;
let storedPassword = null;
let isDeveloperModeActive = false;
let maintenanceEndTime = null;
let maintenanceInterval = null;
let stationEditorBg = null;
let tempMarker = null;
let isMapVisible = true;
let showEditorBg = true;
let globalPinSize = 6;
let isCalcDisabled = false;
let calcDisabledMsg = "Funkcja tymczasowo niedostępna.";
let mapBgSettings = { w: 1200, h: 1800, offX: 0, offY: 0 };
let loadTimeValue = 0;
let systemStatus = "online";

window.updatePinSize = (val) => {
    globalPinSize = parseFloat(val);
    set(ref(db, 'stats/config/globalPinSize'), globalPinSize);
    renderBase();
    renderHeat();
};

window.centerHeatmap = () => {
    const svg = document.getElementById('svg-heatmap');
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
    heatState.scale = scale;

    // Aktualizuj suwak
    const slider = document.getElementById('heat-zoom-slider');
    if (slider) {
        slider.value = scale;
        slider.min = Math.min(0.05, scale / 5);
        slider.max = Math.max(5, scale * 5);
    }

    // Wyśrodkuj na ŚRODEK obrazu
    heatState.x = w/2 - (offX + bgW/2) * scale;
    heatState.y = h/2 - (offY + bgH/2) * scale;
    
    renderHeat();
    window.showToast("Heatmapa wycentrowana na środek", "success");
};

window.updateStationEditorBg = (url) => {
    stationEditorBg = url;
    set(ref(db, 'stats/config/stationEditorBg'), url);
    renderBase();
};

window.toggleMapVisibility = () => {
    const newState = !isMapVisible;
    set(ref(db, 'stats/config/isMapVisible'), newState).then(() => {
        window.showToast(newState ? "Mapa jest teraz widoczna" : "Mapa została ukryta", "success");
    });
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

function renderAdminCities() {
    const container = document.getElementById('admin-cities-list');
    if (!container) return;
    container.innerHTML = "";

    Object.entries(visitedCitiesData).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px; border-radius:10px; font-size:12px; border-left: 3px solid #38bdf8; cursor: pointer; margin-bottom: 5px;";
        div.innerHTML = `
            <div style="flex-grow: 1;" onclick="window.editCity('${name}', ${count})">
                <b>${name}</b><br>
                <small style="opacity:0.7">Wizyty: ${count}</small>
            </div>
            <div style="display: flex; gap: 5px; align-items: center;">
                <button onclick="event.stopPropagation(); window.decrementCityVisit('${name}', ${count})" style="width: 32px; height: 32px; padding: 0; background: var(--danger); font-size: 14px; border-radius: 8px;"><i class="fa-solid fa-minus"></i></button>
                <button onclick="event.stopPropagation(); window.incrementCityVisit('${name}', ${count})" style="width: 32px; height: 32px; padding: 0; background: var(--success); font-size: 14px; border-radius: 8px;"><i class="fa-solid fa-plus"></i></button>
                <i class="fa-solid fa-ellipsis-vertical" style="padding: 10px; opacity: 0.5;" onclick="event.stopPropagation(); window.showActionMenu(event, [
                    { label: 'Edytuj miasto', icon: 'fa-pen', onClick: () => window.editCity('${name}', ${count}) },
                    { label: 'Usuń miasto', icon: 'fa-trash', type: 'danger', onClick: () => window.deleteCity('${name}') }
                ])"></i>
            </div>
        `;
        container.appendChild(div);
    });
}

window.incrementCityVisit = (name, currentCount) => {
    set(ref(db, `stats/visited_cities/${name}`), currentCount + 1).then(() => {
        window.showToast(`Zwiększono wizyty w ${name}`, "success");
    });
};

window.decrementCityVisit = (name, currentCount) => {
    if (currentCount <= 0) return;
    set(ref(db, `stats/visited_cities/${name}`), currentCount - 1).then(() => {
        window.showToast(`Zmniejszono wizyty w ${name}`, "success");
    });
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
let heatState = { x: 0, y: 0, scale: 0.33 };

// Taryfa 2026
const taryfa = [
    {max: 6, cena: 7.00}, {max: 12, cena: 8.00}, {max: 18, cena: 9.00},
    {max: 24, cena: 11.00}, {max: 30, cena: 12.00}, {max: 40, cena: 14.00},
    {max: 50, cena: 16.00}, {max: 60, cena: 18.00}, {max: 70, cena: 20.00},
    {max: 80, cena: 22.00}, {max: 90, cena: 24.00}, {max: 100, cena: 26.00}
];

// --- CUSTOM GUI DIALOG SYSTEM (Non-Native) ---
window.openUniversalEdit = (title, fields, onSave) => {
    const modal = document.getElementById('universal-edit-modal');
    const titleElem = document.getElementById('edit-modal-title');
    const fieldsContainer = document.getElementById('edit-modal-fields');
    const saveBtn = document.getElementById('edit-modal-save-btn');

    titleElem.innerText = title;
    fieldsContainer.innerHTML = "";
    
    const inputs = {};

    fields.forEach(field => {
        const wrap = document.createElement('div');
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "5px";
        
        const label = document.createElement('label');
        label.innerText = field.label;
        label.style.fontSize = "12px";
        label.style.opacity = "0.7";
        
        let input;
        if (field.type === 'select') {
            input = document.createElement('select');
            field.options.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.value;
                o.innerText = opt.label;
                if (opt.value === field.value) o.selected = true;
                input.appendChild(o);
            });
        } else {
            input = document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
            input.type = field.type || 'text';
            input.value = field.value || "";
        }
        input.placeholder = field.placeholder || "";
        input.style.width = "100%";
        
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
            results[id] = inputs[id].value;
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

window.openDeleteConfirm = (details, onConfirm) => {
    const modal = document.getElementById('delete-confirm-modal');
    const detailsElem = document.getElementById('delete-confirm-details');
    const yesBtn = document.getElementById('delete-confirm-yes');

    detailsElem.innerText = details;
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

onValue(configRef, (s) => { 
    if (s.exists()) {
        const config = s.val();
        storedPassword = config.password;
        maintenanceEndTime = config.maintenanceEndTime || null;
        stationEditorBg = config.stationEditorBg || null;
        isMapVisible = config.isMapVisible !== undefined ? config.isMapVisible : true;
        showEditorBg = config.showEditorBg !== undefined ? config.showEditorBg : true;
        isCalcDisabled = config.isCalcDisabled || false;
        calcDisabledMsg = config.calcDisabledMsg || "Funkcja tymczasowo niedostępna.";
        mapBgSettings = config.mapBgSettings || { w: 1200, h: 1800, offX: 0, offY: 0 };
        systemStatus = config.systemStatus || "online";
        isDeveloperModeActive = config.isDeveloperModeActive || false;
        
        if (config.globalPinSize !== undefined) {
            globalPinSize = config.globalPinSize;
            // Aktualizuj suwaki w UI
            document.querySelectorAll('input[type="range"][oninput*="updatePinSize"]').forEach(input => {
                input.value = globalPinSize;
            });
        }

        // Aktualizuj input w adminie jeśli istnieje
        const bgInput = document.getElementById('station-editor-bg');
        if (bgInput) bgInput.value = stationEditorBg || "";

        updateMaintenanceUI();
        updateMapVisibilityUI();
        updateCalcBtnUI();
        updateAdminPanelFields();
        updateSystemStatusUI();
        renderBase(); // Odśwież mapę z nowym tłem jeśli trzeba
        window.addConsoleLog("Konfiguracja Firebase załadowana", "success");
        inputFrom.addEventListener('input', renderMainHistoryList);
        inputTo.addEventListener('input', renderMainHistoryList);
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

function updateAdminPanelFields() {
    // Status Systemu
    const statusSelect = document.getElementById('admin-system-status');
    if (statusSelect) statusSelect.value = systemStatus;

    // Blokada KM
    const lockBtn = document.getElementById('calc-lock-toggle-btn');
    if (lockBtn) {
        lockBtn.innerText = isCalcDisabled ? "WŁĄCZONA" : "WYŁĄCZONA";
        lockBtn.style.background = isCalcDisabled ? "var(--success)" : "var(--danger)";
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
}

function updateCalcBtnUI() {
    const btn = document.getElementById('calc-km-btn');
    if (!btn) return;

    if (isCalcDisabled) {
        btn.classList.add('calc-disabled');
        btn.innerHTML = `<span style="text-decoration: line-through; color: var(--danger);">🧮 OBLICZ KM</span>`;
        btn.style.background = "#475569";
        btn.style.cursor = "pointer";
    } else {
        btn.classList.remove('calc-disabled');
        btn.innerHTML = "🧮 OBLICZ KM";
        btn.style.background = "var(--accent)";
        btn.style.cursor = "pointer";
    }
}

window.toggleCalcLock = () => {
    const newState = !isCalcDisabled;
    set(ref(db, 'stats/config/isCalcDisabled'), newState).then(() => {
        window.showToast(newState ? "Blokada KM włączona" : "Blokada KM wyłączona", "success");
    });
};

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
        { id: 'name', label: 'Nazwa stacji (klucz)', value: key.toUpperCase() },
        { id: 'km', label: 'Kilometry (KM)', value: oldData.km, type: 'number' },
        { id: 'x', label: 'Pozycja X', value: oldData.x, type: 'number' },
        { id: 'y', label: 'Pozycja Y', value: oldData.y, type: 'number' },
        { id: 'labelPos', label: 'Pozycja nazwy', value: oldData.labelPos || 'right', type: 'select', options: labelOptions },
        { id: 'parent', label: 'Stacja nadrzędna', value: oldData.parent || "" }
    ], (res) => {
        const newName = res.name.toLowerCase().trim();
        const updatedData = {
            ...oldData,
            km: parseFloat(res.km) || 0,
            x: parseInt(res.x) || 0,
            y: parseInt(res.y) || 0,
            labelPos: res.labelPos,
            parent: res.parent ? res.parent.toLowerCase().trim() : null
        };

        set(ref(db, `stats/stacje_siec/${newName}`), updatedData).then(() => {
            if (newName !== key.toLowerCase().trim()) {
                remove(ref(db, `stats/stacje_siec/${key}`));
                Object.keys(stations).forEach(sKey => {
                    if (stations[sKey].parent === key.toLowerCase().trim()) {
                        set(ref(db, `stats/stacje_siec/${sKey}/parent`), newName);
                    }
                });
            }
            window.showToast("Stacja zaktualizowana!", "success");
        });
    });
};

window.deleteStation = (key) => {
    window.openDeleteConfirm(`To trwale usunie stację ${key.toUpperCase()} z bazy danych.`, () => {
        remove(ref(db, `stats/stacje_siec/${key}`)).then(() => window.showToast("Stacja usunięta.", "success"));
    });
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
        });

        // Sortowanie według pola 'order'
        galleryData.sort((a, b) => (a.order || 0) - (b.order || 0));

        galleryData.forEach((item, idx) => {
            const key = item.key;
            
            // 1. Widok dla użytkownika
            const div = document.createElement('div');
            div.className = 'gallery-item';
            if (item.src) {
                const w = item.w || 1600;
                const h = item.h || 2000;

                div.innerHTML = `
                    <div style="font-weight:600; margin-bottom:10px; color:var(--accent); display:flex; justify-content:space-between; align-items:center;">
                        <span>${item.title || 'Bez tytułu'}</span>
                        <small style="opacity:0.5; font-size:10px;">${w}x${h}px</small>
                    </div>
                    <img src="${item.src}" class="schemat-thumb" 
                         onclick="window.fullView(${idx})" 
                         alt="${item.title}"
                         style="width:100%; height:auto; border-radius:12px; display:block;">
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

            // 2. Widok dla admina (do usuwania i zmiany kolejności)
            if (adminList) {
                const adminDiv = document.createElement('div');
                adminDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:10px; border-radius:10px; font-size:12px; cursor: pointer;";
                adminDiv.innerHTML = `
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${item.title}</span>
                    <i class="fa-solid fa-ellipsis-vertical" style="padding: 10px; opacity: 0.5;"></i>
                `;
                adminDiv.onclick = (e) => window.showActionMenu(e, [
                    { label: 'Przesuń w górę', icon: 'fa-arrow-up', onClick: () => window.reorderGalleryItem(key, 'up') },
                    { label: 'Przesuń w dół', icon: 'fa-arrow-down', onClick: () => window.reorderGalleryItem(key, 'down') },
                    { label: 'Edytuj element', icon: 'fa-pen', onClick: () => window.editGalleryItem(key) },
                    { label: 'Usuń element', icon: 'fa-trash', type: 'danger', onClick: () => window.deleteGalleryItem(key) }
                ]);
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
    if(s.exists()) {
        s.forEach(child => {
            const t = child.val();
            const key = child.key;
            tripsData.push({ ...t, key: key });
        });
        
        renderFullHistory();
        renderMainHistoryList();
        renderAdminTrips();
        updateLeaderboards();
    }
    updateHotRoutesUI();
});

function renderFullHistory() {
    const tableBody = document.getElementById('full-history-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = "";

    const sorted = [...tripsData].sort((a, b) => {
        let valA = a[historySortConfig.key];
        let valB = b[historySortConfig.key];

        // Specjalna obsługa daty DD.MM.RRRR
        if (historySortConfig.key === 'data') {
            const partsA = valA.split('.');
            const partsB = valB.split('.');
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
        const row = `
            <tr>
                <td>${t.data}</td>
                <td>${t.nr || '---'}</td>
                <td>${t.unit || '---'}</td>
                <td>${t.od.toUpperCase()}</td>
                <td>${t.do.toUpperCase()}</td>
                <td style="color:var(--success); font-weight:900">${parseFloat(t.zl).toFixed(2)} zł</td>
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
    const currentFrom = document.getElementById('route-from').value.toLowerCase().trim();
    const currentTo = document.getElementById('route-to').value.toLowerCase().trim();

    // Zawsze 3 najnowsze (po dacie zapisu/firebase push order)
    tripsData.slice(-3).reverse().forEach(t => {
        const tOd = t.od.toLowerCase().trim();
        const tDo = t.do.toLowerCase().trim();
        
        // Sprawdź czy trasa pasuje do obecnie wpisywanej (w obie strony)
        const isActive = (tOd === currentFrom && tDo === currentTo) || (tOd === currentTo && tDo === currentFrom);
        const activeStyle = isActive ? "border: 2px solid var(--accent); background: rgba(129, 140, 248, 0.15); box-shadow: 0 0 15px rgba(129, 140, 248, 0.2);" : "";

        const div = document.createElement('div');
        div.className = 'history-item';
        if (isActive) div.style.cssText = activeStyle;

        div.innerHTML = `
            <div style="flex: 1;">
                <b style="color:#fff">${t.nr || '---'}</b> ${t.unit ? `<small style="opacity:0.6">[${t.unit}]</small>` : ''} | <small>${t.data}</small><br>
                <span style="${isActive ? 'color: var(--accent); font-weight: 800;' : ''}">${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()}</span>
                ${t.note ? `<br><small onclick="window.showNote(\`${t.note.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\` )" style="color:var(--warning); font-style:italic; cursor: pointer; display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.note}</small>` : ''}
            </div>
            <div style="color:${isActive ? 'var(--accent)' : 'var(--success)'}; font-weight:900">+${parseFloat(t.zl).toFixed(2)} zł</div>
        `;
        list.appendChild(div);
    });
}

onValue(visitedCitiesRef, (s) => {
    visitedCitiesData = s.val() || {};
    renderAdminCities();
    updateLeaderboards();
});

function updateLeaderboards() {
    const leaderModal = document.getElementById('leaderboards-modal');
    if (!leaderModal || !leaderModal.classList.contains('active')) return;
    
    // 1. TOP UNITS
    const unitCounts = {};
    tripsData.forEach(t => {
        if (t.unit) {
            const u = t.unit.trim().toUpperCase();
            unitCounts[u] = (unitCounts[u] || 0) + 1;
        }
    });
    renderTopList('top-units-list', unitCounts, 'x');

    // 2. TOP ROUTES
    const routeCounts = {};
    tripsData.forEach(t => {
        if (t.od && t.do) {
            const r = `${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()}`;
            routeCounts[r] = (routeCounts[r] || 0) + 1;
        }
    });
    renderTopList('top-routes-list', routeCounts, 'x');

    // 3. TOP CITIES (z oddzielnej bazy)
    renderTopList('top-cities-list', visitedCitiesData, ' wizyt');

    // 4. NAJDROŻSZY I NAJTAŃSZY
    renderPriceRanking();
}

function renderPriceRanking() {
    const container = document.getElementById('price-ranking-list');
    if (!container || tripsData.length === 0) return;
    container.innerHTML = "";

    const sortedByPrice = [...tripsData].sort((a, b) => b.zl - a.zl);
    const mostExpensive = sortedByPrice[0];
    const cheapest = sortedByPrice[sortedByPrice.length - 1];

    const items = [
        { label: "NAJDROŻSZY", data: mostExpensive, icon: "🔥", color: "var(--danger)" },
        { label: "NAJTAŃSZY", data: cheapest, icon: "💎", color: "var(--success)" }
    ];

    items.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = `display:flex; flex-direction:column; gap:2px; background:rgba(255,255,255,0.03); padding:8px 10px; border-radius:8px; font-size:11px; border-left: 3px solid ${item.color};`;
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:800; color:${item.color}; letter-spacing:1px;">${item.icon} ${item.label}</span>
                <span style="font-weight:900; color:#fff;">${parseFloat(item.data.zl).toFixed(2)} zł</span>
            </div>
            <div style="opacity:0.6;">${item.data.od.toUpperCase()} ➔ ${item.data.do.toUpperCase()}</div>
            <div style="font-size:9px; opacity:0.4;">${item.data.data} | ${item.data.nr || '---'}</div>
        `;
        container.appendChild(div);
    });
}

function renderTopList(elementId, dataMap, suffix) {
    const container = document.getElementById(elementId);
    if (!container) return;
    container.innerHTML = "";

    const sorted = Object.entries(dataMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    if (sorted.length === 0) {
        container.innerHTML = '<div style="font-size:10px; opacity:0.3;">Brak danych...</div>';
        return;
    }

    sorted.forEach(([label, count], idx) => {
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:6px 10px; border-radius:8px; font-size:12px;";
        
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
            div.innerHTML = `
                <div style="flex: 1;">
                    <b>${t.data} | ${t.nr || 'BRAK'} ${t.unit ? `[${t.unit}]` : ''}</b><br>
                    <small>${t.od.toUpperCase()} ➔ ${t.do.toUpperCase()}</small>
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
        { id: 'zl', label: 'Cena (zł)', value: trip.zl, type: 'number' }
    ], (res) => {
        const oldZl = parseFloat(trip.zl);
        const updatedZl = parseFloat(res.zl);
        
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
            if (oldZl !== updatedZl) {
                set(statsRef, earnedSoFar - oldZl + updatedZl);
            }
            window.showToast("Przejazd zaktualizowany!", "success");
        });
    });
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
            const newScale = Math.min(Math.max(initialScale * (currentDist / initialDist), 0.05), 5);
            state.scale = newScale;
            
            // Aktualizuj suwak zoomu jeśli istnieje
            const sliderId = svgId === 'svg-map' ? 'map-zoom-slider' : 'heat-zoom-slider';
            const slider = document.getElementById(sliderId);
            if (slider) slider.value = newScale;

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
                line.style.strokeWidth = (6 + Math.min(count, 10));
                line.style.strokeLinecap = "round";
                line.style.stroke = getHeatColor(count);
            } else {
                line.style.stroke = "#6366f1";
                line.style.strokeWidth = 3;
                line.style.opacity = 0.6;
            }
            g.appendChild(line);
        }
    });

    // 3. Stacje i Etykiety
    Object.keys(stations).forEach((name, index) => {
        const s = stations[name];
        let showLabel = true;
        
        if (mode === 'heat') {
            // Na heatmapie ukrywamy etykiety, chyba że jest bardzo duży zoom
            if (state.scale < 1.5) showLabel = false;
        } else {
            if (state.scale < 0.4) {
                if (index % 4 !== 0) showLabel = false;
            } else if (state.scale < 0.8) {
                if (index % 2 !== 0) showLabel = false;
            }
        }

        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", s.x); dot.setAttribute("cy", s.y); dot.setAttribute("r", globalPinSize);
        dot.setAttribute("fill", "#fff");
        dot.style.cursor = "pointer";
        dot.onclick = (e) => {
            e.stopPropagation();
            window.editStationName(name);
        };
        g.appendChild(dot);

        if (showLabel) {
            const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
            const pos = s.labelPos || 'right';
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

            txt.setAttribute("x", s.x + dx); 
            txt.setAttribute("y", s.y + dy);
            txt.setAttribute("text-anchor", anchor);
            txt.setAttribute("fill", "#cbd5e1"); 
            txt.setAttribute("font-size", mode === 'heat' ? "10px" : "14px"); // Mniejsze na heatmapie
            txt.setAttribute("font-weight", "600");
            txt.style.pointerEvents = "none"; // Żeby nie przeszkadzały w klikaniu kropek
            txt.textContent = name.toUpperCase();
            g.appendChild(txt);
        }
    });

    svg.appendChild(g);
}

// --- LOGIKA BIZNESOWA ---
const findStation = (input) => {
    if (!input) return null;
    const normalizedInput = normalizeStationName(input);
    const key = Object.keys(stations).find(k => normalizeStationName(k) === normalizedInput);
    return key ? { ...stations[key], name: key } : null;
};

window.calculatePrice = () => {
    if (isCalcDisabled) {
        window.showCustomDialog("🔒 Funkcja Zablokowana", calcDisabledMsg);
        return;
    }
    const fInputElem = document.getElementById('route-from');
    const tInputElem = document.getElementById('route-to');
    const d = parseFloat(document.getElementById('discount-select').value);
    
    if(!fInputElem.value || !tInputElem.value) return window.showToast("Wpisz lub wybierz stacje!", "error");

    const stFrom = findStation(fInputElem.value);
    const stTo = findStation(tInputElem.value);
    
    if (stFrom) fInputElem.value = stFrom.name.toUpperCase();
    if (stTo) tInputElem.value = stTo.name.toUpperCase();
    
    if(!stFrom || !stTo) {
        document.getElementById('calc-info').innerText = "Uwaga: Stacja poza bazą. Wpisz cenę ręcznie.";
        document.getElementById('calc-info').style.color = "var(--warning)";
        return;
    }
    
    const dist = Math.abs(stFrom.km - stTo.km);
    const p = taryfa.find(r => dist <= r.max) || {cena: 30};
    const final = p.cena * (1 - d);
    
    document.getElementById('trip-amount').value = final.toFixed(2);
    document.getElementById('calc-info').innerText = `Dystans: ${dist} km | Baza: ${p.cena} zł`;
    document.getElementById('calc-info').style.color = "var(--accent)";
};

window.addNewTrip = () => {
    const fInputElem = document.getElementById('route-from');
    const tInputElem = document.getElementById('route-to');
    const zl = parseFloat(document.getElementById('trip-amount').value);
    const nr = document.getElementById('regio-num').value;
    const unit = document.getElementById('unit-num').value;
    const note = document.getElementById('trip-note').value;
    
    if(!fInputElem.value || !tInputElem.value || isNaN(zl)) return window.showToast("Uzupełnij dane przejazdu!", "error");

    // Autokorekta przed zapisem
    const stFrom = findStation(fInputElem.value);
    const stTo = findStation(tInputElem.value);
    
    const finalFrom = stFrom ? stFrom.name.toUpperCase() : fInputElem.value.trim().toUpperCase();
    const finalTo = stTo ? stTo.name.toUpperCase() : tInputElem.value.trim().toUpperCase();

    push(tripsRef, {
        od: finalFrom,
        do: finalTo,
        zl: zl,
        nr: nr,
        unit: unit || "",
        note: note || "",
        data: new Date().toLocaleDateString('pl-PL')
    }).then(() => {
        set(statsRef, earnedSoFar + zl);
        fInputElem.value = "";
        tInputElem.value = "";
        document.getElementById('trip-amount').value = "";
        document.getElementById('regio-num').value = "";
        document.getElementById('unit-num').value = "";
        document.getElementById('trip-note').value = "";
        window.showToast("Przejazd zapisany!", "success");
    });
};

window.saveNewStation = () => {
    const nameInput = document.getElementById('new-st-name');
    const kmInput = document.getElementById('new-st-km');
    const xInput = document.getElementById('new-st-x');
    const yInput = document.getElementById('new-st-y');
    const parentInput = document.getElementById('new-st-parent');
    const labelPosInput = document.getElementById('new-st-label-pos');

    const name = nameInput.value.toLowerCase().trim();
    const km = parseFloat(kmInput.value);
    const x = parseInt(xInput.value);
    const y = parseInt(yInput.value);
    const p = parentInput.value.toLowerCase().trim();
    const lp = labelPosInput.value;

    if(!name || isNaN(km) || isNaN(x) || isNaN(y)) {
        return window.showToast("Uzupełnij wszystkie dane stacji!", "error");
    }

    const newStationData = { 
        km, 
        x, 
        y, 
        parent: p || null, 
        labelPos: lp 
    };

    set(ref(db, `stats/stacje_siec/${name}`), newStationData).then(() => {
        tempMarker = null;
        nameInput.value = "";
        kmInput.value = "";
        xInput.value = "";
        yInput.value = "";
        parentInput.value = "";
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
        { id: 'h', label: 'Wysokość (px)', value: item.h || 2000, type: 'number' }
    ], (res) => {
        const updatedItem = {
            ...item,
            title: res.title,
            src: res.src || null,
            w: parseInt(res.w) || 1600,
            h: parseInt(res.h) || 2000
        };
        delete updatedItem.key; // Usuwamy klucz przed zapisem do Firebase

        set(ref(db, `stats/schematy/${key}`), updatedItem).then(() => {
            window.showToast("Schemat zaktualizowany!", "success");
        });
    });
};

window.addNewGalleryItem = () => {
    const title = document.getElementById('new-gallery-title').value;
    const src = document.getElementById('new-gallery-src').value;
    const w = parseInt(document.getElementById('new-gallery-w').value) || 1600;
    const h = parseInt(document.getElementById('new-gallery-h').value) || 2000;
    if(!title) return window.showToast("Podaj chociaż tytuł!", "error");
    
    // Obliczamy index na podstawie aktualnej długości listy
    const orderIndex = galleryData.length;
    
    const newItem = { 
        title: title, 
        src: src || null,
        order: orderIndex,
        w: w,
        h: h 
    };
    
    push(schematyRef, newItem).then(() => {
        document.getElementById('new-gallery-title').value = "";
        document.getElementById('new-gallery-src').value = "";
        window.toggleGalleryEditor(); // Zamknij po dodaniu
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
    document.body.classList.add('no-scroll');
    
    const statusText = document.getElementById('secret-status-text');
    if (!storedPassword) {
        statusText.innerText = "Witaj w Panelu Tajnym! Wymyśl hasło, aby je zapisać:";
        document.querySelector('#secret-login-view button').innerText = "USTAW HASŁO";
    } else {
        statusText.innerText = "Wpisz hasło, aby wejść:";
        document.querySelector('#secret-login-view button').innerText = "ZALOGUJ";
    }

    // Wypełnij książkę kodów błędów
    const bookElem = document.getElementById('error-code-book');
    if (bookElem) {
        bookElem.innerHTML = Object.entries(errorBook).map(([code, desc]) => `
            <div style="display:flex; gap:10px; background:rgba(255,255,255,0.05); padding:8px; border-radius:8px;">
                <b style="color:var(--accent); min-width:30px;">${code}</b>
                <span style="opacity:0.8;">${desc}</span>
            </div>
        `).join('');
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

    // Załaduj czas konserwacji
    if (maintenanceEndTime) {
        document.getElementById('m-end-time-input').value = maintenanceEndTime;
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
        }
    }
    input.value = "";
};

window.showSecretContent = () => {
    document.getElementById('secret-login-view').style.display = 'none';
    document.getElementById('secret-content-view').style.display = 'flex';
    isAdminUnlocked = true;
    updateMaintenanceUI();
    updateCalcBtnUI();
    updateAdminPanelFields();
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
    // 1. Ostrzeżenie
    alert("⚠️ UWAGA ! to zmieni hassło do wszystkich powiązanych z aplikacją rzeczy");
    
    // 2. Kod zabezpieczający
    const code = prompt("Wpisz kod zabezpieczający:");
    if (code !== "2583") {
        return alert("Błędny kod! Akcja przerwana. ❌");
    }
    
    // 3. Nowe hasło
    const newPass = prompt("Wpisz nowe hasło administratora:");
    if (!newPass) return alert("Hasło nie może być puste!");
    
    if (confirm(`Czy na pewno chcesz zmienić hasło na: ${newPass}?`)) {
        set(ref(db, 'stats/config/password'), newPass).then(() => {
            alert("Hasło zostało pomyślnie zmienione! ✅");
            storedPassword = newPass; // Aktualizacja lokalna
        }).catch(e => {
            console.error("Błąd zmiany hasła:", e);
            alert("Błąd podczas zapisywania nowego hasła.");
        });
    }
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
window.toggleRainbowMode = () => {
    rainbowActive = !rainbowActive;
    const btn = document.getElementById('rainbow-mode-btn');
    if (rainbowActive) {
        document.body.classList.add('rainbow-effect');
        if (btn) {
            btn.innerText = "WYŁĄCZ 🌈";
            btn.style.background = "var(--danger)";
        }
        window.showToast("Tęczowy tryb aktywny! 🌈", "success");
    } else {
        document.body.classList.remove('rainbow-effect');
        if (btn) {
            btn.innerText = "WŁĄCZ 🌈";
            btn.style.background = "var(--accent)";
        }
    }
    renderBase();
    renderHeat();
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
    const isOpening = !document.getElementById('side-menu').classList.contains('active');
    document.getElementById('side-menu').classList.toggle('active');
    document.getElementById('menu-overlay').classList.toggle('active');
    
    if (isOpening) {
        document.body.classList.add('no-scroll');
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
    renderHeat(); 
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

window.openSettings = () => { 
    window.closeAllModals();
    document.getElementById('settings-modal').classList.add('active'); 
    window.setActiveMenuItem('menu-settings');
    document.body.classList.add('no-scroll');
    window.filterStations(); 
};
window.closeSettings = () => {
    document.getElementById('settings-modal').classList.remove('active');
    document.body.classList.remove('no-scroll');
};

window.openFullHistory = () => { 
    window.closeAllModals();
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

// --- OBSŁUGA TRYBU KONSERWACJI ---
function updateMaintenanceUI() {
    const overlay = document.getElementById('maintenance-overlay');
    const mainContent = document.getElementById('main-app-content');
    const toggleBtn = document.getElementById('maintenance-toggle-btn');
    
    const shouldShowMaintenance = isDeveloperModeActive && !isAdminUnlocked;

    if (overlay) {
        if (shouldShowMaintenance) {
            overlay.classList.add('active');
            startMaintenanceCountdown();
        } else {
            overlay.classList.remove('active');
            if (maintenanceInterval) clearInterval(maintenanceInterval);
        }
    }

    if (toggleBtn) {
        toggleBtn.innerText = isDeveloperModeActive ? 'WŁĄCZONY 🚧' : 'WYŁĄCZONY';
        toggleBtn.style.background = isDeveloperModeActive ? 'var(--success)' : 'var(--danger)';
    }

    if (mainContent) {
        mainContent.style.display = shouldShowMaintenance ? 'none' : 'block';
    }
}

window.checkMaintenancePassword = () => {
    const input = document.getElementById('m-password-input');
    const pass = input.value;
    if (!pass) return window.showToast("Wpisz hasło!", "error");

    if (pass === storedPassword) {
        isAdminUnlocked = true;
        document.getElementById('admin-bus-trigger').classList.add('admin-active');
        updateMaintenanceUI();
        updateMapVisibilityUI();
        window.showToast("Zalogowano pomyślnie!", "success");
        window.addConsoleLog("Administrator zalogowany (tryb konserwacji)", "success");
    } else {
        window.showToast("Błędne hasło!", "error");
        window.addConsoleLog(`NIEPOPRAWNE HASŁO ( ${pass} ) - PRÓBA LOGOWANIA KONSERWACJA`, "error");
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

window.addVisitedCity = () => {
    const name = document.getElementById('new-city-name').value.trim();
    const count = parseInt(document.getElementById('new-city-count').value);
    
    if (!name || isNaN(count)) return alert("Wpisz nazwę miasta i liczbę wizyt!");
    
    const normalizedName = name.toUpperCase();
    set(ref(db, `stats/visited_cities/${normalizedName}`), count).then(() => {
        document.getElementById('new-city-name').value = "";
        document.getElementById('new-city-count').value = "1";
        window.showToast("Miasto dodane/zaktualizowane!", "success");
    });
};

window.editCity = (name, oldCount) => {
    window.openUniversalEdit(`Edytuj Miasto: ${name}`, [
        { id: 'name', label: 'Nazwa miasta', value: name },
        { id: 'count', label: 'Liczba wizyt', value: oldCount, type: 'number' }
    ], (res) => {
        const newName = res.name.trim().toUpperCase();
        const newCount = parseInt(res.count) || 0;
        
        if (newName !== name) {
            // Jeśli nazwa się zmieniła, usuwamy stary wpis i dodajemy nowy
            remove(ref(db, `stats/visited_cities/${name}`)).then(() => {
                set(ref(db, `stats/visited_cities/${newName}`), newCount);
            });
        } else {
            // Jeśli tylko liczba wizyt
            set(ref(db, `stats/visited_cities/${name}`), newCount);
        }
        window.showToast("Dane miasta zapisane!", "success");
    });
};

window.deleteCity = (name) => {
    window.openDeleteConfirm(`To usunie miasto ${name} z listy odwiedzonych.`, () => {
        remove(ref(db, `stats/visited_cities/${name}`)).then(() => window.showToast("Miasto usunięte.", "success"));
    });
};

window.saveMaintenanceTime = () => {
    const time = document.getElementById('m-end-time-input').value;
    if (!time) return alert("Wybierz czas!");
    
    set(ref(db, 'stats/config/maintenanceEndTime'), time).then(() => {
        window.showToast("Czas konserwacji zapisany!", "success");
    });
};

// Inicjalizacja UI
updateMaintenanceUI();