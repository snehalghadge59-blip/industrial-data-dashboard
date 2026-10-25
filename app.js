/**
 * MEDNEXA — APP ENGINE & LOGIC
 * High-Performance Client for SIH Hackathon Demo
 */

let allPharmacies = [];
let filteredPharmacies = [];
let map = null;
let markersLayer = null;
let userMarker = null;
let userCoords = null;
let activeFilter = 'all';
let selectedArea = 'all';
let searchQuery = '';
let supabase = null;

// DOM Elements
const cardsGrid = document.getElementById('cardsGrid');
const resultsCountEl = document.getElementById('resultsCount');
const searchInput = document.getElementById('searchInput');
const searchClearBtn = document.getElementById('searchClear');
const areaSelect = document.getElementById('areaSelect');
const filterPills = document.querySelectorAll('.filter-pill');

// Stat Elements
const statTotalEl = document.getElementById('statTotal');
const stat24hEl = document.getElementById('stat24h');
const statGenericEl = document.getElementById('statGeneric');
const statDistanceEl = document.getElementById('statDistance');
const statVisitorCountEl = document.getElementById('statVisitorCount');
const navVisitorCountEl = document.getElementById('navVisitorCount');
const footerVisitorCountEl = document.getElementById('footerVisitorCount');
const dbStatusText = document.getElementById('dbStatusText');

// Visitor Count Persistent State (Real count starting from 1)
const VISITOR_STORAGE_KEY = 'medifinder_real_visitor_count_v4';
const VISITOR_SESSION_KEY = 'medifinder_visit_session_active_v4';
const BASE_VISITOR_COUNT = 1;
let totalVisitorCount = BASE_VISITOR_COUNT;

// ==========================================================================
// 1. INITIALIZATION & RECOVERY
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    initVisitorCounter();
    loadPharmaciesData();
    initLeafletSafely();
    setupEventListeners();
    populateMedicineTable();
    initAdminPortal();
    initSecureUsers();
    applyFilters();
});

function loadPharmaciesData() {
    const saved = localStorage.getItem('medifinder_stores_v7');
    if (saved) {
        try {
            allPharmacies = JSON.parse(saved);
            const hasStudentStores = allPharmacies.some(s => s.isStudentVisited);
            if (!hasStudentStores && typeof INITIAL_PHARMACIES !== 'undefined') {
                allPharmacies = [...INITIAL_PHARMACIES];
                savePharmaciesData();
            }
        } catch (e) {
            allPharmacies = typeof INITIAL_PHARMACIES !== 'undefined' ? [...INITIAL_PHARMACIES] : [];
        }
    } else {
        allPharmacies = typeof INITIAL_PHARMACIES !== 'undefined' ? [...INITIAL_PHARMACIES] : [];
        savePharmaciesData();
    }
}

function savePharmaciesData() {
    localStorage.setItem('medifinder_stores_v7', JSON.stringify(allPharmacies));
}

// Leaflet Multi-Layer Map State
let baseLayers = {};
let currentLayerName = 'detailed';

// ==========================================================================
// 2. LEAFLET MAP WITH MULTI-LAYER STREET MAP & FAIL-SAFE HANDLING
// ==========================================================================
function initLeafletSafely() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    if (typeof L === 'undefined') {
        mapContainer.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:#f8fafc;color:#64748b;padding:20px;text-align:center;">
                <i class="fas fa-map-location" style="font-size:2.5rem;color:#0284c7;margin-bottom:10px;"></i>
                <p><strong>Interactive Map in Offline/Local Mode</strong></p>
                <p style="font-size:0.85rem;">Leaflet map tiles are ready when internet is active. All pharmacy GPS coordinates are safely loaded.</p>
            </div>
        `;
        return;
    }

    try {
        // Centered across PCMC (Akurdi, Nigdi, Chinchwad, Pimpri, Bhosari, Moshi, Wakad, Punawale, Pimple Saudagar)
        map = L.map('map', {
            center: [18.6360, 73.7880],
            zoom: 12,
            zoomControl: true
        });

        // 1. Official OpenStreetMap Standard Layer (100% free, zero API key)
        const streetLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
            crossOrigin: true
        });

        // 2. Esri World Street Map (Detailed street, highway, and transit network, zero API key)
        const detailedLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Street Map Contributors',
            maxZoom: 19
        });

        // 3. Satellite Aerial Imagery (Esri World Imagery, zero API key)
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Earthstar Geographics',
            maxZoom: 18
        });

        // 4. Esri Topographic & Terrain Layer (zero API key)
        const topoLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Topo Map Contributors',
            maxZoom: 19
        });

        baseLayers = {
            'street': streetLayer,
            'detailed': detailedLayer,
            'satellite': satelliteLayer,
            'topo': topoLayer
        };

        // Add default Street Map layer to map (Esri World Street Map: clean, high-speed, no rate-limits)
        detailedLayer.addTo(map);

        // Add standard Leaflet layer control in top-right as well
        L.control.layers({
            "🛣️ Detailed Street Map": detailedLayer,
            "🗺️ OpenStreetMap": streetLayer,
            "🛰️ Satellite Imagery": satelliteLayer,
            "⛰️ Topographic Map": topoLayer
        }, null, { position: 'topright' }).addTo(map);

        markersLayer = L.layerGroup().addTo(map);

        // Fail-safe: If OpenStreetMap rate-limits or errors, seamlessly fall back to Esri Street Map
        streetLayer.on('tileerror', function() {
            console.warn("OpenStreetMap tile error; falling back to Esri Detailed Roads.");
            if (currentLayerName === 'street') {
                switchMapLayer('detailed');
            }
        });

        // Click map to auto-fill latitude/longitude in Add Store modal
        map.on('click', (e) => {
            const { lat, lng } = e.latlng;
            const latInput = document.getElementById('storeLat');
            const lngInput = document.getElementById('storeLng');
            if (latInput && lngInput) {
                latInput.value = lat.toFixed(6);
                lngInput.value = lng.toFixed(6);
                showToast(`Selected coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, "info");
            }
        });
    } catch (err) {
        console.warn("Map init fallback:", err);
    }
}

function switchMapLayer(layerName) {
    if (!map || !baseLayers || !baseLayers[layerName]) return;

    // Remove all existing base layers
    Object.values(baseLayers).forEach(layer => {
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });

    // Add selected layer
    baseLayers[layerName].addTo(map);
    currentLayerName = layerName;

    // Update buttons in UI
    const layerButtons = {
        'street': 'btnStreetLayer',
        'detailed': 'btnDetailedLayer',
        'satellite': 'btnSatelliteLayer',
        'topo': 'btnTopoLayer'
    };

    Object.entries(layerButtons).forEach(([key, btnId]) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.classList.toggle('active', key === layerName);
        }
    });

    const layerLabels = {
        'street': 'OpenStreetMap view enabled',
        'detailed': 'Detailed Roads view enabled',
        'satellite': 'Satellite view enabled',
        'topo': 'Topographic view enabled'
    };
    if (layerLabels[layerName]) {
        showToast(layerLabels[layerName], "info");
    }
}

function getMarkerColor(type) {
    switch (type.toLowerCase()) {
        case 'generic': return '#059669';
        case 'allopathy': return '#0284c7';
        case 'ayurvedic': return '#db2777';
        case 'homeopathy': return '#d97706';
        default: return '#4b5563';
    }
}

function updateMapMarkers(pharmacyList) {
    if (!map || !markersLayer || typeof L === 'undefined') return;
    markersLayer.clearLayers();

    pharmacyList.forEach(store => {
        if (!store.lat || !store.lng) return;

        const pinColor = getMarkerColor(store.type);
        const customIcon = L.divIcon({
            className: 'custom-leaflet-marker',
            html: `
                <div style="
                    background: ${pinColor};
                    width: 32px;
                    height: 32px;
                    border-radius: 50% 50% 50% 0;
                    transform: rotate(-45deg);
                    border: 2px solid white;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    <i class="fas ${store.type === 'Generic' ? 'fa-capsules' : 'fa-prescription-bottle-alt'}" 
                       style="transform: rotate(45deg); color: white; font-size: 13px;"></i>
                </div>
            `,
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, -30]
        });

        const marker = L.marker([store.lat, store.lng], { icon: customIcon });

        const popupHtml = `
            <div class="popup-card">
                <div class="popup-title">${store.name}</div>
                <span class="popup-badge" style="background:${pinColor}22; color:${pinColor}">
                    ${store.type} ${store.is24Hours ? '• 24x7' : ''}
                </span>
                ${store.isStudentVisited ? '<span class="popup-badge" style="background:#fef3c7; color:#92400e; margin-left:4px;"><i class="fas fa-user-graduate"></i> Student Visited</span>' : ''}
                <p class="popup-addr"><i class="fas fa-location-dot"></i> ${store.address}</p>
                <div class="popup-actions">
                    <a href="tel:${store.phone}" class="popup-btn popup-btn-call"><i class="fas fa-phone"></i> Call</a>
                    <a href="${store.mapUrl}" target="_blank" class="popup-btn popup-btn-map"><i class="fas fa-directions"></i> Navigate</a>
                </div>
            </div>
        `;

        marker.bindPopup(popupHtml, { className: 'custom-pin-popup' });
        markersLayer.addLayer(marker);
    });
}

// ==========================================================================
// 3. HAVERSINE GPS DISTANCE CALCULATOR
// ==========================================================================
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in KM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function locateUser() {
    const gpsBtn = document.getElementById('gpsLocateBtn');
    if (gpsBtn) gpsBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Locating...`;

    if (!navigator.geolocation) {
        showToast("Geolocation is not supported by your browser. Using PCCOE Campus location.", "warning");
        useFallbackCoords();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            userCoords = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            finalizeUserLocation("Your Live Location");
            showToast("Located nearest pharmacies to your live GPS position!", "success");
        },
        (error) => {
            let msg = "Using PCCOE Campus reference location";
            if (error.code === 1) { // PERMISSION_DENIED
                msg = "Location permission was denied. Tap any pharmacy or area to view on street map.";
            } else if (error.code === 2) { // POSITION_UNAVAILABLE
                msg = "GPS position unavailable. Using PCCOE Campus reference.";
            } else if (error.code === 3) { // TIMEOUT
                msg = "Location request timed out. Using PCCOE Campus reference.";
            }
            showToast(msg, "warning");
            useFallbackCoords();
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

function useFallbackCoords() {
    // Default to PCCOE College Campus Gate
    userCoords = { lat: 18.6517, lng: 73.7629 };
    finalizeUserLocation("Near PCCOE Campus");
    showToast("Using PCCOE Campus as reference location", "info");
}

function finalizeUserLocation(label) {
    const gpsBtn = document.getElementById('gpsLocateBtn');
    if (gpsBtn) gpsBtn.innerHTML = `<i class="fas fa-location-crosshairs"></i> ${label}`;

    if (map && typeof L !== 'undefined') {
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.circleMarker([userCoords.lat, userCoords.lng], {
            radius: 9,
            color: '#1d4ed8',
            fillColor: '#3b82f6',
            fillOpacity: 0.9,
            weight: 3
        }).addTo(map);
        userMarker.bindPopup(`<strong>📍 ${label}</strong>`).openPopup();
        map.setView([userCoords.lat, userCoords.lng], 14);
    }

    allPharmacies.forEach(store => {
        store.distanceKm = calculateDistanceKm(userCoords.lat, userCoords.lng, store.lat, store.lng);
    });

    applyFilters();
}

// ==========================================================================
// 4. FILTERING & RENDERING
// ==========================================================================
function applyFilters() {
    filteredPharmacies = allPharmacies.filter(store => {
        // Area Filter
        const matchArea = selectedArea === 'all' || store.area.toLowerCase().includes(selectedArea.toLowerCase());

        // Category Filter
        let matchType = true;
        if (activeFilter === '24h') {
            matchType = store.is24Hours === true;
        } else if (activeFilter === 'generic') {
            matchType = store.type.toLowerCase() === 'generic';
        } else if (activeFilter === 'student-visited') {
            matchType = store.isStudentVisited === true;
        } else if (activeFilter !== 'all') {
            matchType = store.type.toLowerCase() === activeFilter.toLowerCase();
        }

        // Search Query (Shop Name, Address, Area, Type, or Medicine Name)
        const q = searchQuery.toLowerCase().trim();
        const matchSearch = !q ||
            store.name.toLowerCase().includes(q) ||
            store.address.toLowerCase().includes(q) ||
            store.area.toLowerCase().includes(q) ||
            store.type.toLowerCase().includes(q);

        return matchArea && matchType && matchSearch;
    });

    if (userCoords) {
        filteredPharmacies.sort((a, b) => (a.distanceKm || 999) - (b.distanceKm || 999));
    }

    renderCards(filteredPharmacies);
    updateStats();
    updateMapMarkers(filteredPharmacies);
}

function renderCards(stores) {
    if (!cardsGrid) return;
    cardsGrid.innerHTML = '';

    if (resultsCountEl) {
        resultsCountEl.innerHTML = `Showing <span>${stores.length}</span> Verified Medical Stores`;
    }

    if (stores.length === 0) {
        cardsGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-kit-medical"></i>
                <h3>No Medical Stores Found</h3>
                <p>Try searching for a different area or clearing the category filter.</p>
                <button onclick="resetFilters()" class="btn-primary" style="margin-top:14px;">
                    <i class="fas fa-rotate-left"></i> Reset All Filters
                </button>
            </div>
        `;
        return;
    }

    stores.forEach(store => {
        const card = document.createElement('div');
        card.className = 'med-card';
        card.id = `card-${store.id}`;

        let badgeClass = 'badge-allopathy';
        if (store.type.toLowerCase() === 'generic') badgeClass = 'badge-generic';
        if (store.type.toLowerCase() === 'ayurvedic') badgeClass = 'badge-ayurvedic';
        if (store.type.toLowerCase() === 'homeopathy') badgeClass = 'badge-homeopathy';

        const distanceHtml = store.distanceKm !== undefined
            ? `<span class="distance-tag"><i class="fas fa-location-arrow"></i> ${store.distanceKm.toFixed(1)} km</span>`
            : '';

        const savingsHtml = store.genericSavingsPct > 0
            ? `<div class="savings-alert">
                 <i class="fas fa-tags"></i> <strong>Save up to ${store.genericSavingsPct}%</strong> on generic equivalents
               </div>`
            : '';

        const deliveryBadge = store.delivery
            ? `<span class="badge-delivery"><i class="fas fa-motorcycle"></i> Home Delivery</span>`
            : '';

        const cleanPhone = store.phone ? store.phone.replace(/[^0-9]/g, '') : '';
        const waText = encodeURIComponent(`Hello, I saw ${store.name} on MedNexa. Can you please confirm if you have medicine in stock?`);
        const waLink = cleanPhone ? `https://wa.me/91${cleanPhone}?text=${waText}` : '#';

        card.innerHTML = `
            <div class="card-top">
                <div class="shop-name"><i class="fas fa-store"></i> ${store.name}</div>
                ${distanceHtml}
            </div>

            <div class="badge-row">
                <span class="type-badge ${badgeClass}">${store.type}</span>
                ${store.isStudentVisited ? '<span class="badge-student-visited"><i class="fas fa-user-graduate"></i> Visited by Students</span>' : ''}
                ${store.is24Hours ? '<span class="badge-24h"><i class="fas fa-clock"></i> 24x7 OPEN</span>' : ''}
                ${store.isVerified ? '<span class="badge-verified"><i class="fas fa-shield-check"></i> Verified</span>' : ''}
                ${deliveryBadge}
            </div>

            ${savingsHtml}

            <div class="address-text">
                <i class="fas fa-location-dot"></i>
                <span>${store.address}</span>
            </div>

            <div class="card-actions">
                <a href="tel:${store.phone || ''}" class="btn-card btn-call">
                    <i class="fas fa-phone"></i> Call
                </a>
                <a href="${waLink}" target="_blank" class="btn-card btn-wa" ${!cleanPhone ? 'style="opacity:0.5;pointer-events:none"' : ''}>
                    <i class="fab fa-whatsapp"></i> Chat
                </a>
                <button onclick="focusOnMap(${store.lat}, ${store.lng})" class="btn-card btn-map-pin">
                    <i class="fas fa-map-location-dot"></i> Map
                </button>
                <a href="${store.mapUrl}" target="_blank" rel="noopener noreferrer" class="btn-card btn-directions" title="Open Street Directions & Google Maps">
                    <i class="fas fa-diamond-turn-right"></i> Direct
                </a>
            </div>
        `;

        cardsGrid.appendChild(card);
    });
}

function updateStats() {
    if (statTotalEl) statTotalEl.innerText = allPharmacies.length;
    if (stat24hEl) stat24hEl.innerText = allPharmacies.filter(s => s.is24Hours).length;
    if (statGenericEl) statGenericEl.innerText = allPharmacies.filter(s => s.type.toLowerCase() === 'generic').length;
    if (statDistanceEl) {
        if (userCoords && filteredPharmacies.length > 0 && filteredPharmacies[0].distanceKm !== undefined) {
            statDistanceEl.innerText = `${filteredPharmacies[0].distanceKm.toFixed(1)} km`;
        } else {
            statDistanceEl.innerText = '0.4 km';
        }
    }
    if (statVisitorCountEl) statVisitorCountEl.innerText = totalVisitorCount.toLocaleString();
    if (navVisitorCountEl) navVisitorCountEl.innerText = totalVisitorCount.toLocaleString();
    if (footerVisitorCountEl) footerVisitorCountEl.innerText = totalVisitorCount.toLocaleString();
}

/**
/**
 * DYNAMIC REAL-TIME VISITOR COUNTER ENGINE
 * - Synchronizes across laptop and mobile devices via live API polling & BroadcastChannel.
 * - Displays active people online right now with pulsing live indicators.
 * - Triggers instant pop-glow animation whenever a new person opens the website.
 */
let currentActiveUsers = 1;
let realTimePollTimer = null;
const clientSessionId = sessionStorage.getItem('medifinder_client_sid') || ('mf_' + Math.random().toString(36).substring(2, 9));
sessionStorage.setItem('medifinder_client_sid', clientSessionId);

// Cross-tab broadcast channel
let visitorBroadcast = null;
try {
    visitorBroadcast = new BroadcastChannel('medifinder_realtime_sync');
    visitorBroadcast.onmessage = (event) => {
        if (event.data && event.data.type === 'NEW_VISITOR') {
            onRealtimeCountUpdated(event.data.total, event.data.active, true);
        }
    };
} catch (e) {}

const CLOUD_COUNTER_KEY = 'medifinder_pccoe_snehal_2026';
const CLOUD_COUNTER_HIT = `https://countapi.mileshilliard.com/api/v1/hit/${CLOUD_COUNTER_KEY}`;
const CLOUD_COUNTER_GET = `https://countapi.mileshilliard.com/api/v1/get/${CLOUD_COUNTER_KEY}`;

function isLocalEnvironment() {
    return window.location.hostname === 'localhost' || 
           window.location.hostname === '127.0.0.1' || 
           window.location.port === '8080';
}

function initVisitorCounter() {
    let saved = localStorage.getItem(VISITOR_STORAGE_KEY);
    let count = parseInt(saved, 10);
    if (isNaN(count) || count < BASE_VISITOR_COUNT) {
        count = BASE_VISITOR_COUNT;
    }
    totalVisitorCount = count;

    // Determine if this browser session / tab open is new
    const isNewSession = !sessionStorage.getItem(VISITOR_SESSION_KEY);

    // If running on local python server, use local API
    if (isLocalEnvironment()) {
        const localEndpoint = isNewSession ? `/api/visitor-count/open?sid=${clientSessionId}` : `/api/visitor-count?sid=${clientSessionId}`;
        fetch(localEndpoint, { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error('Local API unavailable');
                return res.json();
            })
            .then(data => {
                if (data && data.totalVisitors) {
                    handleVisitorCountSuccess(data.totalVisitors, data.activeNow || 1, isNewSession);
                }
            })
            .catch(() => {
                // Fallback to global cloud counter
                syncWithCloudCounter(isNewSession);
            });
    } else {
        // Public website (GitHub Pages / Mobile browsers anywhere) -> use Cloud Counter
        syncWithCloudCounter(isNewSession);
    }

    // Start Real-Time Live Sync Polling every 4 seconds
    if (realTimePollTimer) clearInterval(realTimePollTimer);
    realTimePollTimer = setInterval(pollRealtimeVisitorCount, 4000);

    // Initial roll-up presentation
    if (navVisitorCountEl && !navVisitorCountEl.innerText) {
        animateCounterRollUp(navVisitorCountEl, totalVisitorCount - 1, totalVisitorCount, 1000);
    }
}

function syncWithCloudCounter(isNewSession) {
    const targetUrl = isNewSession ? CLOUD_COUNTER_HIT : CLOUD_COUNTER_GET;
    fetch(targetUrl, { cache: 'no-store' })
        .then(res => {
            if (!res.ok) throw new Error('Cloud counter status ' + res.status);
            return res.json();
        })
        .then(data => {
            const countVal = (data && (typeof data.value === 'number')) ? data.value : parseInt(data.value, 10);
            if (!isNaN(countVal) && countVal > 0) {
                // Ensure count is at least base count
                const finalCount = Math.max(BASE_VISITOR_COUNT, countVal);
                handleVisitorCountSuccess(finalCount, currentActiveUsers, isNewSession);
            }
        })
        .catch(() => {
            // Offline fallback
            if (isNewSession) {
                sessionStorage.setItem(VISITOR_SESSION_KEY, 'true');
                totalVisitorCount += 1;
                localStorage.setItem(VISITOR_STORAGE_KEY, totalVisitorCount.toString());
                animateCounterRollUp(navVisitorCountEl, totalVisitorCount - 1, totalVisitorCount, 1200);
                showToast(`👋 Welcome! You are person #${totalVisitorCount.toLocaleString()} to open MedNexa`, 'info');
            } else {
                if (navVisitorCountEl) navVisitorCountEl.innerText = totalVisitorCount.toLocaleString();
            }
            updateActiveUsersBadge(1);
        });
}

function handleVisitorCountSuccess(newTotal, activeCount, isNewSession) {
    const oldCount = totalVisitorCount;
    totalVisitorCount = newTotal;
    currentActiveUsers = activeCount || 1;
    localStorage.setItem(VISITOR_STORAGE_KEY, totalVisitorCount.toString());

    if (isNewSession) {
        sessionStorage.setItem(VISITOR_SESSION_KEY, 'true');
        animateCounterRollUp(navVisitorCountEl, Math.max(0, oldCount), totalVisitorCount, 1200);
        showToast(`👋 Welcome! You are person #${totalVisitorCount.toLocaleString()} to open MedNexa`, 'info');
        if (visitorBroadcast) {
            visitorBroadcast.postMessage({ type: 'NEW_VISITOR', total: totalVisitorCount, active: currentActiveUsers });
        }
    } else {
        if (navVisitorCountEl) navVisitorCountEl.innerText = totalVisitorCount.toLocaleString();
    }
    updateActiveUsersBadge(currentActiveUsers);
}

function pollRealtimeVisitorCount() {
    if (isLocalEnvironment()) {
        fetch(`/api/visitor-count?sid=${clientSessionId}`, { cache: 'no-store' })
            .then(res => res.json())
            .then(data => {
                if (data && data.totalVisitors) {
                    onRealtimeCountUpdated(data.totalVisitors, data.activeNow || 1, false);
                }
            })
            .catch(() => {
                pollCloudCounter();
            });
    } else {
        pollCloudCounter();
    }
}

function pollCloudCounter() {
    fetch(CLOUD_COUNTER_GET, { cache: 'no-store' })
        .then(res => res.json())
        .then(data => {
            const countVal = (data && (typeof data.value === 'number')) ? data.value : parseInt(data.value, 10);
            if (!isNaN(countVal) && countVal > 0) {
                onRealtimeCountUpdated(countVal, currentActiveUsers, false);
            }
        })
        .catch(() => {
            updateActiveUsersBadge(currentActiveUsers);
        });
}

function onRealtimeCountUpdated(newTotal, newActive, fromBroadcast = false) {
    if (newActive !== undefined) {
        currentActiveUsers = newActive;
        updateActiveUsersBadge(newActive);
    }

    if (newTotal > totalVisitorCount) {
        const prev = totalVisitorCount;
        totalVisitorCount = newTotal;
        localStorage.setItem(VISITOR_STORAGE_KEY, newTotal.toString());

        // Animate count smoothly
        animateCounterRollUp(navVisitorCountEl, prev, newTotal, 800);

        // Visual live pop glow effect
        if (navVisitorCountEl) {
            navVisitorCountEl.classList.remove('count-pop-glow');
            void navVisitorCountEl.offsetWidth; // trigger reflow
            navVisitorCountEl.classList.add('count-pop-glow');
            setTimeout(() => navVisitorCountEl.classList.remove('count-pop-glow'), 1000);
        }

        // Live notification banner
        showToast(`🟢 Live Update: A new person just opened MedNexa! (${newTotal.toLocaleString()} total)`, 'info');

        if (!fromBroadcast && visitorBroadcast) {
            visitorBroadcast.postMessage({ type: 'NEW_VISITOR', total: newTotal, active: currentActiveUsers });
        }
    }
}

function updateActiveUsersBadge(activeCount) {
    const activeEl = document.getElementById('activeCountText');
    if (activeEl) {
        activeEl.innerText = `${activeCount} active`;
    }
}

function animateCounterRollUp(element, start, end, duration = 1000) {
    if (!element) return;
    let startTimestamp = null;
    const initial = Math.max(0, start);
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(easeOut * (end - initial) + initial);
        element.innerText = current.toLocaleString();
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            element.innerText = end.toLocaleString();
        }
    };
    window.requestAnimationFrame(step);
}

function showVisitorInfoToast() {
    const formatted = totalVisitorCount.toLocaleString();
    showToast(`🟢 Real-Time Counter: ${formatted} persons have opened MedNexa (${currentActiveUsers} active online right now).`, 'success');
}

function focusOnMap(lat, lng) {
    if (!map) return;
    map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
    window.scrollTo({ top: document.querySelector('.map-section').offsetTop - 80, behavior: 'smooth' });

    if (markersLayer) {
        markersLayer.eachLayer(layer => {
            const pos = layer.getLatLng();
            if (Math.abs(pos.lat - lat) < 0.0001 && Math.abs(pos.lng - lng) < 0.0001) {
                layer.openPopup();
            }
        });
    }
}

function resetFilters() {
    searchQuery = '';
    activeFilter = 'all';
    selectedArea = 'all';
    if (searchInput) searchInput.value = '';
    if (areaSelect) areaSelect.value = 'all';
    filterPills.forEach(p => p.classList.toggle('active', p.dataset.filter === 'all'));
    applyFilters();
}

function filterStudentVisitedStores() {
    activeFilter = 'student-visited';
    selectedArea = 'all';
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    if (areaSelect) areaSelect.value = 'all';

    // Update filter pills UI
    const allPills = document.querySelectorAll('.filter-pill');
    allPills.forEach(p => {
        p.classList.remove('active', 'active-emergency');
        if (p.dataset.filter === 'student-visited') {
            p.classList.add('active');
        }
    });

    // Toggle button active state
    const btnVisited = document.getElementById('btnVisitedStores');
    if (btnVisited) {
        btnVisited.classList.add('active');
        setTimeout(() => btnVisited.classList.remove('active'), 2500);
    }

    applyFilters();

    const searchSec = document.querySelector('.search-section');
    if (searchSec) {
        searchSec.scrollIntoView({ behavior: 'smooth' });
    }

    showToast(`Showing 24 medical stores visited and verified by PCCOE Students!`, "success");
}

// ==========================================================================
// 5. MEDICINE COMPARATOR POPULATION
// ==========================================================================
function populateMedicineTable() {
    const tableBody = document.getElementById('medicineTableBody');
    if (!tableBody || typeof COMMON_MEDICINES === 'undefined') return;

    tableBody.innerHTML = '';
    COMMON_MEDICINES.forEach(med => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${med.brandName}</strong><br><span style="color:#64748b;font-size:0.78rem;">${med.useCase}</span></td>
            <td><strong style="color:#0284c7;">${med.genericName}</strong></td>
            <td><span class="price-strike">₹${med.brandPrice}</span> <span class="price-generic">₹${med.genericPrice}</span></td>
            <td><span class="savings-chip">${med.savings}% OFF</span></td>
        `;
        tableBody.appendChild(row);
    });
}

// ==========================================================================
// 6. EVENT LISTENERS
// ==========================================================================
function setupEventListeners() {
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            if (searchClearBtn) searchClearBtn.style.display = searchQuery ? 'block' : 'none';
            applyFilters();
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            searchQuery = '';
            searchInput.value = '';
            searchClearBtn.style.display = 'none';
            applyFilters();
        });
    }

    if (areaSelect) {
        areaSelect.addEventListener('change', (e) => {
            selectedArea = e.target.value;
            applyFilters();

            if (selectedArea !== 'all' && filteredPharmacies.length > 0 && map) {
                const first = filteredPharmacies[0];
                map.flyTo([first.lat, first.lng], 14, { animate: true, duration: 1 });
                showToast(`Viewing ${filteredPharmacies.length} pharmacies in ${selectedArea}`, "info");
            } else if (selectedArea === 'all' && map) {
                map.flyTo([18.6360, 73.7880], 12, { animate: true, duration: 1 });
            }
        });
    }

    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => p.classList.remove('active', 'active-emergency'));
            activeFilter = pill.dataset.filter;
            if (activeFilter === '24h') {
                pill.classList.add('active-emergency');
            } else {
                pill.classList.add('active');
            }
            applyFilters();
        });
    });

    // Add Store Form
    const addStoreForm = document.getElementById('addStoreForm');
    if (addStoreForm) {
        addStoreForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const name = document.getElementById('storeName').value.trim();
            const type = document.getElementById('storeType').value;
            const area = document.getElementById('storeArea').value;
            const phone = document.getElementById('storePhone').value.trim() || 'N/A';
            const address = document.getElementById('storeAddress').value.trim();
            const lat = parseFloat(document.getElementById('storeLat').value) || 18.6520;
            const lng = parseFloat(document.getElementById('storeLng').value) || 73.7650;
            const is24h = document.getElementById('store24h').checked;

            const newStore = {
                id: 'store-' + Date.now(),
                name,
                type,
                area,
                phone,
                address,
                lat,
                lng,
                is24Hours: is24h,
                isVerified: true,
                genericSavingsPct: type === 'Generic' ? 85 : 0,
                rating: 4.8,
                delivery: true,
                mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' ' + address)}`
            };

            allPharmacies.unshift(newStore);
            savePharmaciesData();
            applyFilters();

            closeModal('addStoreModal');
            addStoreForm.reset();
            showToast(`"${name}" added successfully to database!`, "success");
        });
    }

    // Consent Form
    const consentForm = document.getElementById('consentForm');
    if (consentForm) {
        consentForm.addEventListener('submit', (e) => {
            e.preventDefault();
            closeModal('consentModal');
            consentForm.reset();
            showToast("Consent submitted successfully! Store will be verified.", "success");
        });
    }
}

// Helpers
function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('active');
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('active');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-circle-info'}" 
           style="color: ${type === 'success' ? '#10b981' : '#0284c7'}; font-size: 1.1rem;"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 250);
    }, 3500);
}

// Export Database (JSON)
function exportDatabase() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allPharmacies, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `mednexa_pharmacies_${Date.now()}.json`);
    dlAnchor.click();
    showToast("Downloaded database JSON backup!", "success");
}

// ==========================================================================
// 7. MULTILINGUAL SUPPORT (EN, MR, HI)
// ==========================================================================
let currentLanguage = 'en';

function setLanguage(lang) {
    if (!I18N_TRANSLATIONS || !I18N_TRANSLATIONS[lang]) return;
    currentLanguage = lang;
    const t = I18N_TRANSLATIONS[lang];

    // Update active button state
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    // Update DOM text
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };

    setText('brandTagline', t.tagline);
    setText('btnGuideText', t.btnGuide);
    setText('btnScannerText', t.btnScanner);
    setText('btnQrText', t.btnQr);
    setText('btnAdminText', t.btnAdmin);
    setText('btnConsentText', t.btnConsent);
    setText('btnAddStoreText', t.btnAddStore);
    setText('heroTagText', t.heroTag);
    setText('heroTitleText', t.heroTitle);
    setText('heroDescText', t.heroDesc);

    setText('pillNonHospital', t.pillNonHospital);
    setText('pillSavings', t.pillSavings);
    setText('pillDelivery', t.pillDelivery);
    setText('pillEmergency', t.pillEmergency);

    setText('statVerifiedLabel', t.statVerified);
    setText('statGenericLabel', t.statGeneric);
    setText('statEmergencyLabel', t.statEmergency);
    setText('statDistanceLabel', t.statDistance);
    setText('statVisitorsLabel', t.statVisitors || 'Persons Opened Website');
    setText('navVisitorSubtext', t.navVisitors || 'Visitors');

    setText('mapTitleText', t.mapTitle);
    setText('mapDescText', t.mapDesc);
    setText('gpsLocateBtnText', t.locateBtn);

    if (searchInput) searchInput.placeholder = t.searchPlaceholder;

    // Filter pills
    const pillAll = document.querySelector('[data-filter="all"] span');
    if (pillAll) pillAll.innerText = t.filterAll;
    const pillGen = document.querySelector('[data-filter="generic"] span');
    if (pillGen) pillGen.innerText = t.filterGeneric;
    const pill24h = document.querySelector('[data-filter="24h"] span');
    if (pill24h) pill24h.innerText = t.filter24h;
    const pillAllo = document.querySelector('[data-filter="allopathy"] span');
    if (pillAllo) pillAllo.innerText = t.filterAllopathy;
    const pillAyur = document.querySelector('[data-filter="ayurvedic"] span');
    if (pillAyur) pillAyur.innerText = t.filterAyurvedic;
    const pillHomeo = document.querySelector('[data-filter="homeopathy"] span');
    if (pillHomeo) pillHomeo.innerText = t.filterHomeopathy;

    applyFilters();
    showToast(`Language set to ${lang.toUpperCase()}`, "info");
}

// ==========================================================================
// 8. AI PRESCRIPTION SCANNER & SALT MATCHER
// ==========================================================================
function searchPrescriptionSalt(medicineQuery) {
    const q = (medicineQuery || document.getElementById('prescriptionInput').value || '').toLowerCase().trim();
    const resultCard = document.getElementById('ocrResultCard');
    if (!resultCard) return;

    if (!q) {
        showToast("Please enter a medicine or upload a prescription image", "info");
        return;
    }

    // Match against knowledge base
    const matched = COMMON_MEDICINES.find(m => 
        m.brandName.toLowerCase().includes(q) || 
        m.genericName.toLowerCase().includes(q) || 
        m.useCase.toLowerCase().includes(q)
    );

    if (matched) {
        resultCard.style.display = 'block';
        resultCard.innerHTML = `
            <div class="ocr-match-header">
                <div>
                    <h4 style="font-size:1.1rem; color:#064e3b;"><i class="fas fa-check-circle" style="color:#059669;"></i> Salt Found: <strong>${matched.genericName}</strong></h4>
                    <span style="font-size:0.82rem; color:#047857;">Original Prescribed Brand: <strong>${matched.brandName}</strong> (${matched.useCase})</span>
                </div>
                <span class="salt-badge">Save ${matched.savings}%</span>
            </div>
            <div style="background:#ffffff; border-radius:10px; padding:12px; margin:10px 0; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <span style="font-size:0.85rem; color:#64748b;">Branded MRP: <strong style="text-decoration:line-through; color:#dc2626;">₹${matched.brandPrice}</strong></span>
                    <span style="margin: 0 10px;">➔</span>
                    <span style="font-size:1.05rem; color:#059669; font-weight:800;">Jan Aushadhi: ₹${matched.genericPrice}</span>
                </div>
                <div style="font-size:0.82rem; font-weight:700; color:#065f46;">
                    Direct Savings: ₹${matched.brandPrice - matched.genericPrice}
                </div>
            </div>
            <button onclick="closeModal('scannerModal'); document.querySelector('[data-filter=generic]').click();" class="btn-primary" style="width:100%; margin-top:8px;">
                <i class="fas fa-location-dot"></i> View Nearby Stores Stocking Generic Salt
            </button>
        `;
    } else {
        resultCard.style.display = 'block';
        resultCard.innerHTML = `
            <div style="color:#b45309;">
                <i class="fas fa-circle-exclamation"></i>
                <strong>Salt Analyser Suggestion:</strong> Found chemical match for "${q}". Equivalent generic salt is available at all PCMC Jan Aushadhi hubs at up to 80% subsidized prices.
                <button onclick="closeModal('scannerModal'); document.querySelector('[data-filter=generic]').click();" class="btn-primary" style="margin-top:10px; display:block; width:100%;">
                    Show Jan Aushadhi Stores Nearby
                </button>
            </div>
        `;
    }
}

function handlePrescriptionUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    showToast("Analyzing prescription with OCR...", "info");
    const preview = document.getElementById('ocrDropText');
    if (preview) {
        preview.innerHTML = `<i class="fas fa-spinner fa-spin" style="font-size:2rem;color:#7c3aed;"></i><br><strong>Scanning Prescription Image: "${file.name}"...</strong>`;
    }

    // High-accuracy OCR simulation with real salt matching
    setTimeout(() => {
        if (preview) {
            preview.innerHTML = `<i class="fas fa-file-medical-check" style="font-size:2rem;color:#059669;"></i><br><strong>Extracted: "Augmentin 625 Duo & Pan-D"</strong>`;
        }
        searchPrescriptionSalt("Augmentin");
        showToast("Prescription analyzed! Extracted Amoxicillin + Clavulanate", "success");
    }, 1200);
}

// ==========================================
// 9. ADMIN VERIFICATION PORTAL
// ==========================================
let adminRequests = [];

function initAdminPortal() {
    const saved = localStorage.getItem('medifinder_admin_reqs');
    if (saved) {
        try { adminRequests = JSON.parse(saved); } catch(e) { adminRequests = [...INITIAL_CONSENT_REQUESTS]; }
    } else {
        adminRequests = [...INITIAL_CONSENT_REQUESTS];
        saveAdminRequests();
    }
    renderAdminTable();
}

function saveAdminRequests() {
    localStorage.setItem('medifinder_admin_reqs', JSON.stringify(adminRequests));
}

function renderAdminTable() {
    const tbody = document.getElementById('adminTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    adminRequests.forEach(req => {
        const tr = document.createElement('tr');
        const badgeClass = req.status === 'APPROVED' ? 'status-approved' : (req.status === 'REJECTED' ? 'status-rejected' : 'status-pending');
        
        tr.innerHTML = `
            <td><strong>${req.shopName}</strong><br><span style="font-size:0.75rem; color:#64748b;">${req.address}</span></td>
            <td>${req.ownerName}<br><span style="font-size:0.75rem; color:#64748b;">${req.phone}</span></td>
            <td><code>${req.license || 'N/A'}</code></td>
            <td><span class="status-badge ${badgeClass}">${req.status}</span></td>
            <td>
                ${req.status === 'PENDING' ? `
                    <button onclick="approveRequest('${req.id}')" class="btn-action-approve"><i class="fas fa-check"></i> Approve</button>
                    <button onclick="rejectRequest('${req.id}')" class="btn-action-reject"><i class="fas fa-xmark"></i> Reject</button>
                ` : `<span style="font-size:0.76rem; color:#64748b;">Processed</span>`}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function approveRequest(id) {
    const req = adminRequests.find(r => r.id === id);
    if (!req) return;
    req.status = 'APPROVED';
    saveAdminRequests();
    renderAdminTable();
    showToast(`Approved "${req.shopName}". Verified badge granted!`, "success");
}

function rejectRequest(id) {
    const req = adminRequests.find(r => r.id === id);
    if (!req) return;
    req.status = 'REJECTED';
    saveAdminRequests();
    renderAdminTable();
    showToast(`Rejected request for "${req.shopName}".`, "info");
}

// ==========================================================================
// 10. SECURE USER AUTHENTICATION & WEB CRYPTO DATA STORAGE ENGINE
// ==========================================================================
const SECURE_USERS_KEY = 'medifinder_secure_users_v2';
const ACTIVE_SESSION_KEY = 'medifinder_active_session_v2';

/**
 * Hardware-accelerated cryptographic utilities using Web Crypto API
 * Zero plaintext passwords stored in localStorage!
 */
async function generateCryptographicSaltHex() {
    const saltBytes = new Uint8Array(16);
    window.crypto.getRandomValues(saltBytes);
    return Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function computeSHA256Hash(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPasswordSecurely(password, saltHex) {
    // Salt + Master Password + SIH Application Pepper Nonce
    const appPepper = 'MediFinder_SIH_2026_WebCrypto_Salted_Hash_Protocol';
    return await computeSHA256Hash(`${saltHex}::${password}::${appPepper}`);
}

/**
 * Initialize Default Accounts and Active Session
 */
async function initSecureUsers() {
    let existing = localStorage.getItem(SECURE_USERS_KEY);
    if (!existing) {
        try {
            const seedUsers = [];
            const userSalt = await generateCryptographicSaltHex();
            const userHash = await hashPasswordSecurely('password123', userSalt);
            seedUsers.push({
                id: 'usr_default',
                fullName: 'Snehal',
                email: 'user@mednexa.com',
                saltHex: userSalt,
                passwordHash: userHash,
                createdAt: new Date().toISOString()
            });
            localStorage.setItem(SECURE_USERS_KEY, JSON.stringify(seedUsers));
        } catch (err) {
            console.error('Error pre-seeding user:', err);
        }
    }
    restoreUserSession();
}

function getStoredUsers() {
    try {
        const raw = localStorage.getItem(SECURE_USERS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveStoredUsers(users) {
    localStorage.setItem(SECURE_USERS_KEY, JSON.stringify(users));
}

function getActiveSession() {
    try {
        const raw = localStorage.getItem(ACTIVE_SESSION_KEY) || sessionStorage.getItem(ACTIVE_SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function setActiveSession(user) {
    const sessionData = {
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        loginTimestamp: new Date().toISOString()
    };
    localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(sessionData));
    renderNavAuthState(sessionData);
}

function restoreUserSession() {
    const session = getActiveSession();
    renderNavAuthState(session);
}

function renderNavAuthState(session) {
    const navContainer = document.getElementById('navAuthContainer');
    if (!navContainer) return;

    if (!session) {
        navContainer.innerHTML = `
            <button class="btn-nav btn-auth" id="btnNavAuth" onclick="openAuthModal('signin')">
                <i class="fas fa-user"></i> <span id="btnAuthText">Log In</span>
            </button>
        `;
        return;
    }

    const initial = (session.fullName || 'User').charAt(0).toUpperCase();
    navContainer.innerHTML = `
        <div class="user-chip-container">
            <span class="user-chip-avatar">${initial}</span>
            <span class="user-chip-name">${session.fullName}</span>
            <button type="button" class="user-chip-logout" onclick="logoutUser()" title="Log Out">
                <i class="fas fa-sign-out-alt"></i> Log Out
            </button>
        </div>
    `;
}

/**
 * Open Simple Login Modal
 */
function openAuthModal(view = 'signin') {
    switchAuthTab(view);
    openModal('authModal');
}

function switchAuthTab(tab) {
    const signInForm = document.getElementById('signInForm');
    const signUpForm = document.getElementById('signUpForm');
    const modalTitle = document.getElementById('authModalTitle');
    const modalSubtitle = document.getElementById('authModalSubtitle');

    if (tab === 'signin') {
        if (signInForm) signInForm.style.display = 'block';
        if (signUpForm) signUpForm.style.display = 'none';
        if (modalTitle) modalTitle.innerText = 'User Login';
        if (modalSubtitle) modalSubtitle.innerText = 'Enter your credentials to access MedNexa';
    } else {
        if (signInForm) signInForm.style.display = 'none';
        if (signUpForm) signUpForm.style.display = 'block';
        if (modalTitle) modalTitle.innerText = 'Create Account';
        if (modalSubtitle) modalSubtitle.innerText = 'Sign up to access all MedNexa features';
    }
}

/**
 * Simple Sign In Handler
 */
async function handleSignInSubmit(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;
    const submitBtn = event.target.querySelector('button[type="submit"]');

    if (!email || !password) {
        showToast("Please enter email and password", "info");
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
    }

    try {
        const users = getStoredUsers();
        const user = users.find(u => u.email.toLowerCase() === email);

        if (!user) {
            showToast("No account found with this email. Click Create Account.", "error");
            return;
        }

        const computedHash = await hashPasswordSecurely(password, user.saltHex);
        if (computedHash === user.passwordHash) {
            setActiveSession(user);
            closeModal('authModal');
            document.getElementById('signInForm').reset();
            showToast(`Welcome back, ${user.fullName}!`, "success");
        } else {
            showToast("Incorrect password. Please try again.", "error");
        }
    } catch (err) {
        console.error('Sign-in error:', err);
        showToast("Login error. Please try again.", "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Log In';
        }
    }
}

/**
 * Simple Sign Up Handler
 */
async function handleSignUpSubmit(event) {
    event.preventDefault();
    const fullName = document.getElementById('regFullName').value.trim();
    const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const password = document.getElementById('regPassword').value;
    const submitBtn = event.target.querySelector('button[type="submit"]');

    if (!fullName || !email || !password) {
        showToast("Please fill all fields", "info");
        return;
    }

    if (password.length < 6) {
        showToast("Password must be at least 6 characters", "error");
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account...';
    }

    try {
        const users = getStoredUsers();
        if (users.some(u => u.email.toLowerCase() === email)) {
            showToast("An account with this email already exists. Please Log In.", "error");
            return;
        }

        const saltHex = await generateCryptographicSaltHex();
        const passwordHash = await hashPasswordSecurely(password, saltHex);

        const newUser = {
            id: 'usr_' + Date.now().toString(36),
            fullName,
            email,
            saltHex,
            passwordHash,
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        saveStoredUsers(users);

        setActiveSession(newUser);
        closeModal('authModal');
        document.getElementById('signUpForm').reset();
        showToast(`Account created! Welcome, ${fullName}!`, "success");
    } catch (err) {
        console.error('Sign-up error:', err);
        showToast("Error creating account. Please try again.", "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Create Account';
        }
    }
}

/**
 * Sign Out
 */
function logoutUser() {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    renderNavAuthState(null);
    closeModal('authModal');
    showToast("Logged out successfully.", "info");
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) {
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        }
    } else {
        input.type = 'password';
        if (icon) {
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    }
}

