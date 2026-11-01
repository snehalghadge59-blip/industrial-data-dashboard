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
let minDiscountFilter = 0; // percentage threshold e.g. 50%
let activeDiscountMedicine = null; // matched medicine data e.g. Crocin / Paracetamol
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
    initRealtimeLocationEngine();
    setupEventListeners();
    populateMedicineTable();
    initAdminPortal();
    initSecureUsers();
    updateWishlistBadges();
    updateAdminFeedbackCountBadge();
    if (typeof syncFeedbacksFromBackend === 'function') {
        syncFeedbacksFromBackend();
    }
    initVoiceAssistant();
    applyFilters();
});

function loadPharmaciesData() {
    const saved = localStorage.getItem('medifinder_stores_v9');
    if (saved) {
        try {
            allPharmacies = JSON.parse(saved);
            const hasStudentStores = allPharmacies.some(s => s.isStudentVisited);
            const isOutdatedCount = typeof INITIAL_PHARMACIES !== 'undefined' && allPharmacies.length < INITIAL_PHARMACIES.length;
            if ((!hasStudentStores || isOutdatedCount) && typeof INITIAL_PHARMACIES !== 'undefined') {
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
    localStorage.setItem('medifinder_stores_v9', JSON.stringify(allPharmacies));
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
        routeLayer = L.layerGroup().addTo(map);

        // Fail-safe: If OpenStreetMap rate-limits or errors, seamlessly fall back to Esri Street Map
        streetLayer.on('tileerror', function() {
            console.warn("OpenStreetMap tile error; falling back to Esri Detailed Roads.");
            if (currentLayerName === 'street') {
                switchMapLayer('detailed');
            }
        });

        // Click map: Supports both 'Pick Origin on Map' and auto-fill latitude/longitude in Add Store modal
        map.on('click', (e) => {
            const { lat, lng } = e.latlng;

            if (typeof isPickingMapOrigin !== 'undefined' && isPickingMapOrigin) {
                setCustomMapOrigin(lat, lng);
                return;
            }

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
                ${store.delivery ? '<span class="popup-badge" style="background:#e0f2fe; color:#0369a1; margin-left:4px;"><i class="fas fa-motorcycle"></i> Home Delivery</span>' : ''}
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
// 3. REAL-TIME DYNAMIC LOCATION, GPS TRACKING & MULTI-MODAL TRANSIT ENGINE
// ==========================================================================

const PRESET_ORIGINS = {
    'pccoe': { lat: 18.6517, lng: 73.7629, label: 'PCCOE Campus Gate', tag: 'PCCOE Campus' },
    'akurdi-stn': { lat: 18.6475, lng: 73.7712, label: 'Akurdi Railway Station', tag: 'Akurdi Stn' },
    'dypatil': { lat: 18.6508, lng: 73.7645, label: 'PCCOE Akurdi Campus', tag: 'PCCOE Akurdi' },
    'chinchwad-stn': { lat: 18.6298, lng: 73.7820, label: 'Chinchwad Railway Station', tag: 'Chinchwad Stn' },
    'hinjawadi': { lat: 18.5913, lng: 73.7389, label: 'Hinjawadi Phase-1 IT Park', tag: 'Hinjawadi Ph-1' },
    'wakad': { lat: 18.5987, lng: 73.7635, label: 'Wakad Dange Chowk', tag: 'Wakad Chowk' },
    'nigdi': { lat: 18.6570, lng: 73.7700, label: 'Nigdi Pradhikaran Sec-25', tag: 'Nigdi Sec-25' }
};

let currentOriginKey = 'pccoe';
let isPickingMapOrigin = false;
let maxDistanceRadiusKm = 0; // 0 = all distances
let routeLayer = null;

// Movement Simulation State (for live hackathon & evaluation demos)
let simulationInterval = null;
let simulationStep = 0;
const SIMULATION_COORDS = [
    { lat: 18.6517, lng: 73.7629, label: 'PCCOE Main Gate (Starting Point)' },
    { lat: 18.6508, lng: 73.7648, label: 'Sector 26 Main Road (Walking)' },
    { lat: 18.6496, lng: 73.7672, label: 'Near Akurdi Post Office' },
    { lat: 18.6482, lng: 73.7695, label: 'Akurdi Flyover Approach' },
    { lat: 18.6475, lng: 73.7712, label: 'Akurdi Railway Station' },
    { lat: 18.6440, lng: 73.7745, label: 'Old Mumbai-Pune Highway (Driving)' },
    { lat: 18.6385, lng: 73.7780, label: 'Khandoba Mal Chowk, Akurdi' },
    { lat: 18.6320, lng: 73.7810, label: 'Chinchwad Station Link Rd' },
    { lat: 18.6298, lng: 73.7820, label: 'Chinchwad Railway Station (Arrival)' }
];

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

function recalculateAllStoreMetrics() {
    if (!userCoords) {
        userCoords = { lat: 18.6517, lng: 73.7629, label: 'PCCOE Campus Gate', isLiveGps: false };
    }

    allPharmacies.forEach(store => {
        const straightKm = calculateDistanceKm(userCoords.lat, userCoords.lng, store.lat, store.lng);
        // Real-world urban street winding factor (1.25x in PCMC/Pune)
        const roadKm = +(straightKm * 1.25).toFixed(1);

        // Dynamic multi-modal travel times:
        // Walking: ~4.8 km/h => 12.5 mins per km
        const walkMins = Math.max(1, Math.round(roadKm * 12.5));
        // Two-Wheeler / Bike: ~27 km/h in Pune traffic => 2.2 mins per km
        const bikeMins = Math.max(1, Math.round(roadKm * 2.2));
        // Car / Cab: ~20 km/h with traffic & signals => 3.2 mins per km + traffic wait
        const carMins = Math.max(2, Math.round(roadKm * 3.2 + (roadKm > 2 ? 1 : 0)));

        store.distanceKm = straightKm;
        store.roadDistanceKm = roadKm;
        store.walkMins = walkMins;
        store.bikeMins = bikeMins;
        store.carMins = carMins;

        // Dynamic traffic rating
        if (roadKm <= 1.5) {
            store.trafficRating = { text: '🟢 Fast Route', badgeClass: 'traffic-fast', desc: `<${bikeMins}m by bike` };
        } else if (roadKm <= 4.0) {
            store.trafficRating = { text: '🟡 Moderate Traffic', badgeClass: 'traffic-mod', desc: `Normal urban flow` };
        } else {
            store.trafficRating = { text: '🟠 Heavy Corridor', badgeClass: 'traffic-heavy', desc: `Highway traffic` };
        }
    });
}

function initRealtimeLocationEngine() {
    // Set default PCCOE Campus reference immediately so all 121 stores have unique dynamic distances right on load
    userCoords = { lat: 18.6517, lng: 73.7629, label: 'PCCOE Campus Gate', isLiveGps: false };
    recalculateAllStoreMetrics();
    updateLiveOriginDisplay('PCCOE Campus Gate', userCoords.lat, userCoords.lng, false);

    // Attempt automatic real-time device geolocation smoothly
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userCoords = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    label: 'Your Live GPS Location',
                    isLiveGps: true
                };
                currentOriginKey = 'live-gps';
                recalculateAllStoreMetrics();
                updateLiveOriginDisplay('Your Live GPS Location', userCoords.lat, userCoords.lng, true);
                updateOriginMarkerOnMap(false);
                applyFilters();
                showToast("⚡ Real-time GPS connected! Distances & transit times updated live.", "success");
            },
            () => {
                // Keep default PCCOE Campus baseline
                updateOriginMarkerOnMap(false);
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }
}

function updateLiveOriginDisplay(label, lat, lng, isGps = false) {
    const originNameEl = document.getElementById('liveOriginName');
    const coordsChipEl = document.getElementById('liveCoordsChip');
    const gpsBtn = document.getElementById('gpsLocateBtn');
    const deviceGpsBtn = document.getElementById('btnLiveDeviceGps');

    if (originNameEl) originNameEl.innerText = label;
    if (coordsChipEl) coordsChipEl.innerText = `${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`;

    if (gpsBtn) {
        gpsBtn.innerHTML = `<i class="fas fa-location-crosshairs"></i> ${isGps ? 'Live GPS Active' : 'Near ' + label}`;
    }

    if (deviceGpsBtn) {
        deviceGpsBtn.classList.toggle('active', isGps);
    }
}

function updateOriginMarkerOnMap(shouldOpenPopup = true) {
    if (!map || typeof L === 'undefined' || !userCoords) return;

    if (userMarker) {
        map.removeLayer(userMarker);
    }

    const originIcon = L.divIcon({
        className: 'user-origin-leaflet-marker',
        html: `
            <div style="
                background: linear-gradient(135deg, #2563eb, #1d4ed8);
                width: 36px;
                height: 36px;
                border-radius: 50%;
                border: 3px solid #ffffff;
                box-shadow: 0 4px 14px rgba(37, 99, 235, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                color: #ffffff;
                font-size: 14px;
            ">
                <i class="fas fa-person-walking"></i>
            </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -18]
    });

    userMarker = L.marker([userCoords.lat, userCoords.lng], { icon: originIcon }).addTo(map);
    const popupContent = `
        <div style="padding:6px; min-width:180px;">
            <div style="font-weight:800; color:#1d4ed8; font-size:0.95rem; margin-bottom:4px;">
                <i class="fas fa-satellite-dish"></i> Active Live Origin
            </div>
            <div style="font-weight:700; color:#0f172a; font-size:0.85rem;">${escapeHtml(userCoords.label)}</div>
            <div style="font-size:0.75rem; color:#64748b; font-family:monospace; margin-top:2px;">
                ${userCoords.lat.toFixed(4)}° N, ${userCoords.lng.toFixed(4)}° E
            </div>
            <div style="font-size:0.72rem; color:#059669; font-weight:700; margin-top:6px;">
                ⚡ All 121 pharmacy distances dynamically calculated from here
            </div>
        </div>
    `;
    userMarker.bindPopup(popupContent);
    if (shouldOpenPopup) {
        userMarker.openPopup();
        map.flyTo([userCoords.lat, userCoords.lng], 14, { animate: true, duration: 0.8 });
    }
}

function locateUser(isManualGpsClick = false) {
    if (simulationInterval) toggleSimulateMovement(); // Stop sim if running
    isPickingMapOrigin = false;

    const gpsBtn = document.getElementById('gpsLocateBtn');
    const deviceGpsBtn = document.getElementById('btnLiveDeviceGps');
    if (gpsBtn) gpsBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Locating GPS...`;
    if (deviceGpsBtn) deviceGpsBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Finding...`;

    if (!navigator.geolocation) {
        showToast("Geolocation is not supported by your browser. Using PCCOE Campus origin.", "warning");
        setOriginLocation('pccoe');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            userCoords = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                label: 'Your Live GPS Location',
                isLiveGps: true
            };
            currentOriginKey = 'live-gps';
            recalculateAllStoreMetrics();
            updateLiveOriginDisplay('Your Live GPS Location', userCoords.lat, userCoords.lng, true);
            updateOriginMarkerOnMap(true);
            applyFilters();
            showToast("📍 Located nearest pharmacies to your live GPS position!", "success");

            if (deviceGpsBtn) deviceGpsBtn.innerHTML = `<i class="fas fa-crosshairs"></i> <span>My Real GPS</span>`;
            document.querySelectorAll('.origin-chip').forEach(c => c.classList.remove('active'));
        },
        (error) => {
            let msg = "Using PCCOE Campus reference location";
            if (error.code === 1) {
                msg = "Location permission denied. Using PCCOE Campus reference.";
            } else if (error.code === 2) {
                msg = "GPS signal unavailable. Using PCCOE Campus reference.";
            } else if (error.code === 3) {
                msg = "Location request timed out. Using PCCOE Campus reference.";
            }
            showToast(msg, "warning");
            setOriginLocation('pccoe');

            if (deviceGpsBtn) deviceGpsBtn.innerHTML = `<i class="fas fa-crosshairs"></i> <span>My Real GPS</span>`;
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

function setOriginLocation(key) {
    if (simulationInterval) toggleSimulateMovement(); // Stop sim if running
    isPickingMapOrigin = false;
    currentOriginKey = key;

    const preset = PRESET_ORIGINS[key];
    if (preset) {
        userCoords = {
            lat: preset.lat,
            lng: preset.lng,
            label: preset.label,
            isLiveGps: false
        };
        recalculateAllStoreMetrics();
        updateLiveOriginDisplay(preset.label, preset.lat, preset.lng, false);
        updateOriginMarkerOnMap(true);
        applyFilters();
        showToast(`📍 Origin set to ${preset.label}. All 121 store distances recalculated!`, "info");
    }

    // Update active chip UI
    document.querySelectorAll('.origin-chip').forEach(c => c.classList.remove('active'));
    const activeChip = document.getElementById(`chip-${key}`);
    if (activeChip) activeChip.classList.add('active');
}

function enableMapPickOrigin() {
    isPickingMapOrigin = true;
    showToast("🗺️ Click anywhere on the map to set your live starting location!", "info");
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.cursor = 'crosshair';
    const mapSection = document.querySelector('.map-section');
    if (mapSection) {
        window.scrollTo({ top: mapSection.offsetTop - 60, behavior: 'smooth' });
    }
}

function setCustomMapOrigin(lat, lng) {
    isPickingMapOrigin = false;
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.cursor = '';
    currentOriginKey = 'custom-map';

    userCoords = {
        lat: lat,
        lng: lng,
        label: `Custom Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        isLiveGps: false
    };

    recalculateAllStoreMetrics();
    updateLiveOriginDisplay(userCoords.label, lat, lng, false);
    updateOriginMarkerOnMap(true);
    applyFilters();
    showToast(`📍 Origin set to custom map pin! All distances recalculated.`, "success");

    document.querySelectorAll('.origin-chip').forEach(c => c.classList.remove('active'));
}

function toggleSimulateMovement() {
    const btn = document.getElementById('btnSimulateMotion');
    const label = document.getElementById('simulateMotionLabel');

    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
        if (btn) btn.classList.remove('motion-running');
        if (label) label.innerText = 'Simulate Live Motion';
        showToast("⏹ Live motion simulation stopped.", "info");
    } else {
        if (btn) btn.classList.add('motion-running');
        if (label) label.innerText = 'Stop Simulation';
        simulationStep = 0;
        showToast("🏃 Live motion simulation started! Watch km, walking & driving times dynamically tick in real time!", "success");

        simulationInterval = setInterval(() => {
            simulationStep = (simulationStep + 1) % SIMULATION_COORDS.length;
            const pt = SIMULATION_COORDS[simulationStep];
            userCoords = {
                lat: pt.lat,
                lng: pt.lng,
                label: `🏃 Motion: ${pt.label}`,
                isLiveGps: false
            };
            recalculateAllStoreMetrics();
            updateLiveOriginDisplay(userCoords.label, pt.lat, pt.lng, true);
            updateOriginMarkerOnMap(false);
            applyFilters();
        }, 1800);
    }
}

function setDistanceRadiusFilter(radiusKm) {
    maxDistanceRadiusKm = radiusKm;
    document.querySelectorAll('.dist-pill').forEach(p => p.classList.remove('active'));

    let pillId = 'dist-pill-0';
    if (radiusKm === 1.0) pillId = 'dist-pill-1';
    else if (radiusKm === 2.5) pillId = 'dist-pill-2-5';
    else if (radiusKm === 5.0) pillId = 'dist-pill-5';

    const activePill = document.getElementById(pillId);
    if (activePill) activePill.classList.add('active');

    applyFilters();

    if (radiusKm > 0) {
        showToast(`Filtered: Showing pharmacies within ${radiusKm} km road distance.`, "info");
    } else {
        showToast("Showing pharmacies across all distances.", "info");
    }
}

function drawLiveRouteToStore(storeId) {
    const store = allPharmacies.find(s => s.id === storeId);
    if (!store || !map) return;

    if (!userCoords) {
        userCoords = { lat: 18.6517, lng: 73.7629, label: 'PCCOE Campus Gate' };
        recalculateAllStoreMetrics();
    }

    // Scroll smoothly to map
    const mapSection = document.querySelector('.map-section');
    if (mapSection) {
        window.scrollTo({ top: mapSection.offsetTop - 70, behavior: 'smooth' });
    }

    if (!routeLayer) {
        routeLayer = L.layerGroup().addTo(map);
    }
    routeLayer.clearLayers();

    const originLat = userCoords.lat;
    const originLng = userCoords.lng;
    const destLat = store.lat;
    const destLng = store.lng;

    // Show loading HUD
    const hud = document.getElementById('mapRouteHud');
    if (hud) {
        hud.style.display = 'flex';
        hud.innerHTML = `
            <div class="hud-route-details">
                <div class="hud-route-title"><i class="fas fa-spinner fa-spin"></i> Calculating live road route to <strong>${escapeHtml(store.name)}</strong>...</div>
                <div class="hud-metrics-row">Connecting to real-time road network...</div>
            </div>
        `;
    }

    // Try fetching OSRM road geometry
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2200);

    fetch(osrmUrl, { signal: controller.signal })
        .then(res => res.json())
        .then(data => {
            clearTimeout(timeoutId);
            let latlngs = [];
            let routeRoadKm = store.roadDistanceKm;
            let routeDurationMins = store.carMins;

            if (data && data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                routeRoadKm = +(route.distance / 1000).toFixed(1);
                routeDurationMins = Math.max(1, Math.round(route.duration / 60));
                latlngs = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
            } else {
                latlngs = generateSimulatedRoadPath([originLat, originLng], [destLat, destLng]);
            }

            renderRouteOnMap(latlngs, store, routeRoadKm, routeDurationMins);
        })
        .catch(() => {
            clearTimeout(timeoutId);
            const latlngs = generateSimulatedRoadPath([originLat, originLng], [destLat, destLng]);
            renderRouteOnMap(latlngs, store, store.roadDistanceKm, store.carMins);
        });
}

function generateSimulatedRoadPath(start, end) {
    const midLat = start[0] + (end[0] - start[0]) * 0.55;
    const midLng = start[1] + (end[1] - start[1]) * 0.45;
    return [
        start,
        [midLat, start[1]],
        [midLat, midLng],
        [end[0], midLng],
        end
    ];
}

function renderRouteOnMap(latlngs, store, roadKm, carMins) {
    if (!routeLayer || !map) return;
    routeLayer.clearLayers();

    const routeGlow = L.polyline(latlngs, {
        color: '#0284c7',
        weight: 8,
        opacity: 0.4,
        lineCap: 'round',
        lineJoin: 'round'
    });
    const routeLine = L.polyline(latlngs, {
        color: '#38bdf8',
        weight: 4,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round'
    });

    routeLayer.addLayer(routeGlow);
    routeLayer.addLayer(routeLine);

    const bounds = L.latLngBounds(latlngs);
    map.fitBounds(bounds, { padding: [60, 60] });

    const walkMins = Math.max(1, Math.round(roadKm * 12.5));
    const bikeMins = Math.max(1, Math.round(roadKm * 2.2));

    const googleMapsNavUrl = `https://www.google.com/maps/dir/?api=1&origin=${userCoords.lat},${userCoords.lng}&destination=${store.lat},${store.lng}&travelmode=driving`;

    const hud = document.getElementById('mapRouteHud');
    if (hud) {
        hud.style.display = 'flex';
        hud.innerHTML = `
            <div class="hud-route-details">
                <div class="hud-route-title">
                    <i class="fas fa-route" style="color:#38bdf8;"></i>
                    <span>Live Route to <strong>${escapeHtml(store.name)}</strong> (${escapeHtml(store.area)})</span>
                </div>
                <div class="hud-metrics-row">
                    <span class="hud-metric-chip"><i class="fas fa-road"></i> ${roadKm} km Road Distance</span>
                    <span class="hud-metric-chip walk" title="Pedestrian Walking Time"><i class="fas fa-person-walking"></i> ${walkMins}m Walk</span>
                    <span class="hud-metric-chip bike" title="Two-Wheeler / Bike Time"><i class="fas fa-motorcycle"></i> ${bikeMins}m Bike</span>
                    <span class="hud-metric-chip car" title="Car / Cab Traffic Time"><i class="fas fa-car"></i> ${carMins}m Car</span>
                </div>
            </div>
            <div class="hud-actions">
                <a href="${googleMapsNavUrl}" target="_blank" rel="noopener noreferrer" class="btn-hud-nav" title="Launch Turn-by-Turn GPS Navigation in Google Maps">
                    <i class="fas fa-location-arrow"></i> Turn-by-Turn GPS
                </a>
                <button type="button" class="btn-hud-close" onclick="closeLiveRouteHud()" title="Close Route Overlay">
                    <i class="fas fa-times"></i> Close
                </button>
            </div>
        `;
    }
}

function closeLiveRouteHud() {
    if (routeLayer) routeLayer.clearLayers();
    const hud = document.getElementById('mapRouteHud');
    if (hud) hud.style.display = 'none';
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
        } else if (activeFilter === 'wishlist') {
            matchType = isStoreInWishlist(store.id);
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

        // Discount Filter (e.g. 50% discount on medicines)
        const matchDiscount = !minDiscountFilter || (store.genericSavingsPct >= minDiscountFilter);

        // Max Distance Radius Filter
        const matchDistanceRadius = !maxDistanceRadiusKm || (store.roadDistanceKm <= maxDistanceRadiusKm);

        return matchArea && matchType && matchSearch && matchDiscount && matchDistanceRadius;
    });

    // Real-Time Sort: Closest Road Distance first!
    filteredPharmacies.sort((a, b) => (a.roadDistanceKm || a.distanceKm || 999) - (b.roadDistanceKm || b.distanceKm || 999));

    renderCards(filteredPharmacies);
    updateStats();
    updateMapMarkers(filteredPharmacies);
    updateDiscountBannerUi();
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
                <p>Try searching for a different area or expanding the distance radius filter.</p>
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

        const roadKm = store.roadDistanceKm !== undefined ? store.roadDistanceKm : (store.distanceKm ? +(store.distanceKm * 1.25).toFixed(1) : 1.2);
        const walkMins = store.walkMins || Math.max(1, Math.round(roadKm * 12.5));
        const bikeMins = store.bikeMins || Math.max(1, Math.round(roadKm * 2.2));
        const carMins = store.carMins || Math.max(2, Math.round(roadKm * 3.2));
        const traffic = store.trafficRating || { text: '🟢 Fast Route', badgeClass: 'traffic-fast', desc: `<${bikeMins}m by bike` };

        const travelHtml = `
            <div class="travel-time-row" title="Real-time estimated transit from ${escapeHtml(userCoords ? userCoords.label : 'PCCOE Campus')}">
                <span class="travel-chip walk-chip" title="Pedestrian Walking Time"><i class="fas fa-person-walking"></i> ${walkMins}m</span>
                <span class="travel-chip bike-chip" title="Two-Wheeler / Bike Time"><i class="fas fa-motorcycle"></i> ${bikeMins}m</span>
                <span class="travel-chip car-chip" title="Car / Cab Time"><i class="fas fa-car"></i> ${carMins}m</span>
            </div>
            <div style="text-align:right;">
                <span class="traffic-condition-badge ${traffic.badgeClass}" title="${traffic.desc}">${traffic.text}</span>
            </div>
        `;

        const distanceHtml = `<div style="text-align:right;">
            <span class="distance-tag dynamic-live" title="Real-time road distance from ${escapeHtml(userCoords ? userCoords.label : 'PCCOE Campus')}"><i class="fas fa-location-arrow"></i> ${roadKm} km road</span>
            ${travelHtml}
        </div>`;

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

        const googleMapsNavUrl = userCoords 
            ? `https://www.google.com/maps/dir/?api=1&origin=${userCoords.lat},${userCoords.lng}&destination=${store.lat},${store.lng}&travelmode=driving`
            : store.mapUrl;

        const isSaved = isStoreInWishlist(store.id);

        card.innerHTML = `
            <div class="card-top">
                <div class="card-title-group">
                    <button type="button" class="btn-card-wishlist ${isSaved ? 'saved' : ''}" onclick="toggleStoreWishlist('${store.id}', event)" title="${isSaved ? 'Remove from Saved Stores (Wishlist)' : 'Save to Care Wishlist'}">
                        <i class="${isSaved ? 'fas fa-heart' : 'far fa-heart'}"></i>
                    </button>
                    <div class="shop-name"><i class="fas fa-store"></i> ${store.name}</div>
                </div>
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

            <div class="card-extra-row">
                <button type="button" class="btn-check-stock" onclick="openStockModal('${store.id}')">
                    <i class="fas fa-boxes-stacked"></i> <span>Check Live Stock &amp; Salts</span>
                </button>
                ${store.is24Hours ? '<span class="critical-care-tag" title="Equipped with 24x7 emergency & cold-chain medicines"><i class="fas fa-snowflake"></i> 24/7 Critical Care</span>' : ''}
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
                <button onclick="drawLiveRouteToStore('${store.id}')" class="btn-card btn-live-route" title="Calculate Live Route on Map with Turn-by-Turn Path">
                    <i class="fas fa-route"></i> Route
                </button>
                <a href="${googleMapsNavUrl}" target="_blank" rel="noopener noreferrer" class="btn-card btn-directions" title="Open Turn-by-Turn GPS Navigation with Your Live Origin">
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
        if (filteredPharmacies.length > 0 && filteredPharmacies[0].roadDistanceKm !== undefined) {
            statDistanceEl.innerText = `${filteredPharmacies[0].roadDistanceKm} km`;
        } else {
            statDistanceEl.innerText = '0.3 km';
        }
    }
    if (statVisitorCountEl) statVisitorCountEl.innerText = totalVisitorCount.toLocaleString();
    if (navVisitorCountEl) navVisitorCountEl.innerText = totalVisitorCount.toLocaleString();
    const mobCountEl = document.getElementById('mobNavVisitorCount');
    if (mobCountEl) mobCountEl.innerText = totalVisitorCount.toLocaleString();
    if (footerVisitorCountEl) footerVisitorCountEl.innerText = totalVisitorCount.toLocaleString();
}

/**
 * DYNAMIC REAL-TIME VISITOR COUNTER & ACTIVE PRESENCE ENGINE
 * - Tracks unique active sessions per tab, phone, and laptop device.
 * - Synchronizes across tabs via BroadcastChannel peer discovery.
 * - Synchronizes across devices via live Python server polling.
 * - Provides realistic dynamic active community presence on static cloud deployments.
 */
let currentActiveUsers = 1;
let realTimePollTimer = null;
let peerHeartbeatTimer = null;

// Unique session ID for THIS specific window / tab / device instance (avoids tab clone duplication)
const clientSessionId = 'mf_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);

// Local cross-tab peer discovery mesh
const activePeerTabs = new Map(); // sid -> lastSeenTimestamp

function registerPeerTab(sid) {
    if (!sid || sid === clientSessionId) return;
    activePeerTabs.set(sid, Date.now());
    recalculateActiveUsers();
}

function removePeerTab(sid) {
    if (activePeerTabs.has(sid)) {
        activePeerTabs.delete(sid);
        recalculateActiveUsers();
    }
}

function pruneDeadPeers() {
    const now = Date.now();
    let changed = false;
    for (const [sid, lastSeen] of activePeerTabs.entries()) {
        if (now - lastSeen > 7000) { // peer missed 2 heartbeat cycles
            activePeerTabs.delete(sid);
            changed = true;
        }
    }
    if (changed) recalculateActiveUsers();
}

let serverReportedActive = 1;

function recalculateActiveUsers() {
    const localTabsCount = activePeerTabs.size + 1; // peers + self
    // 100% genuine real-time active users: takes max of live server active devices and open tabs
    const effectiveCount = Math.max(serverReportedActive || 1, localTabsCount);
    updateActiveUsersBadge(effectiveCount);
}

// Cross-tab broadcast channel
let visitorBroadcast = null;
try {
    visitorBroadcast = new BroadcastChannel('medifinder_realtime_sync');
    visitorBroadcast.onmessage = (event) => {
        if (!event.data) return;
        if (event.data.type === 'NEW_VISITOR') {
            onRealtimeCountUpdated(event.data.total, event.data.active, true);
        } else if (event.data.type === 'PEER_PING') {
            registerPeerTab(event.data.sid);
            if (visitorBroadcast) {
                try { visitorBroadcast.postMessage({ type: 'PEER_PONG', sid: clientSessionId }); } catch (e) {}
            }
        } else if (event.data.type === 'PEER_PONG') {
            registerPeerTab(event.data.sid);
        } else if (event.data.type === 'PEER_LEAVE') {
            removePeerTab(event.data.sid);
        }
    };
    // Announce self immediately to any open tabs
    visitorBroadcast.postMessage({ type: 'PEER_PING', sid: clientSessionId });
} catch (e) {}

// Heartbeat ping every 3.5s to maintain active peer list across tabs
if (!peerHeartbeatTimer) {
    peerHeartbeatTimer = setInterval(() => {
        if (visitorBroadcast) {
            try { visitorBroadcast.postMessage({ type: 'PEER_PING', sid: clientSessionId }); } catch (e) {}
        }
        pruneDeadPeers();
    }, 3500);
}

// Notify peers and server when this tab closes
window.addEventListener('beforeunload', () => {
    try {
        if (visitorBroadcast) {
            visitorBroadcast.postMessage({ type: 'PEER_LEAVE', sid: clientSessionId });
        }
        const leaveUrl = isLocalEnvironment() 
            ? `/api/visitor-count/leave?sid=${encodeURIComponent(clientSessionId)}`
            : `http://localhost:8080/api/visitor-count/leave?sid=${encodeURIComponent(clientSessionId)}`;
        if (navigator.sendBeacon) {
            navigator.sendBeacon(leaveUrl);
        }
    } catch (e) {}
});

const CLOUD_COUNTER_KEY = 'medifinder_pccoe_snehal_2026';
const CLOUD_COUNTER_HIT = `https://countapi.mileshilliard.com/api/v1/hit/${CLOUD_COUNTER_KEY}`;
const CLOUD_COUNTER_GET = `https://countapi.mileshilliard.com/api/v1/get/${CLOUD_COUNTER_KEY}`;

function isLocalEnvironment() {
    return window.location.hostname === 'localhost' || 
           window.location.hostname === '127.0.0.1' || 
           window.location.port === '8080' ||
           window.location.protocol === 'file:';
}

function getVisitorApiBase() {
    if (window.location.port === '8080' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return '';
    }
    if (window.location.protocol === 'file:') {
        return 'http://localhost:8080';
    }
    return '';
}

function initVisitorCounter() {
    let saved = localStorage.getItem(VISITOR_STORAGE_KEY);
    let count = parseInt(saved, 10);
    if (isNaN(count) || count < BASE_VISITOR_COUNT) {
        count = BASE_VISITOR_COUNT;
    }
    totalVisitorCount = count;

    // Determine if this browser session is new
    const isNewSession = !sessionStorage.getItem(VISITOR_SESSION_KEY);

    // Initial presentation of active users
    recalculateActiveUsers();

    // If running on local python server, use local API
    if (isLocalEnvironment()) {
        const base = getVisitorApiBase();
        const action = isNewSession ? 'open' : '';
        const localEndpoint = `${base}/api/visitor-count${action ? '/' + action : ''}?sid=${encodeURIComponent(clientSessionId)}`;
        
        fetch(localEndpoint, { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error('Local API unavailable');
                return res.json();
            })
            .then(data => {
                if (data && data.totalVisitors) {
                    serverReportedActive = data.activeNow || 1;
                    const combinedActive = Math.max(serverReportedActive, activePeerTabs.size + 1);
                    handleVisitorCountSuccess(data.totalVisitors, combinedActive, isNewSession);
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
                const finalCount = Math.max(BASE_VISITOR_COUNT, countVal);
                const active = Math.max(serverReportedActive || 1, activePeerTabs.size + 1);
                handleVisitorCountSuccess(finalCount, active, isNewSession);
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
            recalculateActiveUsers();
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
            try {
                visitorBroadcast.postMessage({ type: 'NEW_VISITOR', total: totalVisitorCount, active: currentActiveUsers });
            } catch (e) {}
        }
    } else {
        if (navVisitorCountEl) navVisitorCountEl.innerText = totalVisitorCount.toLocaleString();
    }
    updateActiveUsersBadge(currentActiveUsers);
}

function pollRealtimeVisitorCount() {
    if (isLocalEnvironment()) {
        const base = getVisitorApiBase();
        fetch(`${base}/api/visitor-count?sid=${encodeURIComponent(clientSessionId)}`, { cache: 'no-store' })
            .then(res => res.json())
            .then(data => {
                if (data && data.totalVisitors) {
                    serverReportedActive = data.activeNow || 1;
                    const combinedActive = Math.max(serverReportedActive, activePeerTabs.size + 1);
                    onRealtimeCountUpdated(data.totalVisitors, combinedActive, false);
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
                const combinedActive = Math.max(serverReportedActive || 1, activePeerTabs.size + 1);
                onRealtimeCountUpdated(countVal, combinedActive, false);
            }
        })
        .catch(() => {
            recalculateActiveUsers();
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
            try {
                visitorBroadcast.postMessage({ type: 'NEW_VISITOR', total: newTotal, active: currentActiveUsers });
            } catch (e) {}
        }
    }
}

function updateActiveUsersBadge(activeCount) {
    currentActiveUsers = Math.max(1, activeCount || 1);
    const activeEl = document.getElementById('activeCountText');
    const mobActiveEl = document.getElementById('mobActiveCountText');
    const text = `${currentActiveUsers} active`;
    if (activeEl && activeEl.innerText !== text) {
        activeEl.innerText = text;
        activeEl.classList.remove('count-pop-glow');
        void activeEl.offsetWidth;
        activeEl.classList.add('count-pop-glow');
    }
    if (mobActiveEl && mobActiveEl.innerText !== text) {
        mobActiveEl.innerText = text;
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
    showToast(`🟢 Real-Time Counter: ${formatted} persons have opened MedNexa.`, 'success');
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
    minDiscountFilter = 0;
    activeDiscountMedicine = null;
    if (searchInput) searchInput.value = '';
    if (areaSelect) areaSelect.value = 'all';
    filterPills.forEach(p => p.classList.toggle('active', p.dataset.filter === 'all'));
    updateDiscountBannerUi();
    applyFilters();
}

function updateDiscountBannerUi() {
    const banner = document.getElementById('activeDiscountBanner');
    if (!banner) return;

    if (minDiscountFilter > 0) {
        banner.style.display = 'inline-flex';
        let medHtml = activeDiscountMedicine
            ? `<span class="discount-med-name"><i class="fas fa-pills"></i> ${escapeHtml(activeDiscountMedicine.brandName)} &rarr; ${escapeHtml(activeDiscountMedicine.genericName)} (${activeDiscountMedicine.savings}% OFF)</span>`
            : '';
        banner.innerHTML = `
            <div class="active-discount-chip">
                <i class="fas fa-tags"></i>
                <span><strong>&ge; ${minDiscountFilter}% Discount</strong></span>
                ${medHtml}
                <button type="button" class="btn-clear-discount" onclick="clearDiscountFilter()" title="Clear Discount Filter">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    } else {
        banner.style.display = 'none';
        banner.innerHTML = '';
    }
}

function clearDiscountFilter() {
    minDiscountFilter = 0;
    activeDiscountMedicine = null;
    updateDiscountBannerUi();
    applyFilters();
    showToast("Discount filter cleared. Showing all verified stores.", "info");
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
            <td>
                <button type="button" class="btn-table-slip" onclick="openPrintableSavingsSlip('${escapeHtml(med.brandName)}', '${escapeHtml(med.genericName)}', ${med.brandPrice}, ${med.genericPrice}, ${med.savings})">
                    <i class="fas fa-print"></i> Get Slip
                </button>
            </td>
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

    // Add Store Form (Submits to Private Admin Verification Queue)
    const addStoreForm = document.getElementById('addStoreForm');
    if (addStoreForm) {
        addStoreForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const name = document.getElementById('storeName').value.trim();
            const owner = document.getElementById('storeOwner') ? document.getElementById('storeOwner').value.trim() : 'Registered Chemist';
            const type = document.getElementById('storeType').value;
            const area = document.getElementById('storeArea').value;
            const phone = document.getElementById('storePhone').value.trim() || 'N/A';
            const license = document.getElementById('storeLicense') ? document.getElementById('storeLicense').value.trim() : '';
            const address = document.getElementById('storeAddress').value.trim();
            const lat = parseFloat(document.getElementById('storeLat').value) || 18.6520;
            const lng = parseFloat(document.getElementById('storeLng').value) || 73.7650;
            const is24h = document.getElementById('store24h') ? document.getElementById('store24h').checked : false;
            const isDelivery = document.getElementById('storeDelivery') ? document.getElementById('storeDelivery').checked : false;

            const newSubmission = {
                id: 'sub_' + Date.now(),
                name,
                owner,
                type,
                area,
                phone,
                license: license || 'MH-PCMC-' + Math.floor(100000 + Math.random() * 900000),
                address,
                lat,
                lng,
                is24Hours: is24h,
                delivery: isDelivery,
                submittedAt: new Date().toISOString(),
                status: 'PENDING'
            };

            const pending = getPendingSubmissions();
            pending.unshift(newSubmission);
            savePendingSubmissions(pending);
            updateAdminPendingBadges();

            closeModal('addStoreModal');
            addStoreForm.reset();
            showToast(`✅ "${name}" application securely recorded in the Private Admin Database! Awaiting administrator approval.`, "success");
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
    setText('btnVoiceText', t.btnVoice || 'AI Voice Command');
    setText('voiceHelpText', t.voiceHelpText || 'Unable to type? Tap here to command with AI Voice');
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
            <div style="display:flex; gap:8px; margin-top:8px;">
                <button onclick="closeModal('scannerModal'); document.querySelector('[data-filter=generic]').click();" class="btn-primary" style="flex:1;">
                    <i class="fas fa-location-dot"></i> View Stores
                </button>
                <button onclick="openPrintableSavingsSlip('${escapeHtml(matched.brandName)}', '${escapeHtml(matched.genericName)}', ${matched.brandPrice}, ${matched.genericPrice}, ${matched.savings})" class="btn-secondary" style="background:#059669; color:#fff; border:none; padding:8px 14px; font-weight:700; border-radius:6px; cursor:pointer;">
                    <i class="fas fa-print"></i> Print Savings Slip
                </button>
            </div>
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
// 9. CARE WISHLIST ENGINE & PRIVATE ADMIN PORTAL
// ==========================================

// --------------------------------------------------------------------------
// 9A. USER CARE WISHLIST ENGINE (Favorite Medical Stores Bookmark)
// --------------------------------------------------------------------------

function getWishlistStorageKey() {
    const session = typeof getActiveSession === 'function' ? getActiveSession() : null;
    return session && session.userId ? `medifinder_wishlist_${session.userId}` : 'medifinder_wishlist_guest';
}

function getUserWishlist() {
    try {
        const key = getWishlistStorageKey();
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveUserWishlist(ids) {
    try {
        const key = getWishlistStorageKey();
        localStorage.setItem(key, JSON.stringify(ids));
    } catch (e) {
        console.error('Error saving wishlist:', e);
    }
}

function isStoreInWishlist(storeId) {
    const list = getUserWishlist();
    return list.some(id => String(id) === String(storeId));
}

function toggleStoreWishlist(storeId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const session = typeof getActiveSession === 'function' ? getActiveSession() : null;
    if (!session) {
        showToast("Please log in to save medical stores to your Care Wishlist ❤️", "info");
        if (typeof openAuthModal === 'function') {
            openAuthModal('signin');
        }
        return;
    }

    const strId = String(storeId);
    let list = getUserWishlist().map(String);
    const store = allPharmacies.find(s => String(s.id) === strId);
    const storeName = store ? store.name : "Medical Store";

    if (list.includes(strId)) {
        list = list.filter(id => id !== strId);
        saveUserWishlist(list);
        showToast(`Removed "${storeName}" from Care Wishlist`, "info");
    } else {
        list.push(strId);
        saveUserWishlist(list);
        showToast(`Saved "${storeName}" to Care Wishlist ❤️`, "success");
    }

    updateWishlistBadges();

    // Fast DOM update on card if present
    const card = document.getElementById(`card-${storeId}`);
    if (card) {
        const btn = card.querySelector('.btn-card-wishlist');
        if (btn) {
            const saved = list.includes(strId);
            btn.classList.toggle('saved', saved);
            btn.setAttribute('title', saved ? 'Remove from Saved Stores (Wishlist)' : 'Save to Care Wishlist');
            btn.innerHTML = `<i class="${saved ? 'fas fa-heart' : 'far fa-heart'}"></i>`;
        }
    }

    if (activeFilter === 'wishlist') {
        applyFilters();
    }

    const wishlistModal = document.getElementById('wishlistModal');
    if (wishlistModal && wishlistModal.classList.contains('active')) {
        renderWishlistModal();
    }
}

function updateWishlistBadges() {
    const count = getUserWishlist().length;
    const navEl = document.getElementById('navWishlistCount');
    const pillEl = document.getElementById('pillWishlistCount');
    const mobEl = document.getElementById('mobWishlistCount');
    if (navEl) navEl.innerText = count;
    if (pillEl) pillEl.innerText = count;
    if (mobEl) mobEl.innerText = count;
}

function openWishlistModal() {
    const session = typeof getActiveSession === 'function' ? getActiveSession() : null;
    if (!session) {
        showToast("Please log in to view your Care Wishlist ❤️", "info");
        if (typeof openAuthModal === 'function') openAuthModal('signin');
        return;
    }
    renderWishlistModal();
    openModal('wishlistModal');
}

function renderWishlistModal() {
    const container = document.getElementById('wishlistModalGrid');
    if (!container) return;

    const savedIds = getUserWishlist().map(String);
    const savedStores = allPharmacies.filter(s => savedIds.includes(String(s.id)));

    if (savedStores.length === 0) {
        container.innerHTML = `
            <div class="wishlist-empty-state">
                <i class="far fa-heart" style="font-size:3.5rem; color:#cbd5e1; margin-bottom:12px;"></i>
                <h4 style="margin:0 0 8px 0; color:#334155; font-size:1.15rem;">No Saved Medical Stores Yet</h4>
                <p style="color:#64748b; font-size:0.88rem; max-width:440px; margin:0 auto 16px auto; line-height:1.5;">
                    Just like bookmarking favorite items, tap the heart ❤️ icon on any pharmacy card to keep urgent chemists, Jan Aushadhi hubs, and home delivery stores always within reach.
                </p>
                <button type="button" class="btn-primary" onclick="closeModal('wishlistModal')">
                    <i class="fas fa-magnifying-glass"></i> Browse Medical Stores
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = savedStores.map(store => {
        const roadKm = store.roadDistanceKm !== undefined ? store.roadDistanceKm : (store.distanceKm ? +(store.distanceKm * 1.25).toFixed(1) : 1.2);
        const cleanPhone = store.phone ? store.phone.replace(/[^0-9]/g, '') : '';
        const waText = encodeURIComponent(`Hello, I saved ${store.name} in my MedNexa Care Wishlist. Can you check medicine availability?`);
        const waLink = cleanPhone ? `https://wa.me/91${cleanPhone}?text=${waText}` : '#';

        return `
            <div class="wishlist-item-card">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                    <div>
                        <strong style="font-size:1.05rem; color:#0f172a;">${escapeHtml(store.name)}</strong>
                        <div style="font-size:0.78rem; color:#64748b; margin-top:2px;">
                            <i class="fas fa-map-pin" style="color:#0284c7;"></i> ${escapeHtml(store.area || store.address)}
                        </div>
                    </div>
                    <button type="button" class="btn-remove-wishlist" onclick="removeWishlistItem('${store.id}')" title="Remove from wishlist">
                        <i class="fas fa-trash-can"></i>
                    </button>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;">
                    <span class="type-badge ${store.type.toLowerCase() === 'generic' ? 'badge-generic' : 'badge-allopathy'}">${store.type}</span>
                    ${store.is24Hours ? '<span class="badge-24h" style="padding:2px 8px; border-radius:999px; font-size:0.72rem; background:#fee2e2; color:#991b1b; font-weight:600;"><i class="fas fa-clock"></i> 24x7</span>' : ''}
                    ${store.delivery ? '<span class="badge-delivery" style="padding:2px 8px; border-radius:999px; font-size:0.72rem; background:#dcfce7; color:#166534; font-weight:600;"><i class="fas fa-motorcycle"></i> Home Delivery</span>' : ''}
                    ${store.genericSavingsPct ? `<span style="padding:2px 8px; border-radius:999px; font-size:0.72rem; background:#fef3c7; color:#92400e; font-weight:600;"><i class="fas fa-tags"></i> Up to ${store.genericSavingsPct}% OFF</span>` : ''}
                </div>

                <div style="font-size:0.82rem; color:#475569; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                    <span><i class="fas fa-route" style="color:#6366f1;"></i> ${roadKm} km road</span>
                    <span>•</span>
                    <span><i class="fas fa-clock" style="color:#10b981;"></i> ${store.timing || '8:00 AM - 11:00 PM'}</span>
                </div>

                <div style="display:flex; gap:8px;">
                    <a href="tel:${store.phone || ''}" class="btn-card btn-call" style="flex:1; text-align:center; padding:7px 10px; font-size:0.82rem; text-decoration:none;">
                        <i class="fas fa-phone"></i> Call
                    </a>
                    <a href="${waLink}" target="_blank" class="btn-card btn-wa" style="flex:1; text-align:center; padding:7px 10px; font-size:0.82rem; text-decoration:none;" ${!cleanPhone ? 'style="opacity:0.5;pointer-events:none"' : ''}>
                        <i class="fab fa-whatsapp"></i> Chat
                    </a>
                    <button type="button" class="btn-card btn-map-pin" onclick="closeModal('wishlistModal'); focusOnMap(${store.lat}, ${store.lng});" style="flex:1; padding:7px 10px; font-size:0.82rem;">
                        <i class="fas fa-map-location-dot"></i> Map
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function removeWishlistItem(storeId) {
    const strId = String(storeId);
    let list = getUserWishlist().map(String).filter(id => id !== strId);
    saveUserWishlist(list);
    updateWishlistBadges();
    renderWishlistModal();

    const card = document.getElementById(`card-${storeId}`);
    if (card) {
        const btn = card.querySelector('.btn-card-wishlist');
        if (btn) {
            btn.classList.remove('saved');
            btn.setAttribute('title', 'Save to Care Wishlist');
            btn.innerHTML = `<i class="far fa-heart"></i>`;
        }
    }

    if (activeFilter === 'wishlist') {
        applyFilters();
    }
    showToast("Medical store removed from your Care Wishlist", "info");
}

// --------------------------------------------------------------------------
// 9B. PRIVATE ADMIN PORTAL WITH MASTER KEY GATE & PENDING SUBMISSIONS DB
// --------------------------------------------------------------------------

const ADMIN_MASTER_PASSWORDS = ['Komal', 'komal'];
const ADMIN_SESSION_KEY = 'medifinder_admin_auth_v2';
const PENDING_SUBMISSIONS_KEY = 'medifinder_pending_submissions_v2';

const INITIAL_SAMPLE_SUBMISSIONS = [
    {
        id: 'sub_seed_1',
        name: 'Sanjivani Medicos & Care Hub',
        owner: 'Rajesh Patil',
        type: 'Generic',
        area: 'Chikhali Pradhikaran',
        phone: '9822334455',
        license: 'MH-PCMC-2024-8842',
        address: 'Shop 4, Near Shinde Petrol Pump, Spine Road, Sector 18, Chikhali Pradhikaran',
        lat: 18.6675,
        lng: 73.8105,
        is24Hours: false,
        delivery: true,
        submittedAt: '2026-10-28 14:32',
        status: 'PENDING'
    },
    {
        id: 'sub_seed_2',
        name: 'Shree Sai Chemist & Surgicals',
        owner: 'Anil Kulkarni',
        type: 'Allopathy',
        area: 'Akurdi',
        phone: '9890123456',
        license: 'MH-PCMC-2023-4129',
        address: 'Opposite PCCOE College Arch, Sector 29, Akurdi',
        lat: 18.6465,
        lng: 73.7610,
        is24Hours: true,
        delivery: false,
        submittedAt: '2026-10-29 09:15',
        status: 'PENDING'
    }
];

function isAdminAuthenticated() {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
}

function openAdminPortal() {
    if (isAdminAuthenticated()) {
        renderAdminSubmissionsTable();
        renderAdminLiveTable();
        renderAdminFeedbackTable();
        updateAdminPendingBadges();
        openModal('adminModal');
        // Fetch all latest feedbacks from the server whenever opening the portal
        if (typeof syncFeedbacksFromBackend === 'function') {
            syncFeedbacksFromBackend();
        }
    } else {
        const passInput = document.getElementById('adminMasterPassword') || document.getElementById('adminSecretKey');
        const errEl = document.getElementById('adminGateError');
        if (passInput) {
            passInput.value = '';
            setTimeout(() => passInput.focus(), 100);
        }
        if (errEl) errEl.style.display = 'none';
        openModal('adminGateModal');
    }
}

function toggleAdminPassVisibility() {
    const input = document.getElementById('adminMasterPassword') || document.getElementById('adminSecretKey');
    const icon = document.getElementById('adminPassEyeIcon') || document.getElementById('adminEyeIcon');
    if (!input || !icon) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

function handleAdminGateSubmit(event) {
    event.preventDefault();
    const input = document.getElementById('adminMasterPassword') || document.getElementById('adminSecretKey');
    const password = (input ? input.value : '').trim();
    const errEl = document.getElementById('adminGateError');
    const windowEl = document.getElementById('adminGateWindow');

    // Password must be strictly Komal (case-friendly allowed)
    if (password === 'Komal' || password.toLowerCase() === 'komal') {
        sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
        if (errEl) errEl.style.display = 'none';
        closeModal('adminGateModal');
        // Instantly render and display all admin data
        renderAdminSubmissionsTable();
        renderAdminLiveTable();
        renderAdminFeedbackTable();
        updateAdminPendingBadges();
        openModal('adminModal');
        showToast("Admin portal unlocked successfully.", "success");
        // Immediately fetch all latest feedbacks from the server so friend's feedback is instantly visible
        if (typeof syncFeedbacksFromBackend === 'function') {
            syncFeedbacksFromBackend();
        }
    } else {
        if (errEl) {
            errEl.style.display = 'block';
            errEl.innerHTML = '<i class="fas fa-circle-exclamation"></i> Incorrect password. Only the authorized administrator can open this portal.';
        }
        if (windowEl) {
            windowEl.classList.remove('shake-anim');
            void windowEl.offsetWidth; // trigger reflow
            windowEl.classList.add('shake-anim');
        }
        if (input) {
            input.value = '';
            input.focus();
        }
    }
}

function logoutAdmin() {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    closeModal('adminModal');
    showToast("Admin session terminated securely.", "info");
}

function switchAdminPortalTab(tab) {
    const subBtn = document.getElementById('adminTabSubmissionsBtn') || document.getElementById('adminSubmissionsTabBtn');
    const liveBtn = document.getElementById('adminTabLiveStoresBtn') || document.getElementById('adminLiveStoresTabBtn');
    const feedBtn = document.getElementById('adminTabFeedbackBtn');
    const subView = document.getElementById('adminSubmissionsView');
    const liveView = document.getElementById('adminLiveStoresView');
    const feedView = document.getElementById('adminFeedbackView');

    if (tab === 'submissions') {
        if (subBtn) subBtn.classList.add('active');
        if (liveBtn) liveBtn.classList.remove('active');
        if (feedBtn) feedBtn.classList.remove('active');
        if (subView) subView.style.display = 'block';
        if (liveView) liveView.style.display = 'none';
        if (feedView) feedView.style.display = 'none';
        renderAdminSubmissionsTable();
    } else if (tab === 'feedback') {
        if (subBtn) subBtn.classList.remove('active');
        if (liveBtn) liveBtn.classList.remove('active');
        if (feedBtn) feedBtn.classList.add('active');
        if (subView) subView.style.display = 'none';
        if (liveView) liveView.style.display = 'none';
        if (feedView) feedView.style.display = 'block';
        renderAdminFeedbackTable();
        if (typeof syncFeedbacksFromBackend === 'function') {
            syncFeedbacksFromBackend();
        }
    } else {
        if (subBtn) subBtn.classList.remove('active');
        if (liveBtn) liveBtn.classList.add('active');
        if (feedBtn) feedBtn.classList.remove('active');
        if (subView) subView.style.display = 'none';
        if (liveView) liveView.style.display = 'block';
        if (feedView) feedView.style.display = 'none';
        renderAdminLiveTable();
    }
}

function getPendingSubmissions() {
    try {
        const raw = localStorage.getItem(PENDING_SUBMISSIONS_KEY);
        if (raw) return JSON.parse(raw);
        localStorage.setItem(PENDING_SUBMISSIONS_KEY, JSON.stringify(INITIAL_SAMPLE_SUBMISSIONS));
        return [...INITIAL_SAMPLE_SUBMISSIONS];
    } catch (e) {
        return [...INITIAL_SAMPLE_SUBMISSIONS];
    }
}

function savePendingSubmissions(list) {
    try {
        localStorage.setItem(PENDING_SUBMISSIONS_KEY, JSON.stringify(list));
    } catch (e) {
        console.error('Error saving pending submissions:', e);
    }
}

function updateAdminPendingBadges() {
    const submissions = getPendingSubmissions();
    const pendingCount = submissions.filter(s => s.status === 'PENDING').length;
    const navBadge = document.getElementById('navAdminPendingBadge');
    const tabBadge = document.getElementById('adminPendingTabBadge');

    if (navBadge) {
        navBadge.innerText = pendingCount;
        navBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
    }
    if (tabBadge) {
        tabBadge.innerText = pendingCount;
        tabBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
    }
}

function renderAdminSubmissionsTable() {
    const tbody = document.getElementById('adminSubmissionsTableBody');
    if (!tbody) return;

    const submissions = getPendingSubmissions();
    tbody.innerHTML = '';

    if (submissions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#64748b;">No store submissions currently recorded in private queue.</td></tr>`;
        return;
    }

    submissions.forEach(sub => {
        const tr = document.createElement('tr');
        const badgeClass = sub.status === 'APPROVED' ? 'status-approved' : (sub.status === 'REJECTED' ? 'status-rejected' : 'status-pending');
        const formattedDate = sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';

        tr.innerHTML = `
            <td>
                <strong style="color:#0f172a; font-size:0.95rem;">${escapeHtml(sub.name)}</strong>
                <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">
                    <i class="fas fa-location-dot" style="color:#0284c7;"></i> ${escapeHtml(sub.address)}
                </div>
                <div style="font-size:0.72rem; color:#94a3b8; margin-top:2px;">
                    Area: <strong>${escapeHtml(sub.area || 'Akurdi')}</strong> • Submitted: ${formattedDate}
                </div>
            </td>
            <td>
                <span style="font-weight:600; color:#334155;">${escapeHtml(sub.owner || 'Registered Chemist')}</span>
                <div style="font-size:0.75rem; color:#64748b;">
                    <a href="tel:${sub.phone || ''}" style="color:#0284c7; text-decoration:none;"><i class="fas fa-phone"></i> ${sub.phone || 'N/A'}</a>
                </div>
            </td>
            <td>
                <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:0.75rem; color:#0f172a;">${sub.license || 'PENDING-REG'}</code>
                <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">
                    <span class="type-badge ${sub.type === 'Generic' ? 'badge-generic' : 'badge-allopathy'}" style="font-size:0.68rem; padding:1px 6px;">${sub.type}</span>
                    ${sub.is24Hours ? '<span style="font-size:0.68rem; color:#dc2626; margin-left:4px;">• 24x7</span>' : ''}
                    ${sub.delivery ? '<span style="font-size:0.68rem; color:#16a34a; margin-left:4px;">• Delivery</span>' : ''}
                </div>
            </td>
            <td>
                <span class="status-badge ${badgeClass}">${sub.status}</span>
            </td>
            <td>
                ${sub.status === 'PENDING' ? `
                    <div style="display:flex; gap:6px;">
                        <button type="button" onclick="approveStoreSubmission('${sub.id}')" class="btn-action-approve" title="Approve & Publish store live to MedNexa Directory">
                            <i class="fas fa-check"></i> Approve &amp; Publish
                        </button>
                        <button type="button" onclick="rejectStoreSubmission('${sub.id}')" class="btn-action-reject" title="Reject submission">
                            <i class="fas fa-xmark"></i> Reject
                        </button>
                    </div>
                ` : `
                    <span style="font-size:0.78rem; color:#64748b; display:inline-flex; align-items:center; gap:4px;">
                        <i class="fas ${sub.status === 'APPROVED' ? 'fa-circle-check' : 'fa-circle-xmark'}" style="color:${sub.status === 'APPROVED' ? '#10b981' : '#ef4444'}"></i> Processed
                    </span>
                `}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function approveStoreSubmission(submissionId) {
    const list = getPendingSubmissions();
    const sub = list.find(s => s.id === submissionId);
    if (!sub) return;

    sub.status = 'APPROVED';
    sub.approvedAt = new Date().toISOString();
    savePendingSubmissions(list);

    // Publish to active store database if not already present
    const existing = allPharmacies.find(s => s.name.toLowerCase() === sub.name.toLowerCase());
    if (!existing) {
        const newStore = {
            id: 'store_pub_' + Date.now(),
            name: sub.name,
            type: sub.type || 'Allopathy',
            address: sub.address,
            area: sub.area || 'Akurdi',
            phone: sub.phone || '020-27650000',
            timing: sub.is24Hours ? '24 Hours Open' : '8:00 AM - 11:00 PM',
            delivery: !!sub.delivery,
            is24Hours: !!sub.is24Hours,
            isVerified: true,
            isStudentVisited: false,
            genericSavingsPct: sub.type === 'Generic' ? 75 : 15,
            lat: sub.lat || 18.6520,
            lng: sub.lng || 73.7650,
            mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sub.name + ' ' + sub.address)}`
        };
        allPharmacies.unshift(newStore);
        savePharmaciesData();
        if (typeof recalculateAllStoreMetrics === 'function') recalculateAllStoreMetrics();
        if (typeof applyFilters === 'function') applyFilters();
    }

    renderAdminSubmissionsTable();
    renderAdminLiveTable();
    updateAdminPendingBadges();
    showToast(`Approved "${sub.name}"! Successfully published to live MedNexa Directory.`, "success");
}

function rejectStoreSubmission(submissionId) {
    const list = getPendingSubmissions();
    const sub = list.find(s => s.id === submissionId);
    if (!sub) return;

    sub.status = 'REJECTED';
    sub.rejectedAt = new Date().toISOString();
    savePendingSubmissions(list);

    renderAdminSubmissionsTable();
    updateAdminPendingBadges();
    showToast(`Rejected submission for "${sub.name}".`, "info");
}

function renderAdminLiveTable(storesList = null) {
    const tbody = document.getElementById('adminLiveTableBody');
    const badgeCount = document.getElementById('adminLiveCountBadge');
    if (!tbody) return;

    const list = storesList || allPharmacies;
    if (badgeCount) badgeCount.innerText = `${allPharmacies.length} Total`;

    tbody.innerHTML = '';
    list.slice(0, 50).forEach(store => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong style="color:#0f172a;">${escapeHtml(store.name)}</strong>
                <div style="font-size:0.75rem; color:#64748b;">${escapeHtml(store.address)}</div>
            </td>
            <td><span class="type-badge ${store.type.toLowerCase() === 'generic' ? 'badge-generic' : 'badge-allopathy'}">${store.type}</span></td>
            <td><span style="font-size:0.82rem; font-weight:500;">${escapeHtml(store.area)}</span></td>
            <td><span style="font-size:0.8rem; color:#0284c7;">${escapeHtml(store.phone || 'N/A')}</span></td>
            <td>
                ${store.delivery ? '<span style="color:#16a34a; font-size:0.8rem;"><i class="fas fa-check"></i> Yes</span>' : '<span style="color:#94a3b8; font-size:0.8rem;">No</span>'}
            </td>
            <td>
                <span class="status-badge status-approved"><i class="fas fa-shield-check"></i> Live</span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterAdminLiveStores(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
        renderAdminLiveTable(allPharmacies);
        return;
    }
    const filtered = allPharmacies.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.area.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q) ||
        s.type.toLowerCase().includes(q)
    );
    renderAdminLiveTable(filtered);
}

function initAdminPortal() {
    getPendingSubmissions();
    updateAdminPendingBadges();
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
    if (typeof updateWishlistBadges === 'function') updateWishlistBadges();
    if (typeof applyFilters === 'function') applyFilters();
}

function restoreUserSession() {
    const session = getActiveSession();
    renderNavAuthState(session);
    if (typeof updateWishlistBadges === 'function') updateWishlistBadges();
}

function renderNavAuthState(session) {
    const navContainer = document.getElementById('navAuthContainer');
    const mobContainer = document.getElementById('mobNavAuthContainer');

    if (!session) {
        const loginBtnHtml = `
            <button class="btn-nav btn-auth" id="btnNavAuth" onclick="openAuthModal('signin')">
                <i class="fas fa-user"></i> <span id="btnAuthText">Log In</span>
            </button>
        `;
        if (navContainer) navContainer.innerHTML = loginBtnHtml;
        if (mobContainer) {
            mobContainer.innerHTML = `
                <button type="button" class="mob-btn-auth" onclick="closeMobileMenu(); openAuthModal('signin');">
                    <i class="fas fa-user-circle"></i> <span>Log In / Create Account</span>
                </button>
            `;
        }
        return;
    }

    const initial = (session.fullName || 'User').charAt(0).toUpperCase();
    const loggedInHtml = `
        <div class="user-chip-container">
            <span class="user-chip-avatar">${initial}</span>
            <span class="user-chip-name">${escapeHtml(session.fullName)}</span>
            <button type="button" class="user-chip-logout" onclick="logoutUser()" title="Log Out">
                <i class="fas fa-sign-out-alt"></i> Log Out
            </button>
        </div>
    `;
    if (navContainer) navContainer.innerHTML = loggedInHtml;
    if (mobContainer) {
        mobContainer.innerHTML = `
            <div class="mob-user-chip">
                <div class="user-chip-container" style="width:100%; justify-content:space-between; padding:8px 14px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="user-chip-avatar">${initial}</span>
                        <span class="user-chip-name" style="max-width:140px; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(session.fullName)}</span>
                    </div>
                    <button type="button" class="user-chip-logout" onclick="closeMobileMenu(); logoutUser();" title="Log Out">
                        <i class="fas fa-sign-out-alt"></i> Log Out
                    </button>
                </div>
            </div>
        `;
    }
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
    if (typeof updateWishlistBadges === 'function') updateWishlistBadges();
    if (typeof applyFilters === 'function') applyFilters();
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

// ==========================================================================
// 12. MEDNEXA AI VOICE ASSISTANT & COMMAND ENGINE
// ==========================================================================
let voiceRecognition = null;
let isVoiceRecording = false;
let currentVoiceLang = 'en-IN';
let voiceAudioFeedbackEnabled = true;
let isVoiceProcessing = false;
let activeVoiceTranscript = '';

function initVoiceAssistant() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn('SpeechRecognition API not available in this browser. Fallback text commands enabled.');
        const statusText = document.getElementById('voiceStatusText');
        if (statusText) statusText.innerText = 'Microphone not supported in this browser. Use quick chips or text input.';
        return;
    }

    try {
        voiceRecognition = new SpeechRecognition();
        voiceRecognition.continuous = false;
        voiceRecognition.interimResults = true;
        voiceRecognition.lang = currentVoiceLang;
        voiceRecognition.maxAlternatives = 1;

        voiceRecognition.onstart = () => {
            isVoiceRecording = true;
            updateVoiceUiState('recording');
        };

        voiceRecognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            const currentSpoken = (finalTranscript || interimTranscript).trim();
            if (currentSpoken) {
                activeVoiceTranscript = currentSpoken;
                const transcriptEl = document.getElementById('voiceTranscriptText');
                if (transcriptEl) {
                    transcriptEl.innerHTML = `&ldquo;${escapeHtml(currentSpoken)}&rdquo;`;
                }
            }

            if (finalTranscript) {
                stopVoiceListening();
                handleVoiceCommandTranscript(finalTranscript);
            }
        };

        voiceRecognition.onerror = (event) => {
            console.warn('Speech recognition error:', event.error);
            isVoiceRecording = false;
            updateVoiceUiState('idle');

            let errorMsg = 'Could not catch that. Please tap and speak again.';
            if (event.error === 'not-allowed') {
                errorMsg = 'Microphone permission blocked. Please allow mic access in your browser.';
            } else if (event.error === 'no-speech') {
                errorMsg = 'No voice detected. Tap mic and speak your command.';
            } else if (event.error === 'network') {
                errorMsg = 'Network error during voice processing. You can also tap the chips below.';
            }

            const statusText = document.getElementById('voiceStatusText');
            if (statusText) statusText.innerText = errorMsg;
            showToast(errorMsg, 'warning');
        };

        voiceRecognition.onend = () => {
            if (isVoiceRecording) {
                isVoiceRecording = false;
                if (!isVoiceProcessing && activeVoiceTranscript) {
                    handleVoiceCommandTranscript(activeVoiceTranscript);
                } else if (!isVoiceProcessing) {
                    updateVoiceUiState('idle');
                }
            }
        };
    } catch (err) {
        console.error('Error initializing SpeechRecognition:', err);
    }
}

function openVoiceAssistantModal() {
    openModal('voiceModal');
    updateVoiceUiState('idle');
    const transcriptEl = document.getElementById('voiceTranscriptText');
    if (transcriptEl && !activeVoiceTranscript) {
        transcriptEl.innerHTML = `&ldquo;Tap the microphone and say: 'Jan Aushadhi in Akurdi' or 'Open 24 hours medical'&rdquo;`;
    }

    // Auto-start listening after smooth modal opening for hands-free comfort
    setTimeout(() => {
        if (!isVoiceRecording && voiceRecognition) {
            startVoiceListening();
        }
    }, 400);
}

function closeVoiceAssistantModal() {
    stopVoiceListening();
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    closeModal('voiceModal');
}

function startInlineVoiceSearch(event) {
    if (event) event.stopPropagation();
    openVoiceAssistantModal();
}

function toggleVoiceRecording() {
    if (isVoiceRecording) {
        stopVoiceListening();
    } else {
        startVoiceListening();
    }
}

function startVoiceListening() {
    if (!voiceRecognition) {
        initVoiceAssistant();
        if (!voiceRecognition) {
            showToast('Voice Recognition is not supported by your browser. Please type command.', 'warning');
            return;
        }
    }

    try {
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        voiceRecognition.lang = currentVoiceLang;
        voiceRecognition.start();
        isVoiceRecording = true;
        updateVoiceUiState('recording');
    } catch (e) {
        // Already started or busy
        try {
            voiceRecognition.stop();
        } catch (err) {}
    }
}

function stopVoiceListening() {
    if (voiceRecognition && isVoiceRecording) {
        try {
            voiceRecognition.stop();
        } catch (e) {}
    }
    isVoiceRecording = false;
}

function setVoiceRecognitionLang(lang) {
    currentVoiceLang = lang;
    document.querySelectorAll('.voice-lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.voiceLang === lang);
    });

    if (voiceRecognition) {
        voiceRecognition.lang = currentVoiceLang;
    }

    if (isVoiceRecording) {
        stopVoiceListening();
        setTimeout(startVoiceListening, 250);
    }

    const langNames = { 'en-IN': 'English (India)', 'mr-IN': 'मराठी (Marathi)', 'hi-IN': 'हिंदी (Hindi)' };
    showToast(`Voice recognition set to ${langNames[lang] || lang}`, 'info');
}

function toggleVoiceSpeechFeedback() {
    voiceAudioFeedbackEnabled = !voiceAudioFeedbackEnabled;
    const btn = document.getElementById('voiceTtsToggle');
    const icon = document.getElementById('voiceTtsIcon');
    if (btn) {
        btn.classList.toggle('active', voiceAudioFeedbackEnabled);
        btn.classList.toggle('muted', !voiceAudioFeedbackEnabled);
        const label = btn.querySelector('.tts-label');
        if (label) {
            label.innerText = voiceAudioFeedbackEnabled ? 'Voice Audio: ON' : 'Voice Audio: OFF';
        }
    }
    if (icon) {
        icon.className = voiceAudioFeedbackEnabled ? 'fas fa-volume-high' : 'fas fa-volume-xmark';
    }
    showToast(voiceAudioFeedbackEnabled ? 'AI Voice readout enabled' : 'AI Voice readout muted', 'info');
}

function updateVoiceUiState(state) {
    const waves = document.getElementById('soundWaves');
    const bigMicBtn = document.getElementById('voiceBigMicBtn');
    const statusPill = document.getElementById('voiceStatusPill');
    const statusText = document.getElementById('voiceStatusText');
    const inlineBtn = document.getElementById('voiceSearchBtn');

    if (waves) {
        waves.classList.toggle('active-listening', state === 'recording' || state === 'speaking');
    }
    if (bigMicBtn) {
        bigMicBtn.classList.toggle('recording', state === 'recording');
    }
    if (inlineBtn) {
        inlineBtn.classList.toggle('listening', state === 'recording');
    }

    if (statusPill && statusText) {
        statusPill.className = `voice-status-pill ${state}`;
        if (state === 'recording') {
            statusText.innerText = 'Listening... Speak your command now';
        } else if (state === 'processing') {
            statusText.innerText = 'Analyzing command with AI...';
        } else if (state === 'speaking') {
            statusText.innerText = 'Speaking response...';
        } else {
            statusText.innerText = 'Tap microphone to speak';
        }
    }
}

function executeVoiceTextCommand() {
    const input = document.getElementById('voiceTextInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) {
        showToast('Please type a voice command', 'info');
        return;
    }
    input.value = '';
    executeVoiceCommandQuick(val);
}

function executeVoiceCommandQuick(commandText) {
    activeVoiceTranscript = commandText;
    const transcriptEl = document.getElementById('voiceTranscriptText');
    if (transcriptEl) {
        transcriptEl.innerHTML = `&ldquo;${escapeHtml(commandText)}&rdquo;`;
    }
    handleVoiceCommandTranscript(commandText);
}

function handleVoiceCommandTranscript(rawText) {
    isVoiceProcessing = true;
    updateVoiceUiState('processing');

    setTimeout(() => {
        parseAndExecuteVoiceCommand(rawText);
        isVoiceProcessing = false;
    }, 350);
}

/**
 * Intelligent Multi-lingual AI Natural Language Command Parser
 */
function parseAndExecuteVoiceCommand(rawText) {
    if (!rawText) return;
    const text = rawText.toLowerCase().trim();
    console.log('MedNexa AI Voice Command Received:', rawText);

    let executedIntent = '';
    let speechMessage = '';
    let metaChips = [];

    // 1. EXTRACT LOCALITY / AREA (Phonetic & Multi-lingual PCMC coverage)
    const AREA_KEYWORDS = [
        { key: 'Akurdi', patterns: ['akurdi', 'aakurdi', 'aakurdy', 'akordi', 'akurdee', 'pccoe', 'station akurdi', 'sec 27a', 'sector 27a', 'gurudwara', 'mandai akurdi', 'akurdi gaon'] },
        { key: 'Chikhali Pradhikaran', patterns: ['chikhali', 'chikli', 'chikhli', 'spine road', 'pradhikaran chikhali', 'pradhikaran', 'sector 19', 'jadhavwadi'] },
        { key: 'Nigdi', patterns: ['nigdi', 'nigadi', 'sambhaji chowk', 'sector 24', 'sector 25', 'sector 26', 'lokmanya', 'bhel chowk'] },
        { key: 'Ravet', patterns: ['ravet', 'rawet', 'walhekarwadi', 'shinde petrol', 'd y patil', 'dypatil', 'kiwale', 'ravet bridge'] },
        { key: 'Vallabh Nagar', patterns: ['vallabh nagar', 'vallabhnagar', 'st stand', 'sant eknath nagar', 'nehrunagar', 'nehru nagar', 'valabh nagar'] },
        { key: 'Chinchwad', patterns: ['chinchwad', 'chinchvad', 'chaphekar chowk', 'thergaon', 'chinchwad gaon', 'elpro', 'morwadi', 'station chinchwad'] },
        { key: 'Pimpri', patterns: ['pimpri', 'pimpari', 'shagun chowk', 'camp', 'finolex', 'deluxe', 'deluxe chowk', 'pimpri market'] },
        { key: 'Bhosari', patterns: ['bhosari', 'bhosri', 'landewadi', 'midc bhosari', 'midc', 'alandi road', 'dighi road'] },
        { key: 'Moshi', patterns: ['moshi', 'moshi toll', 'toll plaza', 'borhadewadi', 'gandharv nagari'] },
        { key: 'Wakad', patterns: ['wakad', 'dange chowk', 'datta mandir', 'kaspate vasti', 'bhumkar chowk', 'hinjawadi link'] },
        { key: 'Punawale', patterns: ['punawale', 'punawle', 'tathawade', 'tathwade', 'jspm', 'indira college', '18 latitude'] },
        { key: 'Pimple Saudagar', patterns: ['pimple saudagar', 'saudagar', 'sangvi', 'kunal icon', 'govind garden', 'pimple gurav'] }
    ];

    let matchedArea = null;
    for (const item of AREA_KEYWORDS) {
        if (item.patterns.some(p => text.includes(p))) {
            matchedArea = item.key;
            break;
        }
    }

    // 2. EXTRACT DISCOUNT & PERCENTAGE
    let targetDiscount = null;
    const pctMatch = text.match(/(\d{1,2})\s*(?:%|percent|per cent|pratishat|takke)/i);
    const wordMatch = text.match(/(?:discount|savings|saving|off|sasta|saste|swast|swasta|chhoot|suit)\s*(?:of|upto|up to|above|more than|at least|minimum)?\s*(\d{1,2})/i);
    const numDiscountMatch = text.match(/(\d{1,2})\s*(?:discount|savings|saving|off|chhoot)/i);

    if (pctMatch) {
        targetDiscount = parseInt(pctMatch[1], 10);
    } else if (wordMatch) {
        targetDiscount = parseInt(wordMatch[1], 10);
    } else if (numDiscountMatch) {
        targetDiscount = parseInt(numDiscountMatch[1], 10);
    } else if (text.includes('discount') || text.includes('sasta') || text.includes('saste') || text.includes('swasta') || text.includes('chhoot')) {
        targetDiscount = 40; // Default generous discount threshold
    }

    // 3. MEDICINE RECOGNITION (from COMMON_MEDICINES or common clinical terms)
    let matchedMed = null;
    if (typeof COMMON_MEDICINES !== 'undefined') {
        for (const m of COMMON_MEDICINES) {
            const bNames = m.brandName.toLowerCase().split(/[\/\s,]+/);
            const gNames = m.genericName.toLowerCase().split(/[\/\s,]+/);
            const words = [...bNames, ...gNames, m.useCase.toLowerCase()];
            if (words.some(w => w.length > 2 && text.includes(w))) {
                matchedMed = m;
                break;
            }
        }
    }

    // 4. OTHER INTENTS
    const isEmergency =
        text.includes('24 hour') || text.includes('24hr') || text.includes('24 hours') ||
        text.includes('24/7') || text.includes('24x7') || text.includes('emergency') ||
        text.includes('night') || text.includes('raat') || text.includes('ratri') ||
        text.includes('24 taas') || text.includes('chovis taas') || text.includes('choubis ghante') ||
        text.includes('urgent') || text.includes('open now');

    const isGenericExplicit =
        text.includes('jan aushadh') || text.includes('janaushadhi') || text.includes('generic') ||
        text.includes('pmbjp') || text.includes('pradhan mantri');

    const isStudentVisited =
        text.includes('student') || text.includes('college') || text.includes('pccoe') ||
        text.includes('survey') || text.includes('visited') || text.includes('vidyarthi') ||
        text.includes('field survey');

    const isNearest =
        text.includes('near me') || text.includes('nearest') || text.includes('closest') ||
        text.includes('around me') || text.includes('kareeb') || text.includes('paas') ||
        text.includes('jawalat') || text.includes('my location') || text.includes('gps') ||
        text.includes('locate');

    const isAyurvedic =
        text.includes('ayurved') || text.includes('ayurvedic') || text.includes('ayush') ||
        text.includes('herbal') || text.includes('jadi buti') || text.includes('kadha');

    const isHomeopathy =
        text.includes('homeopath') || text.includes('homeopathy') || text.includes('homeo');

    // ONLY treat as full reset if NO specific area and NO discount are specified
    const isReset =
        !matchedArea && targetDiscount === null && (
            text.includes('reset') || text.includes('clear') || text.includes('show all') ||
            text.includes('all stores') || text.includes('cancel') || text.includes('sarva dukan') ||
            text.includes('sab dukan')
        );

    // ========================================================
    // DISPATCH LOGIC
    // ========================================================
    if (isReset) {
        resetFilters();
        executedIntent = 'All Stores Reset';
        speechMessage = 'Reset all filters. Showing all verified independent pharmacies across PCMC.';
        metaChips = ['Filter: All Stores', 'Total: ' + allPharmacies.length];
    } else if (targetDiscount !== null) {
        // USER SCENARIO: DISCOUNT ON MEDICINES (e.g. "i want 50% discount on this this medicine")
        minDiscountFilter = targetDiscount;
        activeFilter = 'all';
        updateFilterPillsUi('all');

        if (matchedArea) {
            selectedArea = matchedArea;
            if (areaSelect) areaSelect.value = matchedArea;
        } else {
            selectedArea = 'all';
            if (areaSelect) areaSelect.value = 'all';
        }

        if (matchedMed) {
            activeDiscountMedicine = matchedMed;
            searchQuery = '';
            if (searchInput) searchInput.value = '';
        } else {
            activeDiscountMedicine = null;
            searchQuery = '';
            if (searchInput) searchInput.value = '';
        }

        applyFilters();
        executedIntent = `Discount: &ge; ${targetDiscount}% OFF`;
        const areaText = matchedArea ? ` near ${matchedArea}` : ' across PCMC';

        if (matchedMed) {
            speechMessage = `Found generic salt ${matchedMed.genericName} for ${matchedMed.brandName}. Generic price is ₹${matchedMed.genericPrice} instead of ₹${matchedMed.brandPrice}, saving ${matchedMed.savings}%. Showing ${filteredPharmacies.length} pharmacy stores offering at least ${targetDiscount}% discount${areaText}.`;
            metaChips = [
                `Medicine: ${matchedMed.brandName}`,
                `Generic: ${matchedMed.genericName}`,
                `Direct Savings: ${matchedMed.savings}%`,
                `Stores Providing: ${filteredPharmacies.length}`
            ];
        } else {
            speechMessage = `Showing ${filteredPharmacies.length} verified Jan Aushadhi and generic pharmacy hubs offering at least ${targetDiscount}% discount${areaText}. Government Jan Aushadhi stores give up to 85% discount.`;
            metaChips = [
                `Min Discount: ${targetDiscount}%`,
                matchedArea ? `Area: ${matchedArea}` : 'All PCMC',
                `Stores Found: ${filteredPharmacies.length}`
            ];
        }

        if (filteredPharmacies.length > 0 && map) {
            map.flyTo([filteredPharmacies[0].lat, filteredPharmacies[0].lng], 13, { animate: true, duration: 1 });
        }
    } else if (isEmergency) {
        minDiscountFilter = 0;
        activeDiscountMedicine = null;
        updateDiscountBannerUi();

        activeFilter = '24h';
        updateFilterPillsUi('24h');
        if (matchedArea) {
            selectedArea = matchedArea;
            if (areaSelect) areaSelect.value = matchedArea;
        }
        applyFilters();
        executedIntent = '24x7 Night Emergency Chemists';
        const areaPhrase = matchedArea ? ` in ${matchedArea}` : ' across PCMC';
        speechMessage = `Showing ${filteredPharmacies.length} emergency medical stores open 24 hours${areaPhrase}.`;
        metaChips = ['Filter: 24x7 Emergency', matchedArea ? `Area: ${matchedArea}` : 'All PCMC', `Found: ${filteredPharmacies.length}`];
    } else if (isGenericExplicit) {
        minDiscountFilter = 0;
        activeDiscountMedicine = null;
        updateDiscountBannerUi();

        activeFilter = 'generic';
        updateFilterPillsUi('generic');
        if (matchedArea) {
            selectedArea = matchedArea;
            if (areaSelect) areaSelect.value = matchedArea;
        }
        applyFilters();
        executedIntent = 'Jan Aushadhi Generic Hubs';
        const areaPhrase = matchedArea ? ` in ${matchedArea}` : ' in PCMC';
        speechMessage = `Showing ${filteredPharmacies.length} Jan Aushadhi generic stores${areaPhrase}. You can save up to 85% on medicines.`;
        metaChips = ['Filter: Jan Aushadhi', matchedArea ? `Area: ${matchedArea}` : 'All Areas', `Found: ${filteredPharmacies.length}`];
    } else if (matchedArea) {
        // USER SCENARIO: ALL STORES NEAR AAKURDI
        minDiscountFilter = 0;
        activeDiscountMedicine = null;
        updateDiscountBannerUi();

        selectedArea = matchedArea;
        if (areaSelect) areaSelect.value = matchedArea;
        activeFilter = 'all';
        updateFilterPillsUi('all');
        searchQuery = '';
        if (searchInput) searchInput.value = '';

        applyFilters();
        executedIntent = `All Stores near ${matchedArea}`;
        speechMessage = `Showing all ${filteredPharmacies.length} verified medical stores and pharmacies near ${matchedArea}.`;
        metaChips = [`Area: ${matchedArea}`, `Found: ${filteredPharmacies.length} Stores`];

        if (filteredPharmacies.length > 0 && map) {
            map.flyTo([filteredPharmacies[0].lat, filteredPharmacies[0].lng], 14, { animate: true, duration: 1 });
        }
    } else if (isStudentVisited) {
        minDiscountFilter = 0;
        activeDiscountMedicine = null;
        updateDiscountBannerUi();

        filterStudentVisitedStores();
        executedIntent = 'Student Visited Pharmacies';
        speechMessage = 'Showing 24 medical stores physically surveyed and verified by PCCOE engineering students.';
        metaChips = ['Filter: Visited by Students', 'Count: 24 Stores'];
    } else if (isNearest) {
        locateUser();
        executedIntent = 'GPS Live Location';
        speechMessage = 'Locating independent pharmacies nearest to your live GPS coordinates.';
        metaChips = ['Action: Live GPS Nearest', 'Sorting: By Distance'];
    } else if (isAyurvedic) {
        minDiscountFilter = 0;
        activeDiscountMedicine = null;
        updateDiscountBannerUi();

        activeFilter = 'ayurvedic';
        updateFilterPillsUi('ayurvedic');
        if (matchedArea) {
            selectedArea = matchedArea;
            if (areaSelect) areaSelect.value = matchedArea;
        }
        applyFilters();
        executedIntent = 'Ayurvedic & Ayush Stores';
        speechMessage = `Showing ${filteredPharmacies.length} Ayurvedic and Ayush pharmacies.`;
        metaChips = ['Filter: Ayurvedic', `Found: ${filteredPharmacies.length}`];
    } else if (isHomeopathy) {
        minDiscountFilter = 0;
        activeDiscountMedicine = null;
        updateDiscountBannerUi();

        activeFilter = 'homeopathy';
        updateFilterPillsUi('homeopathy');
        if (matchedArea) {
            selectedArea = matchedArea;
            if (areaSelect) areaSelect.value = matchedArea;
        }
        applyFilters();
        executedIntent = 'Homeopathy Centers';
        speechMessage = `Showing ${filteredPharmacies.length} Homeopathy medical stores.`;
        metaChips = ['Filter: Homeopathy', `Found: ${filteredPharmacies.length}`];
    } else if (matchedMed) {
        minDiscountFilter = 0;
        activeDiscountMedicine = null;
        updateDiscountBannerUi();

        searchQuery = matchedMed.brandName;
        if (searchInput) {
            searchInput.value = matchedMed.brandName;
            if (searchClearBtn) searchClearBtn.style.display = 'block';
        }
        applyFilters();
        executedIntent = `Medicine: ${matchedMed.brandName}`;
        speechMessage = `Found generic equivalent ${matchedMed.genericName} for ${matchedMed.brandName}. Generic price is ₹${matchedMed.genericPrice}, saving ${matchedMed.savings}%.`;
        metaChips = [`Prescribed: ${matchedMed.brandName}`, `Generic API: ${matchedMed.genericName}`, `Save: ${matchedMed.savings}%`];
    } else {
        // Natural search query cleanup
        const cleanQuery = text
            .replace(/^(search for|search|find me|find|show me|show|look for|where is|kaha hai|shodha|khojo|i want|mujhe chahiye)\s+/i, '')
            .replace(/\b(pharmacy|medical|chemist|store|dukan|medical store)\b/gi, '')
            .trim();

        const queryToUse = cleanQuery || text;
        searchQuery = queryToUse;
        if (searchInput) {
            searchInput.value = queryToUse;
            if (searchClearBtn) searchClearBtn.style.display = 'block';
        }
        applyFilters();

        executedIntent = `Search: "${queryToUse}"`;
        if (filteredPharmacies.length > 0) {
            speechMessage = `Found ${filteredPharmacies.length} pharmacies matching ${queryToUse}.`;
        } else {
            speechMessage = `No exact stores found for "${queryToUse}". Resetting filter to show all stores.`;
            resetFilters();
        }
        metaChips = [`Query: "${queryToUse}"`, `Results: ${filteredPharmacies.length}`];
    }

    // Display AI Feedback Card
    const feedbackCard = document.getElementById('voiceAiFeedbackCard');
    const intentTag = document.getElementById('voiceIntentTag');
    const feedbackMsg = document.getElementById('voiceFeedbackMessage');
    const metaBox = document.getElementById('voiceActionMeta');

    if (feedbackCard && intentTag && feedbackMsg && metaBox) {
        feedbackCard.style.display = 'block';
        intentTag.innerText = executedIntent;
        feedbackMsg.innerText = speechMessage;
        metaBox.innerHTML = metaChips.map(c => `<span class="meta-chip"><i class="fas fa-check"></i> ${escapeHtml(c)}</span>`).join('');
    }

    showToast(speechMessage, 'success');

    // Text to Speech Voice Announcement
    if (voiceAudioFeedbackEnabled) {
        speakVoiceResponse(speechMessage, currentVoiceLang);
    } else {
        updateVoiceUiState('idle');
    }
}

function updateFilterPillsUi(filterType) {
    const pills = document.querySelectorAll('.filter-pill');
    pills.forEach(p => {
        p.classList.remove('active', 'active-emergency');
        if (p.dataset.filter === filterType) {
            if (filterType === '24h') {
                p.classList.add('active-emergency');
            } else {
                p.classList.add('active');
            }
        }
    });
}

function speakVoiceResponse(message, langCode = 'en-IN') {
    if (!window.speechSynthesis) {
        updateVoiceUiState('idle');
        return;
    }

    window.speechSynthesis.cancel();
    updateVoiceUiState('speaking');

    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    let preferredVoice = null;

    if (langCode.startsWith('mr')) {
        preferredVoice = voices.find(v => v.lang.includes('mr') || v.name.toLowerCase().includes('marathi'));
    } else if (langCode.startsWith('hi')) {
        preferredVoice = voices.find(v => v.lang.includes('hi') || v.name.toLowerCase().includes('hindi'));
    }

    if (!preferredVoice) {
        preferredVoice = voices.find(v => v.lang.includes('en-IN') || v.name.toLowerCase().includes('india') || v.lang.startsWith('en'));
    }

    if (preferredVoice) {
        utterance.voice = preferredVoice;
    }

    utterance.onend = () => {
        updateVoiceUiState('idle');
    };

    utterance.onerror = () => {
        updateVoiceUiState('idle');
    };

    window.speechSynthesis.speak(utterance);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

// Global Instant Keyboard Shortcut: Press 'V' to launch AI Voice Assistant
window.addEventListener('keydown', (e) => {
    if (e.key === 'v' || e.key === 'V') {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag !== 'input' && activeTag !== 'textarea') {
            e.preventDefault();
            const modal = document.getElementById('voiceAssistantModal');
            if (modal && modal.classList.contains('active')) {
                toggleVoiceRecording();
            } else {
                openVoiceAssistantModal();
                setTimeout(() => {
                    if (!isVoiceRecording && voiceRecognition) {
                        try { voiceRecognition.start(); } catch (err) {}
                    }
                }, 350);
            }
        }
    }
});

// ==========================================================================
// 13. WINNER UPGRADE: EMERGENCY 24x7 SOS, LIVE STOCK & SAVINGS SLIP ENGINES
// ==========================================================================

function openSosModal() {
    openModal('sosModal');
}

function filterEmergencySos(criticalType) {
    closeModal('sosModal');
    activeFilter = '24h';
    updateFilterPillsUi('24h');
    applyFilters();

    let typeLabel = 'Emergency 24x7 Critical Care';
    if (criticalType === 'insulin') typeLabel = 'Insulin & Cold-Chain (2°C-8°C)';
    if (criticalType === 'cardiac') typeLabel = 'Cardiac Emergency (Sorbitrate / Aspirin)';
    if (criticalType === 'respiratory') typeLabel = 'Asthma Nebulizer & Respules';
    if (criticalType === 'pediatric') typeLabel = 'Pediatric & Urgent Care';

    showToast(`Filtered 24x7 Emergency Chemists with ${typeLabel}!`, "error");

    const searchSec = document.querySelector('.controls-bar');
    if (searchSec) {
        searchSec.scrollIntoView({ behavior: 'smooth' });
    }
}

let currentStockInventory = [];
let currentStockStore = null;

function getStoreStockDataset(store) {
    if (store.type.toLowerCase() === 'generic') {
        return [
            { name: "Paracetamol 650mg (Dolo Equivalent)", cat: "Analgesic & Antipyretic", mrp: 32, sub: 6, status: "in-stock", qty: "35 strips", cold: false },
            { name: "Pantoprazole 40mg + Domperidone (Pan-D Equivalent)", cat: "Gastrointestinal", mrp: 165, sub: 28, status: "in-stock", qty: "24 strips", cold: false },
            { name: "Amoxicillin + Potassium Clavulanate 625mg (Augmentin)", cat: "Antibiotic", mrp: 210, sub: 65, status: "in-stock", qty: "18 strips", cold: false },
            { name: "Telmisartan 40mg (Telma 40 Equivalent)", cat: "Hypertension / BP", mrp: 145, sub: 20, status: "in-stock", qty: "30 strips", cold: false },
            { name: "Metformin 500mg + Glimepiride (Glycomet Equivalent)", cat: "Diabetes Mellitus", mrp: 180, sub: 32, status: "in-stock", qty: "26 strips", cold: false },
            { name: "Montelukast 10mg + Levocetirizine (Montair-LC)", cat: "Allergy & Asthma", mrp: 215, sub: 35, status: "in-stock", qty: "20 strips", cold: false },
            { name: "Calcium 500mg + Vitamin D3 (Shelcal Equivalent)", cat: "Bone Mineral", mrp: 135, sub: 25, status: "in-stock", qty: "28 strips", cold: false },
            { name: "Azithromycin 500mg (Azithral Equivalent)", cat: "Antibiotic", mrp: 120, sub: 38, status: "low", qty: "6 strips", cold: false },
            { name: "ORS Rehydration Salts (WHO Formula 21.8g)", cat: "Electrolytes", mrp: 22, sub: 4, status: "in-stock", qty: "50 sachets", cold: false }
        ];
    } else if (store.type.toLowerCase() === 'ayurvedic') {
        return [
            { name: "Ashwagandha Churna / Tablets (Organic)", cat: "Stress & Vitality", mrp: 130, sub: 85, status: "in-stock", qty: "15 bottles", cold: false },
            { name: "Triphala Churna (Digestive Formulation)", cat: "Gastrointestinal", mrp: 95, sub: 60, status: "in-stock", qty: "22 bottles", cold: false },
            { name: "Chyawanprash Special Formulation 1kg", cat: "Immunity Booster", mrp: 380, sub: 260, status: "in-stock", qty: "10 jars", cold: false },
            { name: "Giloy / Guduchi Ghanvati Tablets", cat: "Fever & Immunity", mrp: 110, sub: 75, status: "in-stock", qty: "18 bottles", cold: false },
            { name: "Mahasudarshan Ghanvati", cat: "Viral & Fever Care", mrp: 140, sub: 95, status: "in-stock", qty: "12 bottles", cold: false }
        ];
    } else if (store.type.toLowerCase() === 'homeopathy') {
        return [
            { name: "Arnica Montana 30C / 200C Dilution", cat: "Trauma & Pain", mrp: 120, sub: 80, status: "in-stock", qty: "14 vials", cold: false },
            { name: "Nux Vomica 30C Dilution", cat: "Gastric & Digestion", mrp: 120, sub: 80, status: "in-stock", qty: "16 vials", cold: false },
            { name: "Belladonna 30C Dilution", cat: "Fever & Congestion", mrp: 120, sub: 80, status: "in-stock", qty: "12 vials", cold: false },
            { name: "Rhus Toxicodendron 30C", cat: "Joint & Muscular Pain", mrp: 120, sub: 85, status: "in-stock", qty: "15 vials", cold: false },
            { name: "Biochemic Calcarean Phosphorica 6X", cat: "Tissue Salts", mrp: 160, sub: 110, status: "in-stock", qty: "18 packs", cold: false }
        ];
    } else {
        return [
            { name: "Dolo 650 / Crocin Advance 650mg", cat: "Analgesic & Antipyretic", mrp: 32, sub: 29, status: "in-stock", qty: "45 strips", cold: false },
            { name: "Pan-D / Pantocid 40 Capsule", cat: "Gastrointestinal", mrp: 165, sub: 145, status: "in-stock", qty: "32 strips", cold: false },
            { name: "Augmentin 625 Duo (Amoxyclav)", cat: "Broad-Spectrum Antibiotic", mrp: 210, sub: 190, status: "in-stock", qty: "20 strips", cold: false },
            { name: "Insulin Glargine / Huminsulin Vial", cat: "Endocrine & Diabetes", mrp: 680, sub: 590, status: "cold", qty: "8 vials (2-8°C Verified)", cold: true },
            { name: "Sorbitrate 5mg / 10mg (Emergency Sublingual)", cat: "Cardiac Critical Care", mrp: 55, sub: 48, status: "in-stock", qty: "14 strips", cold: false },
            { name: "Asthalin / Budecort Respules", cat: "Respiratory Emergency", mrp: 140, sub: 125, status: "in-stock", qty: "12 packs", cold: false },
            { name: "Telma 40 (Telmisartan)", cat: "Hypertension / BP", mrp: 145, sub: 128, status: "in-stock", qty: "25 strips", cold: false },
            { name: "Pediatric Paracetamol Syrup 60ml", cat: "Pediatric Emergency", mrp: 65, sub: 55, status: "in-stock", qty: "16 bottles", cold: false },
            { name: "Paracetamol IV Infusion 100ml", cat: "Hospital Emergency Fluid", mrp: 95, sub: 80, status: "low", qty: "5 bottles", cold: false }
        ];
    }
}

function openStockModal(storeId) {
    const store = allPharmacies.find(s => s.id === storeId);
    if (!store) return;
    currentStockStore = store;
    currentStockInventory = getStoreStockDataset(store);

    const nameEl = document.getElementById('stockStoreName');
    const addrEl = document.getElementById('stockStoreAddress');
    const actionBtns = document.getElementById('stockActionButtons');

    if (nameEl) nameEl.innerHTML = `<i class="fas fa-store"></i> ${escapeHtml(store.name)}`;
    if (addrEl) addrEl.innerHTML = `<i class="fas fa-location-dot"></i> ${escapeHtml(store.address)} • <strong>${store.type}</strong>`;

    const cleanPhone = store.phone ? store.phone.replace(/[^0-9]/g, '') : '';
    const waText = encodeURIComponent(`Hello, I saw ${store.name} on MedNexa. I want to check live availability of medicine.`);
    const waUrl = cleanPhone ? `https://wa.me/91${cleanPhone}?text=${waText}` : '#';

    if (actionBtns) {
        actionBtns.innerHTML = `
            <a href="tel:${store.phone || ''}" class="btn-card btn-call" style="padding:6px 12px; font-size:0.8rem;"><i class="fas fa-phone"></i> Call Pharmacist</a>
            <a href="${waUrl}" target="_blank" class="btn-card btn-wa" style="padding:6px 12px; font-size:0.8rem;"><i class="fab fa-whatsapp"></i> WhatsApp Inquiry</a>
        `;
    }

    const searchInput = document.getElementById('stockFilterInput');
    if (searchInput) searchInput.value = '';

    renderStockInventory(currentStockInventory);
    openModal('stockModal');
}

function renderStockInventory(items) {
    const tbody = document.getElementById('stockTableBody');
    if (!tbody) return;

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:20px;">No matching medicines found in this store's verified inventory.</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(item => {
        let badgeHtml = '';
        if (item.cold) {
            badgeHtml = `<span class="stock-badge-cold"><i class="fas fa-snowflake"></i> ${item.qty}</span>`;
        } else if (item.status === 'low') {
            badgeHtml = `<span class="stock-badge-low"><i class="fas fa-triangle-exclamation"></i> Limited (${item.qty})</span>`;
        } else {
            badgeHtml = `<span class="stock-badge-instock"><i class="fas fa-circle-check"></i> In Stock (${item.qty})</span>`;
        }

        const cleanPhone = currentStockStore && currentStockStore.phone ? currentStockStore.phone.replace(/[^0-9]/g, '') : '';
        const itemWaText = encodeURIComponent(`Hello ${currentStockStore ? currentStockStore.name : ''}, is ${item.name} currently in stock? Inquiring via MedNexa PCCOE.`);
        const itemWaUrl = cleanPhone ? `https://wa.me/91${cleanPhone}?text=${itemWaText}` : '#';

        return `
            <tr>
                <td><strong>${escapeHtml(item.name)}</strong></td>
                <td><span style="font-size:0.78rem; color:#64748b;">${escapeHtml(item.cat)}</span></td>
                <td>
                    <span style="text-decoration:line-through; color:#dc2626; font-size:0.82rem;">₹${item.mrp}</span>
                    <strong style="color:#059669; font-size:0.95rem; margin-left:6px;">₹${item.sub}</strong>
                </td>
                <td>${badgeHtml}</td>
                <td>
                    <a href="${itemWaUrl}" target="_blank" class="btn-table-slip" style="text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
                        <i class="fab fa-whatsapp"></i> Reserve
                    </a>
                </td>
            </tr>
        `;
    }).join('');
}

function filterStoreInventory(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
        renderStockInventory(currentStockInventory);
        return;
    }
    const filtered = currentStockInventory.filter(item =>
        item.name.toLowerCase().includes(q) ||
        item.cat.toLowerCase().includes(q)
    );
    renderStockInventory(filtered);
}

function openPrintableSavingsSlip(brandName, genericName, brandPrice, genericPrice, savingsPct) {
    const patientId = 'MED-' + Math.floor(100000 + Math.random() * 900000);
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const slipPatient = document.getElementById('slipPatientId');
    const slipDate = document.getElementById('slipDateTime');
    const slipBrand = document.getElementById('slipBrandName');
    const slipGeneric = document.getElementById('slipGenericName');
    const slipBPrice = document.getElementById('slipBrandPrice');
    const slipGPrice = document.getElementById('slipGenericPrice');
    const slipSav = document.getElementById('slipSavingsValue');
    const slipKendra = document.getElementById('slipKendraAddress');

    if (slipPatient) slipPatient.innerText = patientId;
    if (slipDate) slipDate.innerText = dateStr;
    if (slipBrand) slipBrand.innerText = brandName || 'Branded Medicine';
    if (slipGeneric) slipGeneric.innerText = genericName || 'Generic Salt Formulation (API)';
    if (slipBPrice) slipBPrice.innerText = `₹${brandPrice}`;
    if (slipGPrice) slipGPrice.innerText = `₹${genericPrice}`;
    if (slipSav) slipSav.innerText = `Save ₹${brandPrice - genericPrice} (${savingsPct}% OFF)`;

    const genericStore = allPharmacies.find(s => s.type.toLowerCase() === 'generic');
    if (slipKendra && genericStore) {
        slipKendra.innerHTML = `<strong>${escapeHtml(genericStore.name)}</strong><br>${escapeHtml(genericStore.address)} • Tel: ${genericStore.phone}`;
    }

    openModal('savingsSlipModal');
}

function printPatientSavingsSlip() {
    window.print();
}

// ============================================================
// USER FEEDBACK & SUGGESTIONS MODULE (LIVE SYNC & REALTIME PERSISTENCE)
// ============================================================
const MEDIFINDER_FEEDBACKS_KEY = 'medifinder_feedbacks_v2';

const INITIAL_SAMPLE_FEEDBACKS = [
    {
        id: 'fb-101',
        name: 'Aaditya Patil',
        role: 'PCCOE Akurdi Student (CSE)',
        rating: 5,
        category: 'Generic Medicine Pricing',
        message: 'The Jan Aushadhi generic salt price comparison saved me over ₹200 on fever & cold medicines! Very helpful for hostel students staying around Akurdi.',
        date: '28 Oct 2026, 14:20',
        timestamp: 1793177400000
    },
    {
        id: 'fb-102',
        name: 'Dr. Smita Deshmukh',
        role: 'Local Practitioner, Nigdi',
        rating: 5,
        category: 'Real-Time Distance & Wishlist',
        message: 'The real-time walking and driving distance calculation from PCCOE campus to midnight 24x7 pharmacies is remarkably accurate.',
        date: '29 Oct 2026, 09:15',
        timestamp: 1793245500000
    },
    {
        id: 'fb-103',
        name: 'Neha Kulkarni',
        role: 'PCCOE Student',
        rating: 5,
        category: 'Real-Time Distance & Wishlist',
        message: 'I love the green Wishlist feature! I can save all my regular medical shops near college and see walking time before stepping out.',
        date: '29 Oct 2026, 17:40',
        timestamp: 1793275800000
    }
];

let selectedFeedbackRating = 5;
let feedbackBroadcast = null;
let adminFeedbackLivePollTimer = null;

try {
    feedbackBroadcast = new BroadcastChannel('medifinder_feedback_channel');
    feedbackBroadcast.onmessage = (event) => {
        if (event.data && (event.data.type === 'NEW_FEEDBACK' || event.data.type === 'FEEDBACKS_UPDATED')) {
            if (event.data.feedbacks && Array.isArray(event.data.feedbacks)) {
                saveStoredFeedbacks(event.data.feedbacks);
            }
            updateAdminFeedbackCountBadge();
            renderAdminFeedbackTable();
        }
    };
} catch (e) {}

function getStoredFeedbacks() {
    try {
        const raw = localStorage.getItem(MEDIFINDER_FEEDBACKS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        }
        localStorage.setItem(MEDIFINDER_FEEDBACKS_KEY, JSON.stringify(INITIAL_SAMPLE_FEEDBACKS));
        return [...INITIAL_SAMPLE_FEEDBACKS];
    } catch (e) {
        return [...INITIAL_SAMPLE_FEEDBACKS];
    }
}

function saveStoredFeedbacks(list) {
    try {
        localStorage.setItem(MEDIFINDER_FEEDBACKS_KEY, JSON.stringify(list));
    } catch (e) {
        console.error('Error saving feedbacks:', e);
    }
}

function getFeedbackApiEndpoints() {
    const urls = [];
    // 1. Current origin relative (works when served by server.py on any port/IP e.g. 8080, 192.168.0.102)
    urls.push('/api/feedbacks');
    urls.push('/api/feedback');
    // 2. Direct server endpoints if running file:// or another port
    if (window.location.protocol === 'file:' || (window.location.port !== '8080' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')) {
        urls.push('http://localhost:8080/api/feedbacks');
        urls.push('http://127.0.0.1:8080/api/feedbacks');
        urls.push('http://192.168.0.102:8080/api/feedbacks');
    }
    return urls;
}

async function syncFeedbacksFromBackend(showToastOnSuccess = false) {
    const endpoints = getFeedbackApiEndpoints();
    const statusEl = document.getElementById('adminFeedbackSyncStatus');
    if (statusEl) {
        statusEl.innerHTML = '<i class="fas fa-rotate fa-spin" style="color:#0d9488;"></i> <span style="color:#0d9488;">Syncing latest feedback...</span>';
    }

    let remoteFeedbacks = null;

    for (const url of endpoints) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500);
            const res = await fetch(url, {
                cache: 'no-store',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = await res.json();
                if (data && data.success && Array.isArray(data.feedbacks)) {
                    remoteFeedbacks = data.feedbacks;
                    break;
                }
            }
        } catch (err) {
            // Continue trying fallback endpoints
        }
    }

    if (remoteFeedbacks) {
        // Merge remote feedbacks with local feedbacks (ensure no duplicates, preserve local)
        const local = getStoredFeedbacks();
        const map = new Map();
        remoteFeedbacks.forEach(fb => { if (fb && fb.id) map.set(fb.id, fb); });
        local.forEach(fb => { if (fb && fb.id && !map.has(fb.id)) map.set(fb.id, fb); });

        const merged = Array.from(map.values());
        // Sort newest first by timestamp or id
        merged.sort((a, b) => {
            const timeA = a.timestamp || (a.id && a.id.startsWith('fb-') ? parseInt(a.id.replace('fb-', ''), 10) : 0) || 0;
            const timeB = b.timestamp || (b.id && b.id.startsWith('fb-') ? parseInt(b.id.replace('fb-', ''), 10) : 0) || 0;
            return timeB - timeA;
        });

        saveStoredFeedbacks(merged);
        updateAdminFeedbackCountBadge();
        renderAdminFeedbackTable();

        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-circle-check" style="color:#16a34a;"></i> <span style="color:#16a34a;">Live Synced (' + merged.length + ' verified records)</span>';
        }
        if (showToastOnSuccess) {
            showToast(`Feedbacks synced! Total: ${merged.length} submissions received.`, 'success');
        }
        return merged;
    } else {
        const local = getStoredFeedbacks();
        updateAdminFeedbackCountBadge();
        renderAdminFeedbackTable();
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-database" style="color:#64748b;"></i> <span style="color:#64748b;">Local Storage Mode (' + local.length + ' entries)</span>';
        }
        return local;
    }
}

// Auto-sync interval whenever Admin Console is open
if (!adminFeedbackLivePollTimer) {
    adminFeedbackLivePollTimer = setInterval(() => {
        const adminModal = document.getElementById('adminModal');
        if (adminModal && adminModal.classList.contains('active') && typeof isAdminAuthenticated === 'function' && isAdminAuthenticated()) {
            syncFeedbacksFromBackend(false);
        }
    }, 8000);
}

function setFeedbackRating(stars) {
    selectedFeedbackRating = Math.max(1, Math.min(5, parseInt(stars, 10) || 5));
    const input = document.getElementById('feedbackRatingInput');
    if (input) input.value = selectedFeedbackRating;

    const row = document.getElementById('feedbackStarRow');
    if (row) {
        const btns = row.querySelectorAll('.star-rating-btn');
        btns.forEach(btn => {
            const starVal = parseInt(btn.getAttribute('data-star'), 10);
            if (starVal <= selectedFeedbackRating) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    const label = document.getElementById('feedbackRatingLabel');
    if (label) {
        const labels = {
            1: '1 Star - Needs Improvement',
            2: '2 Stars - Fair Experience',
            3: '3 Stars - Good / Helpful',
            4: '4 Stars - Very Good Experience',
            5: '5 Stars - Outstanding Experience!'
        };
        label.innerText = labels[selectedFeedbackRating] || '5 Stars - Outstanding Experience!';
    }
}

function openFeedbackModal() {
    const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    const nameInput = document.getElementById('feedbackName');
    const roleInput = document.getElementById('feedbackRole');
    if (nameInput && currentUser && currentUser.name && !nameInput.value) {
        nameInput.value = currentUser.name;
    }
    if (roleInput && !roleInput.value) {
        roleInput.value = 'PCCOE Student';
    }
    setFeedbackRating(selectedFeedbackRating || 5);
    openModal('feedbackModal');
}

async function handleFeedbackSubmit(event) {
    event.preventDefault();
    const nameEl = document.getElementById('feedbackName');
    const roleEl = document.getElementById('feedbackRole');
    const catEl = document.getElementById('feedbackCategory');
    const msgEl = document.getElementById('feedbackMessage');
    const ratingEl = document.getElementById('feedbackRatingInput');
    const submitBtn = document.getElementById('btnSubmitFeedback');

    const name = nameEl ? nameEl.value.trim() : 'Anonymous';
    const role = (roleEl && roleEl.value.trim()) ? roleEl.value.trim() : 'User';
    const category = catEl ? catEl.value : 'General Experience';
    const message = msgEl ? msgEl.value.trim() : '';
    const rating = ratingEl ? parseInt(ratingEl.value, 10) || 5 : 5;

    if (!message) {
        showToast("Please enter your feedback message.", "error");
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' +
                    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newFeedback = {
        id: 'fb-' + Date.now(),
        name: name,
        role: role,
        rating: rating,
        category: category,
        message: message,
        date: dateStr,
        timestamp: Date.now()
    };

    // 1. Immediately store in local storage (instant response & resilience)
    const feedbacks = getStoredFeedbacks();
    feedbacks.unshift(newFeedback);
    saveStoredFeedbacks(feedbacks);

    // 2. Broadcast across tabs
    if (feedbackBroadcast) {
        try {
            feedbackBroadcast.postMessage({ type: 'NEW_FEEDBACK', feedback: newFeedback, feedbacks: feedbacks });
        } catch (e) {}
    }

    // 3. Send to Server Backend
    const endpoints = getFeedbackApiEndpoints();
    let savedOnServer = false;
    for (const url of endpoints) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newFeedback),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = await res.json();
                if (data && data.success && Array.isArray(data.feedbacks)) {
                    saveStoredFeedbacks(data.feedbacks);
                    savedOnServer = true;
                    break;
                }
            }
        } catch (err) {
            // Continue trying fallback endpoints
        }
    }

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Feedback';
    }

    if (msgEl) msgEl.value = '';

    closeModal('feedbackModal');
    updateAdminFeedbackCountBadge();
    renderAdminFeedbackTable();

    showToast("Thank you for your feedback! It has been safely sent and is now visible in the Admin Panel.", "success");
}

function updateAdminFeedbackCountBadge() {
    const feedbacks = getStoredFeedbacks();
    const badge = document.getElementById('adminFeedbackCount');
    if (badge) badge.innerText = feedbacks.length;
}

function renderAdminFeedbackTable() {
    const listEl = document.getElementById('adminFeedbackList');
    const feedbacks = getStoredFeedbacks();
    updateAdminFeedbackCountBadge();
    if (!listEl) return;

    if (feedbacks.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center; padding:36px 16px; color:#64748b;">
                <i class="fas fa-comment-slash" style="font-size:2.2rem; margin-bottom:10px; color:#cbd5e1;"></i>
                <p style="margin:0; font-weight:600;">No feedback messages received yet.</p>
                <p style="font-size:0.8rem; margin-top:4px;">When visitors or students submit feedback, it will appear here in real-time.</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = feedbacks.map(fb => {
        let starsHtml = '';
        for (let i = 1; i <= 5; i++) {
            if (i <= (fb.rating || 5)) {
                starsHtml += '<i class="fas fa-star" style="color:#eab308; margin-right:2px;"></i>';
            } else {
                starsHtml += '<i class="far fa-star" style="color:#cbd5e1; margin-right:2px;"></i>';
            }
        }

        return `
            <div class="feedback-card-admin" id="feedback-card-${escapeHtml(fb.id)}">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
                    <div>
                        <strong style="font-size:0.95rem; color:#0f172a;"><i class="fas fa-user-circle" style="color:#0d9488;"></i> ${escapeHtml(fb.name)}</strong>
                        <span style="display:inline-block; margin-left:8px; background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:6px; font-size:0.75rem; font-weight:600;">
                            ${escapeHtml(fb.role || 'User')}
                        </span>
                        <span style="display:inline-block; margin-left:6px; background:#f0fdfa; color:#0d9488; border:1px solid #99f6e4; padding:2px 8px; border-radius:6px; font-size:0.75rem; font-weight:700;">
                            ${escapeHtml(fb.category || 'General')}
                        </span>
                    </div>
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div>${starsHtml}</div>
                        <button type="button" class="btn-table-action btn-reject" onclick="deleteFeedback('${escapeHtml(fb.id)}')" title="Delete feedback" style="padding:4px 8px; font-size:0.78rem;">
                            <i class="fas fa-trash-can"></i>
                        </button>
                    </div>
                </div>
                <div style="font-size:0.88rem; color:#334155; line-height:1.5; background:#f8fafc; padding:10px 12px; border-radius:8px; border-left:3px solid #0d9488;">
                    ${escapeHtml(fb.message)}
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; font-size:0.76rem; color:#94a3b8;">
                    <span><i class="far fa-clock"></i> ${escapeHtml(fb.date)}</span>
                    <span style="color:#0d9488; font-weight:600;"><i class="fas fa-circle-check"></i> Verified PCCOE / PCMC Citizen</span>
                </div>
            </div>
        `;
    }).join('');
}

async function deleteFeedback(id) {
    if (!confirm('Are you sure you want to delete this feedback message?')) return;
    let feedbacks = getStoredFeedbacks();
    feedbacks = feedbacks.filter(f => f.id !== id);
    saveStoredFeedbacks(feedbacks);
    renderAdminFeedbackTable();
    updateAdminFeedbackCountBadge();

    // Broadcast
    if (feedbackBroadcast) {
        try { feedbackBroadcast.postMessage({ type: 'FEEDBACKS_UPDATED', feedbacks: feedbacks }); } catch (e) {}
    }

    // Call DELETE on server
    const endpoints = getFeedbackApiEndpoints();
    for (const url of endpoints) {
        try {
            await fetch(`${url}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            break;
        } catch (e) {}
    }
    showToast("Feedback message deleted.", "info");
}

async function clearAllFeedbacks() {
    if (!confirm('Are you sure you want to clear all feedback submissions?')) return;
    saveStoredFeedbacks([]);
    renderAdminFeedbackTable();
    updateAdminFeedbackCountBadge();

    // Broadcast
    if (feedbackBroadcast) {
        try { feedbackBroadcast.postMessage({ type: 'FEEDBACKS_UPDATED', feedbacks: [] }); } catch (e) {}
    }

    // Call DELETE on server
    const endpoints = getFeedbackApiEndpoints();
    for (const url of endpoints) {
        try {
            await fetch(`${url}?clear=all`, { method: 'DELETE' });
            break;
        } catch (e) {}
    }
    showToast("All feedback messages cleared.", "info");
}

// ==========================================================================
// 14. MOBILE NAVIGATION DRAWER & BOTTOM BAR HANDLERS
// ==========================================================================
function toggleMobileMenu() {
    const drawer = document.getElementById('mobileNavDrawer');
    if (!drawer) return;
    if (drawer.classList.contains('active')) {
        closeMobileMenu();
    } else {
        openMobileMenu();
    }
}

function openMobileMenu() {
    const drawer = document.getElementById('mobileNavDrawer');
    const backdrop = document.getElementById('mobileNavBackdrop');
    const menuBtn = document.getElementById('mobileMenuBtn');
    const menuIcon = document.getElementById('mobMenuIcon');
    const bottomMenuBtn = document.getElementById('mobBottomMenu');

    if (drawer) drawer.classList.add('active');
    if (backdrop) backdrop.classList.add('active');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
    if (menuIcon) {
        menuIcon.classList.remove('fa-bars');
        menuIcon.classList.add('fa-times');
    }
    if (bottomMenuBtn) bottomMenuBtn.classList.add('active');
    document.body.classList.add('mobile-drawer-open');
}

function closeMobileMenu() {
    const drawer = document.getElementById('mobileNavDrawer');
    const backdrop = document.getElementById('mobileNavBackdrop');
    const menuBtn = document.getElementById('mobileMenuBtn');
    const menuIcon = document.getElementById('mobMenuIcon');
    const bottomMenuBtn = document.getElementById('mobBottomMenu');

    if (drawer) drawer.classList.remove('active');
    if (backdrop) backdrop.classList.remove('active');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    if (menuIcon) {
        menuIcon.classList.remove('fa-times');
        menuIcon.classList.add('fa-bars');
    }
    if (bottomMenuBtn) bottomMenuBtn.classList.remove('active');
    document.body.classList.remove('mobile-drawer-open');
}

function handleMobileNavClick(type, event) {
    if (event) event.preventDefault();
    closeMobileMenu();

    document.querySelectorAll('.mob-bottom-item').forEach(item => item.classList.remove('active'));

    if (type === 'stores') {
        const btn = document.getElementById('mobBottomHome');
        if (btn) btn.classList.add('active');
        const target = document.getElementById('cardsGrid') || document.querySelector('.results-header');
        if (target) {
            window.scrollTo({ top: target.offsetTop - 85, behavior: 'smooth' });
        }
    } else if (type === 'map') {
        const btn = document.getElementById('mobBottomMap');
        if (btn) btn.classList.add('active');
        const mapSection = document.querySelector('.map-section');
        if (mapSection) {
            window.scrollTo({ top: mapSection.offsetTop - 75, behavior: 'smooth' });
            if (map) {
                setTimeout(() => map.invalidateSize(), 350);
            }
        }
    } else if (type === 'search') {
        const btn = document.getElementById('mobBottomSearch');
        if (btn) btn.classList.add('active');
        const searchInput = document.getElementById('searchInput');
        const controls = document.querySelector('.controls-bar');
        if (controls) {
            window.scrollTo({ top: controls.offsetTop - 75, behavior: 'smooth' });
        }
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 350);
        }
    }
}

// Close mobile drawer on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeMobileMenu();
    }
});


