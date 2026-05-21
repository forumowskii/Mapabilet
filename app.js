import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, set, push, remove, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import PhotoSwipeLightbox from 'https://unpkg.com/photoswipe@5.4.3/dist/photoswipe-lightbox.esm.js';

// --- KONFIGURACJA ---
const startTime = performance.now();

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

const statsRef = ref(db, 'stats/oszczednosci');
const tripsRef = ref(db, 'stats/przejazdy');
const stationsRef = ref(db, 'stats/stacje_siec');
const schematyRef = ref(db, 'stats/schematy');
const ticketRef = ref(db, 'stats/bilet_miesieczny');
const configRef = ref(db, 'stats/config');
const visitedCitiesRef = ref(db, 'stats/visited_cities');
const connectionsRef = ref(db, 'stats/polaczenia');

let earnedSoFar = 0;
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
let gridActive = false;
let busClicks = 0;
let isAdminUnlocked = false;
let storedPassword = null;
let isDeveloperModeActive = false;
let isDrawMode = false;
let drawPoints = [];
let maintenanceEndTime = null;
let maintenanceInterval = null;
let stationEditorBg = null;
let tempMarker = null;
let isMapVisible = true;
let showEditorBg = true;
let globalPinSize = 6;
let globalPinColor = "#ffffff";
let globalLineWidth = 4;
let globalHeatWidth = 1.5;
let globalTextRotation = 0;
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

window.toggleLabelEditMode = () => {
    isLabelEditMode = !isLabelEditMode;
    
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
    const rotDisplay = document.getElementById('knob-rotation-display');
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
        rotDisplay.innerText = `${deg}°`;
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
            selectedLabelForRotation.element.setAttribute("font-size", `${size}px`);
        }
    };

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
        rotDisplay.innerText = `${currentRotation}°`;

        currentFontSize = data.fontSize || 14;
        const sizeAngle = (currentFontSize - 20) * 12;
        sizeDial.style.transform = `rotate(${sizeAngle}deg)`;
        sizeInput.value = currentFontSize;

        document.getElementById('knob-label-name').innerText = name.toUpperCase();
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
    set(ref(db, 'stats/config/globalPinColor'), globalPinColor);
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
let heatState = { x: 0, y: 0, scale: 0.7 };

// Init renderów
const renderBase = () => {
    try {
        renderMapElements('svg-map', mapState, 'base');
    } catch (e) {
        console.error("Błąd renderBase:", e);
    }
};

const renderHeat = () => {
    try {
        renderMapElements('svg-heatmap', heatState, 'heat');
        updateHotRoutesUI();
    } catch (e) {
        console.error("Błąd renderHeat:", e);
    }
};

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
        
        // Niektóre pola mogą być na całą szerokość (np. nazwa)
        if (field.id === 'name' || field.id === 'labelPos' || field.type === 'textarea') {
            wrap.style.gridColumn = "span 2";
        }
        
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
        } else if (field.type === 'tags') {
            const tagContainer = document.createElement('div');
            tagContainer.className = 'tags-input-container';
            tagContainer.id = `tags-input-${field.id}`;
            tagContainer.innerHTML = `<input type="text" placeholder="${field.placeholder || 'Dodaj stację...'}">`;
            
            wrap.appendChild(label);
            wrap.appendChild(tagContainer);
            fieldsContainer.appendChild(wrap);
            
            const handler = window.initTagsInput(tagContainer.id, field.value);
            inputs[field.id] = { 
                get value() { return handler.getTags().join(', '); },
                set value(v) { handler.setTags(v.split(',').map(t => t.trim()).filter(t => t)); }
            };
            return; // Skip standard append
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

        if (config.globalTextRotation !== undefined) {
            globalTextRotation = config.globalTextRotation;
            document.querySelectorAll('input[type="range"][oninput*="updateGlobalTextRotation"]').forEach(input => {
                input.value = globalTextRotation;
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

onValue(connectionsRef, (s) => {
    connectionsData = s.val() || {};
    renderBase();
    renderHeat();
    renderAdminConnections();
});

let isConnectionMode = false;
let connectionStartStation = null;

window.toggleConnectionMode = () => {
    isConnectionMode = !isConnectionMode;
    connectionStartStation = null;
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

let isCurveEditMode = false;
let activeCurveId = null;

window.toggleCurveEditMode = () => {
    isCurveEditMode = !isCurveEditMode;
    isConnectionMode = false; // Wyłączamy zwykłe łączenie
    const btn = document.getElementById('toggle-curve-edit-btn');
    const connBtn = document.getElementById('toggle-connection-mode-btn');
    if (btn) {
        btn.innerText = isCurveEditMode ? "EDYCJA KRZYWYCH: WŁ" : "EDYCJA KRZYWYCH: WYŁ";
        btn.style.background = isCurveEditMode ? "var(--success)" : "#475569";
    }
    if (connBtn) {
        connBtn.innerText = "TRYB ŁĄCZENIA: WYŁ";
        connBtn.style.background = "#475569";
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
        isConnectionMode = false; // Wyłączamy inne tryby
        isCurveEditMode = false;
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
                <i class="fa-solid fa-pen" onclick="event.stopPropagation(); window.editConnection('${id}')"></i>
                <i class="fa-solid fa-trash" style="color: var(--danger);" onclick="event.stopPropagation(); window.openDeleteConfirm('Czy chcesz usunąć tę linię?', () => remove(ref(db, 'stats/polaczenia/${id}')))"></i>
            </div>
        `;
        div.onclick = () => {
            // Można tu dodać centrowanie na linii
        };
        container.appendChild(div);
    });
}

window.toggleDrawMode = () => {
    isDrawMode = !isDrawMode;
    isConnectionMode = false;
    isCurveEditMode = false;
    drawPoints = [];
    
    const btn = document.getElementById('toggle-draw-mode-btn');
    if (btn) {
        btn.innerText = isDrawMode ? "TRYB RYSOWANIA: WŁ" : "TRYB RYSOWANIA: WYŁ";
        btn.style.background = isDrawMode ? "var(--success)" : "#475569";
    }
    
    // Zresetuj inne przyciski
    const connBtn = document.getElementById('toggle-connection-mode-btn');
    const curveBtn = document.getElementById('toggle-curve-edit-btn');
    if (connBtn) { connBtn.innerText = "TRYB ŁĄCZENIA: WYŁ"; connBtn.style.background = "#475569"; }
    if (curveBtn) { curveBtn.innerText = "EDYCJA KRZYWYCH: WYŁ"; curveBtn.style.background = "#475569"; }

    window.showToast(isDrawMode ? "Tryb rysownika aktywny - klikaj na mapę" : "Tryb rysownika wyłączony", "info");
    renderBase();
};

window.clearDrawTemp = () => {
    if (drawPoints.length > 0) {
        drawPoints.pop();
        renderBase();
    }
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
        { id: 'name', label: 'Nazwa stacji (klucz)', value: key.toUpperCase() },
        { id: 'km', label: 'Kilometry (KM)', value: oldData.km, type: 'number' },
        { id: 'x', label: 'Pozycja X', value: oldData.x, type: 'number' },
        { id: 'y', label: 'Pozycja Y', value: oldData.y, type: 'number' },
        { id: 'labelPos', label: 'Pozycja nazwy', value: oldData.labelPos || 'right', type: 'select', options: labelOptions },
        { id: 'fontSize', label: 'Rozmiar tekstu (px)', value: oldData.fontSize || 14, type: 'number' },
        { id: 'rotation', label: 'Obrót tekstu (stopnie)', value: oldData.rotation || 0, type: 'number' },
        { id: 'radius', label: 'Rozmiar kropki (Radius)', value: oldData.radius || globalPinSize, type: 'number' },
        { id: 'offX', label: 'Offset X tekstu', value: oldData.offX || 0, type: 'number' },
        { id: 'offY', label: 'Offset Y tekstu', value: oldData.offY || 0, type: 'number' },
        { id: 'color', label: 'Kolor kropki', value: oldData.color || globalPinColor, type: 'color' },
        { id: 'parent', label: 'Stacje nadrzędne', value: oldData.parent || "", type: 'tags' }
    ], (res) => {
        const newName = res.name.toLowerCase().trim();
        const updatedData = {
            ...oldData,
            km: parseFloat(res.km) || 0,
            x: parseInt(res.x) || 0,
            y: parseInt(res.y) || 0,
            labelPos: res.labelPos,
            fontSize: parseInt(res.fontSize) || 14,
            rotation: parseInt(res.rotation) || 0,
            radius: parseInt(res.radius) || globalPinSize,
            offX: parseInt(res.offX) || 0,
            offY: parseInt(res.offY) || 0,
            color: res.color,
            parent: res.parent ? res.parent.toLowerCase().trim() : null
        };

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
    const tableHeader = document.querySelector('#history-modal thead');
    if (!tableBody) return;

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
    const inputFrom = document.getElementById('route-from');
    const inputTo = document.getElementById('route-to');
    
    const currentFrom = inputFrom ? inputFrom.value.toLowerCase().trim() : "";
    const currentTo = inputTo ? inputTo.value.toLowerCase().trim() : "";

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
    
    // 1. TOP SERIES (np. EN57)
    const seriesCounts = {};
    tripsData.forEach(t => {
        if (t.unit) {
            const series = t.unit.split('-')[0].trim().toUpperCase();
            seriesCounts[series] = (seriesCounts[series] || 0) + 1;
        }
    });
    renderTopList('top-series-list', seriesCounts, 'x', 3); // Tylko TOP 3

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

    // 5. TOP UNITS (na sam dół)
    const unitCounts = {};
    tripsData.forEach(t => {
        if (t.unit) {
            const u = t.unit.trim().toUpperCase();
            unitCounts[u] = (unitCounts[u] || 0) + 1;
        }
    });
    renderTopList('top-units-list', unitCounts, 'x');
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
// Zoptymalizowane liczenie natężenia
const getUsageData = () => {
    const usage = {};
    if (!tripsData || tripsData.length === 0) return usage;

    // Budujemy graf raz dla wszystkich obliczeń w tej turze
    const adj = {};
    const addEdge = (u, v) => {
        if (!adj[u]) adj[u] = [];
        if (!adj[v]) adj[v] = [];
        if (!adj[u].includes(v)) adj[u].push(v);
        if (!adj[v].includes(u)) adj[v].push(u);
    };

    // 1. Połączenia parent-child
    Object.keys(stations).forEach(name => {
        const s = stations[name];
        getParents(s).forEach(pName => {
            if (stations[pName]) addEdge(name, pName);
        });
    });

    // 2. Połączenia z bazy connectionsData
    Object.keys(connectionsData).forEach(id => {
        const conn = connectionsData[id];
        if (!conn.isCustom) {
            const [a, b] = id.split('|');
            if (stations[a] && stations[b]) {
                addEdge(a, b);
            }
        }
    });

    const findPathBFS = (start, end) => {
        if (!stations[start] || !stations[end]) return [];
        if (start === end) return [];
        
        const queue = [[start]];
        const visited = new Set([start]);

        while (queue.length > 0) {
            const path = queue.shift();
            const node = path[path.length - 1];

            if (node === end) {
                const segs = [];
                for (let i = 0; i < path.length - 1; i++) {
                    segs.push([path[i], path[i+1]]);
                }
                return segs;
            }

            const neighbors = adj[node] || [];
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push([...path, neighbor]);
                }
            }
        }
        return [];
    };

    tripsData.forEach(t => {
        const odRaw = (t.od || "").toLowerCase().trim();
        const doRaw = (t.do || "").toLowerCase().trim();
        if (!odRaw || !doRaw) return;

        // Szukamy stacji po znormalizowanej nazwie
        const od = Object.keys(stations).find(k => k === odRaw || normalizeStationName(k) === normalizeStationName(odRaw)) || odRaw;
        const d = Object.keys(stations).find(k => k === doRaw || normalizeStationName(k) === normalizeStationName(doRaw)) || doRaw;
        
        // Zliczamy stacje końcowe
        usage[od] = (usage[od] || 0) + 1;
        usage[d] = (usage[d] || 0) + 1;

        const segments = findPathBFS(od, d);
        if (segments.length > 0) {
            segments.forEach(seg => {
                const k = seg.sort().join('|');
                usage[k] = (usage[k] || 0) + 1;
                
                // Zliczamy stacje pośrednie
                usage[seg[0]] = (usage[seg[0]] || 0) + 1;
                usage[seg[1]] = (usage[seg[1]] || 0) + 1;
            });
        }
    });
    return usage;
};

const getHeatColor = (count) => {
    if (count === 0) return "#334155"; // Wyraźniejszy szary dla braku ruchu (widoczna sieć)
    if (count < 2) return "#fbbf24";  // Żółty (1 przejazd)
    if (count < 5) return "#f59e0b";  // Jasny pomarańcz
    if (count < 10) return "#ea580c"; // Ciemny pomarańcz
    if (count < 20) return "#dc2626"; // Czerwony
    return "#7f1d1d"; // Bordowy (Bardzo duży ruch)
};

function renderMapElements(svgId, state, mode = 'base') {
    const svg = document.getElementById(svgId);
    if (!svg) return;
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
    const usage = mode === 'heat' ? getUsageData() : {};

    // Rysuj połączenia z bazy connectionsData
    Object.keys(connectionsData).forEach(id => {
        const conn = connectionsData[id];
        let s, p;

        if (conn.isCustom) {
            s = { x: conn.x1, y: conn.y1 };
            p = { x: conn.x2, y: conn.y2 };
        } else {
            const [a, b] = id.split('|');
            if (stations[a] && stations[b]) {
                s = stations[a];
                p = stations[b];
            }
        }

        if (s && p) {
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
                const count = usage[id] || 0;
                path.setAttribute("stroke", getHeatColor(count));
                // Stała grubość niezależna od zoomu, żeby nie było "ciapy"
                const baseW = (conn.width || globalLineWidth) * globalHeatWidth;
                const extraW = Math.min(count * 1.5, 25);
                path.setAttribute("stroke-width", baseW + extraW);
                path.setAttribute("stroke-linecap", "round");
                path.setAttribute("stroke-linejoin", "round");
                path.setAttribute("filter", "url(#heat-glow)");
                path.style.opacity = count > 0 ? 0.8 : 0.1;
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
                
                let isDraggingHandle = false;
                handle.onmousedown = (e) => { e.stopPropagation(); isDraggingHandle = true; };
                svg.addEventListener('mousemove', (e) => {
                    if (!isDraggingHandle) return;
                    const pt = svg.createSVGPoint();
                    pt.x = e.clientX; pt.y = e.clientY;
                    const cursorpt = pt.matrixTransform(g.getScreenCTM().inverse());
                    conn.cx = Math.round(cursorpt.x);
                    conn.cy = Math.round(cursorpt.y);
                    handle.setAttribute("cx", conn.cx);
                    handle.setAttribute("cy", conn.cy);
                    // Aktualizuj ścieżkę wizualnie bez Firebase dla płynności
                    path.setAttribute("d", `M ${s.x} ${s.y} Q ${conn.cx} ${conn.cy} ${p.x} ${p.y}`);
                });
                window.addEventListener('mouseup', () => {
                    if (isDraggingHandle) {
                        isDraggingHandle = false;
                        window.updateCurve(id, conn.cx, conn.cy);
                    }
                });
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
                    const count = usage[id] || 0;
                    path.setAttribute("stroke", getHeatColor(count));
                    const baseW = globalLineWidth * globalHeatWidth;
                    path.setAttribute("stroke-width", baseW + Math.min(count, 10));
                    path.setAttribute("stroke-linecap", "round");
                    path.setAttribute("stroke-linejoin", "round");
                    path.style.opacity = count > 0 ? 0.8 : 0.1;
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
        let showLabel = true;
        
        if (mode === 'heat') {
            // Na heatmapie ukrywamy etykiety, chyba że jest bardzo duży zoom
            if (state.scale < 1.5) showLabel = false;
        } else {
            // W trybie edycji (base) ZAWSZE pokazujemy wszystkie etykiety
            // Filtrowanie index % N tylko dla trybu podglądu, jeśli to konieczne
            // Na razie wyłączamy filtrowanie w base, żeby widzieć wszystko co dodajemy
            showLabel = true;
        }

        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", s.x); dot.setAttribute("cy", s.y); 
        
        if (mode === 'heat') {
            const stationUsage = usage[name] || 0;
            const r = ( (s.radius || globalPinSize) * 0.5 + Math.min(stationUsage, 6));
            dot.setAttribute("r", r);
            dot.setAttribute("fill", getHeatColor(stationUsage));
            dot.setAttribute("stroke", "#fff");
            dot.setAttribute("stroke-width", 0.5);
            dot.style.opacity = stationUsage > 0 ? 0.9 : 0.05;
        } else {
            dot.setAttribute("r", (s.radius || globalPinSize));
            let fillColor = s.color || globalPinColor;
            if (isConnectionMode && connectionStartStation === name) fillColor = "var(--accent)";
            if (isParentSelectionMode && parentSelectionSource === name) fillColor = "var(--warning)";
            if (isParentSelectionMode && parentSelectionSource !== name) {
                const sourceParents = getParents(stations[parentSelectionSource]);
                if (sourceParents.includes(name.toLowerCase())) fillColor = "var(--success)";
            }
            dot.setAttribute("fill", fillColor);
            dot.style.opacity = "1";
        }
        dot.style.cursor = "pointer";
        dot.onclick = (e) => {
            e.stopPropagation();
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

            txt.setAttribute("x", s.x + finalDx); 
            txt.setAttribute("y", s.y + finalDy);
            txt.setAttribute("text-anchor", anchor);
            
            // Aplikuj rotację (indywidualną lub globalną)
            const rotation = s.rotation !== undefined ? s.rotation : globalTextRotation;
            if (rotation !== 0) {
                txt.setAttribute("transform", `rotate(${rotation} ${s.x + finalDx} ${s.y + finalDy})`);
            }

            txt.setAttribute("fill", mode === 'base' ? "#fff" : "#cbd5e1"); 
            
            // Stała wielkość czcionki w jednostkach SVG
            let baseFS = s.fontSize || 13;
            if (state.scale < 0.6) baseFS *= 0.8; // Delikatne zmniejszenie przy dużym oddaleniu
            
            txt.setAttribute("font-size", baseFS + "px");
            txt.setAttribute("font-weight", "700");
            
            // Cień zamiast obrysu dla czystszego wyglądu
            txt.style.textShadow = "1px 1px 2px rgba(0,0,0,0.8)";

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
    const cenaInput = document.getElementById('trip-amount');
    const zl = parseFloat(cenaInput.value);
    const nr = document.getElementById('regio-num').value;
    const unit = document.getElementById('unit-num').value;
    const note = document.getElementById('trip-note').value;

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
    if(isNaN(zl)) { cenaInput.classList.add('invalid'); hasError = true; }

    if(hasError) return window.showToast("Uzupełnij podświetlone pola!", "error");

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
        cenaInput.value = "";
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
        const labelPanel = document.getElementById('admin-label-edit-panel');
        if (labelPanel) labelPanel.style.display = 'block';
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
        const labelPanel = document.getElementById('admin-label-edit-panel');
        if (labelPanel) labelPanel.style.display = 'block';
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
console.log("System RegioPomorskie w pełni załadowany.");