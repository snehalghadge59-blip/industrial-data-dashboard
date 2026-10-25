/**
 * MEDNEXA — MOBILE QR HUB & IN-APP SCANNER ENGINE
 * Comprehensive QR generator for mobile handoff and high-accuracy QR/Barcode scanner
 */

let currentQrCodeInstance = null;
let html5QrScannerInstance = null;
let isScannerActive = false;
let currentCameraFacing = 'environment'; // 'environment' (back) or 'user' (selfie)
let activeQrTab = 'generate';
let activeScannerInput = 'camera';
let activeStoreDeepLink = null;

// ==========================================================================
// 1. INITIALIZATION & DEEP-LINK LISTENER
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    initQrHub();
    checkScannedStoreDeepLink();
});

function initQrHub() {
    populateQrPharmacyDropdown();

    // Auto-detect localhost vs network IP and suggest mobile testing tip
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const localHint = document.getElementById('qrLocalhostHint');
    if (localHint) {
        localHint.style.display = isLocalhost ? 'block' : 'none';
    }

    // Set initial URL
    const urlInput = document.getElementById('qrUrlInput');
    if (urlInput) {
        urlInput.value = window.location.href;
    }
}

// Check if MedNexa was opened via a scanned store QR code (e.g. ?store=stu-chw-1 or #store-stu-chw-1)
function checkScannedStoreDeepLink() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        let targetStoreId = urlParams.get('store');

        if (!targetStoreId && window.location.hash) {
            const hash = window.location.hash.replace('#', '');
            if (hash.startsWith('store-')) {
                targetStoreId = hash.replace('store-', '');
            } else if (hash.startsWith('card-')) {
                targetStoreId = hash.replace('card-', '');
            }
        }

        if (targetStoreId && typeof allPharmacies !== 'undefined') {
            setTimeout(() => {
                highlightAndNavigateToStore(targetStoreId, true);
            }, 600);
        }
    } catch (e) {
        console.error("Deep link parse error:", e);
    }
}

// Highlight and center on a store when navigated via QR code
function highlightAndNavigateToStore(storeId, fromScannedLink = false) {
    if (!allPharmacies || allPharmacies.length === 0) return;

    const store = allPharmacies.find(s => String(s.id) === String(storeId));
    if (!store) return;

    // Focus on map
    if (typeof focusOnMap === 'function') {
        focusOnMap(store.lat, store.lng);
    }

    // Scroll to store card and pulse
    const cardEl = document.getElementById(`card-${store.id}`);
    if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        cardEl.classList.add('card-highlight-pulse');
        setTimeout(() => {
            cardEl.classList.remove('card-highlight-pulse');
        }, 4000);
    }

    if (fromScannedLink && typeof showToast === 'function') {
        showToast(`📍 Scanned QR Code: Loaded ${store.name}!`, "success");
    }
}

// Populate pharmacy dropdown in the QR Generator tab
function populateQrPharmacyDropdown() {
    const optGroup = document.getElementById('qrPharmacyOptGroup');
    if (!optGroup || typeof allPharmacies === 'undefined') return;

    optGroup.innerHTML = '';
    allPharmacies.forEach(store => {
        const opt = document.createElement('option');
        opt.value = `store:${store.id}`;
        opt.textContent = `📍 ${store.name} (${store.area})`;
        optGroup.appendChild(opt);
    });
}

// ==========================================================================
// 2. MODAL & TAB CONTROLS
// ==========================================================================
function openMobileQrModal(tab = 'scan', targetStoreId = null) {
    openModal('mobileQrModal');
    switchQrModalTab('scan');
}

function openStoreQrModal(storeId) {
    openMobileQrModal('scan', storeId);
}

function closeQrModal() {
    stopCameraScanner();
    closeModal('mobileQrModal');
}

function switchQrModalTab(tab = 'scan') {
    activeQrTab = 'scan';
    const btnGen = document.getElementById('tabBtnGenerate');
    const btnScan = document.getElementById('tabBtnScan');
    const tabGen = document.getElementById('qrTabGenerate');
    const tabScan = document.getElementById('qrTabScan');

    if (btnGen) btnGen.classList.remove('active');
    if (btnScan) btnScan.classList.add('active');
    if (tabGen) tabGen.classList.remove('active');
    if (tabScan) tabScan.classList.add('active');

    if (activeScannerInput === 'camera') {
        // Give modal animation 150ms to settle before starting viewport
        setTimeout(() => {
            startCameraScanner();
        }, 180);
    }
}

function switchScannerMode(mode) {
    activeScannerInput = mode;
    const btnCam = document.getElementById('btnModeCamera');
    const btnFile = document.getElementById('btnModeFile');
    const camArea = document.getElementById('cameraViewArea');
    const fileArea = document.getElementById('fileViewArea');

    if (mode === 'camera') {
        btnCam.classList.add('active');
        btnFile.classList.remove('active');
        camArea.style.display = 'block';
        fileArea.style.display = 'none';
        startCameraScanner();
    } else {
        btnCam.classList.remove('active');
        btnFile.classList.add('active');
        camArea.style.display = 'none';
        fileArea.style.display = 'block';
        stopCameraScanner();
    }
}

// ==========================================================================
// 3. QR CODE GENERATION ENGINE
// ==========================================================================
function getTargetQrUrl() {
    const select = document.getElementById('qrTargetSelect');
    const targetValue = select ? select.value : 'current';

    // Base origin and clean pathname
    const baseUrl = window.location.origin + window.location.pathname;

    if (targetValue === 'generic') {
        return `${baseUrl}?filter=generic#stores`;
    } else if (targetValue === '24h') {
        return `${baseUrl}?filter=24h#stores`;
    } else if (targetValue === 'student') {
        return `${baseUrl}?filter=student#stores`;
    } else if (targetValue.startsWith('store:')) {
        const storeId = targetValue.replace('store:', '');
        return `${baseUrl}?store=${encodeURIComponent(storeId)}#card-${encodeURIComponent(storeId)}`;
    }

    return window.location.href;
}

function onQrTargetChange() {
    const targetUrl = getTargetQrUrl();
    const select = document.getElementById('qrTargetSelect');
    const headingEl = document.getElementById('qrTargetHeading');
    const subEl = document.getElementById('qrTargetSub');
    const urlInput = document.getElementById('qrUrlInput');

    if (urlInput) urlInput.value = targetUrl;

    if (select && select.value.startsWith('store:')) {
        const storeId = select.value.replace('store:', '');
        const store = (typeof allPharmacies !== 'undefined') ? allPharmacies.find(s => String(s.id) === String(storeId)) : null;
        if (store) {
            headingEl.innerHTML = `Scan to Open: <strong>${store.name}</strong>`;
            subEl.innerText = `Point your phone camera to instantly open ${store.name} with live GPS navigation, phone call, and Jan Aushadhi generic stock info.`;
        }
    } else if (select && select.value === 'generic') {
        headingEl.innerHTML = `Scan for <strong>Jan Aushadhi Generic Hubs</strong>`;
        subEl.innerText = `Scan to open all Jan Aushadhi generic medical stores in PCMC with up to 85% price discounts on your phone.`;
    } else if (select && select.value === '24h') {
        headingEl.innerHTML = `Scan for <strong>24x7 Night Emergency Chemists</strong>`;
        subEl.innerText = `Scan to find all open midnight & 24x7 emergency medical stores around PCCOE and PCMC.`;
    } else if (select && select.value === 'student') {
        headingEl.innerHTML = `Scan for <strong>Stores Visited by Students</strong>`;
        subEl.innerText = `Scan to view the 24 ground-verified medical stores surveyed by PCCOE students.`;
    } else {
        headingEl.innerText = "Scan to Open MedNexa on Your Phone";
        subEl.innerText = "Point your smartphone camera or Google Lens at this QR code to instantly launch MedNexa on your mobile browser.";
    }

    updateGeneratedQrCode(targetUrl);
}

function updateGeneratedQrCode(customUrl = null) {
    const targetUrl = customUrl || getTargetQrUrl();
    const container = document.getElementById('qrCanvasContainer');
    if (!container) return;

    container.innerHTML = '';

    // Check if QRCode is available from qrcode.min.js
    if (typeof QRCode !== 'undefined') {
        try {
            currentQrCodeInstance = new QRCode(container, {
                text: targetUrl,
                width: 220,
                height: 220,
                colorDark: "#0f172a",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
            return;
        } catch (e) {
            console.warn("QRCode instantiation warning, trying fallback:", e);
        }
    }

    // High-resolution SVG / Canvas Fallback generator
    renderFallbackQr(container, targetUrl);
}

// Fallback high-contrast QR generator if qrcode.min.js is loading or offline
function renderFallbackQr(container, text) {
    const encoded = encodeURIComponent(text);
    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encoded}&color=0f172a&bgcolor=ffffff&qzone=2`;
    img.alt = "MedNexa Mobile QR Code";
    img.style.width = "220px";
    img.style.height = "220px";
    img.style.borderRadius = "8px";
    img.onerror = () => {
        container.innerHTML = `
            <div style="padding:20px; text-align:center; color:#64748b; font-size:0.85rem;">
                <i class="fas fa-qrcode" style="font-size:3rem; color:#0284c7; margin-bottom:10px;"></i>
                <p><strong>Mobile URL Ready:</strong></p>
                <input type="text" value="${text}" readonly style="width:100%; padding:6px; font-size:0.8rem; border:1px solid #cbd5e1; border-radius:6px; margin-top:6px;">
            </div>
        `;
    };
    container.appendChild(img);
}

// Copy Mobile Link to Clipboard
function copyQrUrl() {
    const urlInput = document.getElementById('qrUrlInput');
    const textToCopy = urlInput ? urlInput.value : window.location.href;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            if (typeof showToast === 'function') {
                showToast("Mobile link copied to clipboard!", "success");
            }
        }).catch(() => fallbackCopy(textToCopy));
    } else {
        fallbackCopy(textToCopy);
    }
}

function fallbackCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        if (typeof showToast === 'function') showToast("Mobile link copied to clipboard!", "success");
    } catch (err) {
        if (typeof showToast === 'function') showToast("Please copy link manually", "warning");
    }
    document.body.removeChild(textArea);
}

// Share Mobile Link via Web Share API
function shareQrUrl() {
    const url = document.getElementById('qrUrlInput') ? document.getElementById('qrUrlInput').value : window.location.href;
    const select = document.getElementById('qrTargetSelect');
    let title = "MedNexa — PCCOE Healthcare Website";
    let text = "Explore independent pharmacies & Jan Aushadhi generic stores in PCMC on MedNexa:";

    if (select && select.value.startsWith('store:')) {
        const storeId = select.value.replace('store:', '');
        const store = (typeof allPharmacies !== 'undefined') ? allPharmacies.find(s => String(s.id) === String(storeId)) : null;
        if (store) {
            title = `${store.name} — MedNexa Pharmacy`;
            text = `View ${store.name} (${store.area}) on MedNexa with GPS navigation & contact details:`;
        }
    }

    if (navigator.share) {
        navigator.share({
            title: title,
            text: text,
            url: url
        }).catch(err => {
            if (err.name !== 'AbortError') copyQrUrl();
        });
    } else {
        copyQrUrl();
    }
}

// Download QR Code as PNG with Branded Frame
function downloadQrCode() {
    const container = document.getElementById('qrCanvasContainer');
    if (!container) return;

    let canvas = container.querySelector('canvas');
    if (!canvas) {
        const img = container.querySelector('img');
        if (img) {
            // Draw img to canvas to download
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 300;
            tempCanvas.height = 360;
            const ctx = tempCanvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            ctx.drawImage(img, 40, 40, 220, 220);
            drawBrandedFrameText(ctx, tempCanvas);
            triggerCanvasDownload(tempCanvas);
            return;
        }
        if (typeof showToast === 'function') showToast("QR Code image not ready yet", "warning");
        return;
    }

    // Create high-res branded export canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 320;
    exportCanvas.height = 390;
    const ctx = exportCanvas.getContext('2d');

    // Clean white rounded background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Top Brand Header
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(0, 0, exportCanvas.width, 48);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MedNexa • PCCOE Healthcare', exportCanvas.width / 2, 30);

    // Draw QR code centered
    ctx.drawImage(canvas, 50, 65, 220, 220);

    // Footer info
    const select = document.getElementById('qrTargetSelect');
    let subLabel = "Scan to Open on Mobile";
    if (select && select.value.startsWith('store:')) {
        const storeId = select.value.replace('store:', '');
        const store = (typeof allPharmacies !== 'undefined') ? allPharmacies.find(s => String(s.id) === String(storeId)) : null;
        if (store) subLabel = store.name.substring(0, 32);
    }

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(subLabel, exportCanvas.width / 2, 318);

    ctx.fillStyle = '#64748b';
    ctx.font = '11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Jan Aushadhi Generics • 24x7 Chemists • Akurdi PCMC', exportCanvas.width / 2, 342);

    triggerCanvasDownload(exportCanvas);
}

function drawBrandedFrameText(ctx, canvas) {
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MedNexa • Scan with Smartphone', canvas.width / 2, 290);
    ctx.fillStyle = '#64748b';
    ctx.font = '11px sans-serif';
    ctx.fillText('PCCOE Student Innovation | Healthcare Technology', canvas.width / 2, 315);
}

function triggerCanvasDownload(canvas) {
    const link = document.createElement('a');
    link.download = `mednexa_qr_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    if (typeof showToast === 'function') {
        showToast("QR Code image downloaded successfully!", "success");
    }
}

// ==========================================================================
// 4. IN-APP SCANNER (LIVE CAMERA & IMAGE FILE SCANNING)
// ==========================================================================
function toggleScannerCamera() {
    if (isScannerActive) {
        stopCameraScanner();
    } else {
        startCameraScanner();
    }
}

function startCameraScanner() {
    if (isScannerActive) return;

    const qrReader = document.getElementById('qrReader');
    const reticle = document.getElementById('scannerReticle');
    const toggleBtn = document.getElementById('btnToggleCam');
    const switchBtn = document.getElementById('btnSwitchCam');
    const resultCard = document.getElementById('qrScanResult');

    if (resultCard) resultCard.style.display = 'none';

    // Verify Html5Qrcode is available
    if (typeof Html5Qrcode === 'undefined') {
        if (typeof showToast === 'function') {
            showToast("Scanner library is initializing. Please try again or upload image.", "warning");
        }
        return;
    }

    try {
        if (!html5QrScannerInstance) {
            html5QrScannerInstance = new Html5Qrcode("qrReader");
        }

        const config = {
            fps: 15,
            qrbox: { width: 230, height: 230 },
            aspectRatio: 1.0
        };

        if (toggleBtn) {
            toggleBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>Starting...</span>`;
            toggleBtn.disabled = true;
        }

        html5QrScannerInstance.start(
            { facingMode: currentCameraFacing },
            config,
            onScanSuccess,
            (errorMessage) => {
                // Parsing frame (no QR found yet) - silent
            }
        ).then(() => {
            isScannerActive = true;
            if (reticle) reticle.style.display = 'block';
            if (toggleBtn) {
                toggleBtn.innerHTML = `<i class="fas fa-stop"></i> <span>Stop Camera</span>`;
                toggleBtn.disabled = false;
                toggleBtn.classList.add('btn-cam-stop');
            }
            if (switchBtn) switchBtn.style.display = 'inline-flex';
        }).catch(err => {
            console.error("Camera start error:", err);
            isScannerActive = false;
            if (toggleBtn) {
                toggleBtn.innerHTML = `<i class="fas fa-play"></i> <span>Start Camera</span>`;
                toggleBtn.disabled = false;
                toggleBtn.classList.remove('btn-cam-stop');
            }
            if (reticle) reticle.style.display = 'none';

            let msg = "Could not access camera. Please check browser permissions or use file upload.";
            if (err && err.name === 'NotAllowedError') {
                msg = "Camera permission denied. Please allow camera access in browser settings.";
            } else if (err && err.name === 'NotFoundError') {
                msg = "No camera found on this device. Please use 'Upload Image / Screenshot' tab.";
            }
            if (typeof showToast === 'function') showToast(msg, "warning");
        });
    } catch (e) {
        console.error("Scanner exception:", e);
    }
}

function stopCameraScanner() {
    if (!isScannerActive || !html5QrScannerInstance) return;

    const reticle = document.getElementById('scannerReticle');
    const toggleBtn = document.getElementById('btnToggleCam');
    const switchBtn = document.getElementById('btnSwitchCam');

    html5QrScannerInstance.stop().then(() => {
        isScannerActive = false;
        if (reticle) reticle.style.display = 'none';
        if (toggleBtn) {
            toggleBtn.innerHTML = `<i class="fas fa-play"></i> <span>Start Camera</span>`;
            toggleBtn.disabled = false;
            toggleBtn.classList.remove('btn-cam-stop');
        }
        if (switchBtn) switchBtn.style.display = 'none';
    }).catch(err => {
        console.warn("Camera stop error:", err);
        isScannerActive = false;
    });
}

function switchCameraFacing() {
    currentCameraFacing = (currentCameraFacing === 'environment') ? 'user' : 'environment';
    stopCameraScanner();
    setTimeout(() => {
        startCameraScanner();
    }, 250);
}

// Handle QR scan from uploaded file / photo / screenshot
function handleQrFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof showToast === 'function') {
        showToast(`Analyzing QR from image: "${file.name}"...`, "info");
    }

    const dropText = document.getElementById('qrDropzoneText');
    if (dropText) {
        dropText.innerHTML = `<i class="fas fa-spinner fa-spin" style="font-size:1.8rem; color:var(--primary); margin-bottom:8px;"></i><br><strong>Decoding QR Code...</strong>`;
    }

    if (typeof Html5Qrcode !== 'undefined') {
        if (!html5QrScannerInstance) {
            html5QrScannerInstance = new Html5Qrcode("qrReader");
        }

        html5QrScannerInstance.scanFile(file, true)
            .then(decodedText => {
                resetDropzoneText();
                onScanSuccess(decodedText, { result: { text: decodedText } });
            })
            .catch(err => {
                resetDropzoneText();
                console.warn("Html5Qrcode file scan failed, trying BarcodeDetector fallback:", err);
                tryBarcodeDetectorFallback(file);
            });
    } else {
        tryBarcodeDetectorFallback(file);
    }
}

function resetDropzoneText() {
    const dropText = document.getElementById('qrDropzoneText');
    if (dropText) {
        dropText.innerHTML = `
            <strong>Select or Drag &amp; Drop QR Code Image</strong>
            <p>Supports PNG, JPG, WebP, or screenshots from mobile gallery</p>
        `;
    }
}

// Native browser BarcodeDetector API fallback
function tryBarcodeDetectorFallback(file) {
    if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13', 'ean_8'] });
        createImageBitmap(file).then(bitmap => {
            return detector.detect(bitmap);
        }).then(barcodes => {
            if (barcodes && barcodes.length > 0) {
                onScanSuccess(barcodes[0].rawValue, { result: { text: barcodes[0].rawValue } });
            } else {
                if (typeof showToast === 'function') {
                    showToast("No QR code detected in this image. Please upload a clear QR photo.", "warning");
                }
            }
        }).catch(e => {
            console.error("BarcodeDetector error:", e);
            if (typeof showToast === 'function') showToast("Could not decode QR code from this image.", "warning");
        });
    } else {
        if (typeof showToast === 'function') {
            showToast("No QR code found in image. Please try another photo or use live camera.", "warning");
        }
    }
}

// Sound synthesizer for scan confirmation
function playScanBeep() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);

        gain.setValueAtTime(0.2, ctx.currentTime);
        gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.14);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
        // AudioContext blocked before interaction
    }
}

function triggerHaptic() {
    if (navigator.vibrate) {
        navigator.vibrate([80, 40, 80]);
    }
}

// Callback triggered whenever a QR code is detected
function onScanSuccess(decodedText, decodedResult) {
    playScanBeep();
    triggerHaptic();

    // Pause camera so user can inspect result
    stopCameraScanner();

    displayScanResult(decodedText);
}

// Parse and present decoded data with smart actions
function displayScanResult(rawText) {
    const resultCard = document.getElementById('qrScanResult');
    const badgeEl = document.getElementById('resultTypeBadge');
    const contentEl = document.getElementById('resultDecodedText');
    const actionsEl = document.getElementById('resultActions');
    const timeEl = document.getElementById('resultTimestamp');

    if (!resultCard || !contentEl || !actionsEl) return;

    resultCard.style.display = 'block';
    if (timeEl) timeEl.innerText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const clean = (rawText || '').trim();

    // Check if it is a MedNexa store URL / deep-link
    let detectedStore = null;
    if (typeof allPharmacies !== 'undefined') {
        const storeParamMatch = clean.match(/[?&]store=([^&#]+)/);
        const cardHashMatch = clean.match(/#card-([^&#]+)/) || clean.match(/#store-([^&#]+)/);
        const storeId = storeParamMatch ? decodeURIComponent(storeParamMatch[1]) : (cardHashMatch ? decodeURIComponent(cardHashMatch[1]) : null);

        if (storeId) {
            detectedStore = allPharmacies.find(s => String(s.id) === String(storeId));
        }
    }

    if (detectedStore) {
        badgeEl.innerHTML = `<i class="fas fa-store-circle-check" style="color:#10b981;"></i> Verified Pharmacy Detected`;
        badgeEl.className = 'result-badge result-badge-store';

        contentEl.innerHTML = `
            <div class="result-store-info">
                <h4><i class="fas fa-store"></i> ${detectedStore.name}</h4>
                <p><i class="fas fa-location-dot"></i> ${detectedStore.address}</p>
                <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
                    <span class="type-badge badge-${detectedStore.type.toLowerCase()}">${detectedStore.type}</span>
                    ${detectedStore.is24Hours ? '<span class="badge-24h"><i class="fas fa-clock"></i> 24x7</span>' : ''}
                    ${detectedStore.genericSavingsPct > 0 ? `<span class="savings-chip">Save ${detectedStore.genericSavingsPct}%</span>` : ''}
                </div>
            </div>
        `;

        actionsEl.innerHTML = `
            <button type="button" class="btn-primary" onclick="closeQrModal(); highlightAndNavigateToStore('${detectedStore.id}', true);">
                <i class="fas fa-map-location-dot"></i> View on Map &amp; Navigate
            </button>
            <a href="tel:${detectedStore.phone || ''}" class="btn-secondary" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px;">
                <i class="fas fa-phone"></i> Call Store
            </a>
            <button type="button" class="btn-secondary" onclick="restartScanner()">
                <i class="fas fa-rotate-left"></i> Scan Another
            </button>
        `;
    } else if (clean.startsWith('http://') || clean.startsWith('https://')) {
        badgeEl.innerHTML = `<i class="fas fa-link" style="color:#0284c7;"></i> Web URL Detected`;
        badgeEl.className = 'result-badge result-badge-url';

        contentEl.innerHTML = `
            <div class="result-url-preview">
                <a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>
            </div>
        `;

        actionsEl.innerHTML = `
            <a href="${clean}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px;">
                <i class="fas fa-arrow-up-right-from-square"></i> Open Link
            </a>
            <button type="button" class="btn-secondary" onclick="copyDecodedText('${encodeURIComponent(clean)}')">
                <i class="fas fa-copy"></i> Copy Link
            </button>
            <button type="button" class="btn-secondary" onclick="restartScanner()">
                <i class="fas fa-rotate-left"></i> Scan Another
            </button>
        `;
    } else {
        badgeEl.innerHTML = `<i class="fas fa-file-lines" style="color:#7c3aed;"></i> Text / Medicine Code`;
        badgeEl.className = 'result-badge result-badge-text';

        contentEl.innerHTML = `
            <div class="result-text-preview">${escapeHtml(clean)}</div>
        `;

        actionsEl.innerHTML = `
            <button type="button" class="btn-primary" onclick="closeQrModal(); openModal('savingsModal'); searchGenericFromScanned('${encodeURIComponent(clean)}');">
                <i class="fas fa-tags"></i> Compare Generic Prices
            </button>
            <button type="button" class="btn-secondary" onclick="copyDecodedText('${encodeURIComponent(clean)}')">
                <i class="fas fa-copy"></i> Copy Text
            </button>
            <button type="button" class="btn-secondary" onclick="restartScanner()">
                <i class="fas fa-rotate-left"></i> Scan Another
            </button>
        `;
    }

    if (typeof showToast === 'function') {
        showToast("QR Code successfully decoded!", "success");
    }
}

function searchGenericFromScanned(encodedQuery) {
    const q = decodeURIComponent(encodedQuery);
    setTimeout(() => {
        const input = document.getElementById('medicineSearchInput');
        if (input) {
            input.value = q;
            if (typeof filterMedicines === 'function') filterMedicines();
        }
    }, 250);
}

function copyDecodedText(encoded) {
    const text = decodeURIComponent(encoded);
    fallbackCopy(text);
}

function restartScanner() {
    const resultCard = document.getElementById('qrScanResult');
    if (resultCard) resultCard.style.display = 'none';

    if (activeScannerInput === 'camera') {
        startCameraScanner();
    } else {
        const fileInput = document.getElementById('qrImageInput');
        if (fileInput) fileInput.value = '';
        resetDropzoneText();
    }
}

function escapeHtml(string) {
    const div = document.createElement('div');
    div.innerText = string;
    return div.innerHTML;
}
