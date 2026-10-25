# MedNexa Website — PCCOE Student Innovation | Healthcare Technology

**MedNexa** is an open-access medical store and Jan Aushadhi generic drug discovery website built for PCMC (Akurdi, Nigdi, Ravet, Chikhali Pradhikaran, and Pimpri).

> **Note**: This directory contains the standalone **Website** version of MedNexa. It runs directly in any browser (or can be hosted on GitHub Pages, Vercel, Netlify, or any static host) without any PWA service workers, app manifests, or installation prompts.

---

## 🌟 Key Website Features

1. **Interactive Street Map Locator**:
   - **4 Map Tile Styles**: OpenStreetMap Street View, Esri Detailed Road & Highway Network, Esri Satellite Imagery, and Topographic view.
   - Built on 100% free, open tile endpoints with zero commercial API keys required.
   - GPS Geolocation ("Find Nearest to Me") with automatic campus fallback.
   - Color-coded pins for Jan Aushadhi (Generic), Allopathy, Ayurvedic, and Homeopathy stores.

2. **Verified Store Directory**:
   - 40 verified local pharmacies with direct **Call**, **WhatsApp**, **Interactive Map focus**, and **Turn-by-turn Navigation** links.
   - Fast instant search by shop name, area, road/street, or medicine.
   - Quick category filter pills: Jan Aushadhi, 24x7 Emergency, Allopathy, Ayurvedic, Homeopathy.

3. **Generic Medicine Price Comparator**:
   - Compare branded medicines against certified Jan Aushadhi generic substitutes.
   - Real-time calculation of patient savings (up to 85% discount).

4. **AI Prescription Matcher (Demo)**:
   - Interactive prescription upload and salt-matching engine to discover generic alternatives in nearby stores.

5. **Multi-Language Support**:
   - Full support for English, Marathi (मराठी), and Hindi (हिंदी).

6. **Admin Verification Dashboard**:
   - FDA license inspector portal for adding and reviewing independent pharmacies.

---

## 📁 File Structure

```
medifinder-website/
├── index.html       # Clean website HTML structure & modals
├── styles.css       # Full responsive health-tech design system
├── app.js           # Interactive UI logic, street map layers & search
├── data.js          # 40 PCMC pharmacies, generic medicine database & translations
├── favicon.svg      # SVG site icon
└── README.md        # Website documentation
```

---

## 🚀 How to Run

### Method 1: Direct File Opening
Double-click `index.html` in your file explorer to open it directly in Google Chrome, Microsoft Edge, Firefox, or Safari.

### Method 2: Local HTTP Server
Using Node.js:
```bash
npx serve .
# or
python -m http.server 8000
```
Open [http://localhost:8000](http://localhost:8000) in your browser.

---

## 🏆 PCCOE Student Innovation | Healthcare Technology
Developed as an open-standards digital health public utility under the **Ayushman Bharat Digital Mission (ABDM)** initiative to empower independent pharmacies and increase generic medicine adoption.
