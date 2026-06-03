import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, off } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ⚡ 關鍵：從我們自己的 config.js 把設定檔抓進來使用！
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 定位常數
const A8_ADDRESS = "桃園市龜山區文德路27號";
const LIN_KOU_CAMPUS = { lat: 25.0443, lng: 121.3705 }; 

// 全域狀態控制
let busData = { small: null, medium: null };
let busETAs = { small: null, medium: null };
let isRaining = false; 
let weatherDescription = "偵測中...";

// 🔋 智慧休眠名額控制常數
const IDLE_TIMEOUT = 1200000; // 3分鐘不活動即判定休眠（180,000 毫秒）
let idleTimer = null;
let isSleeping = false;
let firebaseListeners = { small: null, medium: null };

// 機捷 A8 站時刻表資料庫
const MRT_TIMETABLE = {
    toTPE: [
        {type:"直達車", time:"10:41"}, {type:"普通車", time:"10:43"}, {type:"直達車", time:"10:56"}, {type:"普通車", time:"10:58"},
        {type:"直達車", time:"11:11"}, {type:"普通車", time:"11:13"}, {type:"直達車", time:"11:26"}, {type:"普通車", time:"11:28"},
        {type:"直達車", time:"11:41"}, {type:"普通車", time:"11:43"}, {type:"直達車", time:"11:56"}, {type:"普通車", time:"11:58"},
        {type:"直達車", time:"12:11"}, {type:"普通車", time:"12:13"}, {type:"直達車", time:"12:26"}, {type:"普通車", time:"12:28"},
        {type:"直達車", time:"12:41"}, {type:"普通車", time:"12:43"}, {type:"直達車", time:"12:56"}, {type:"普通車", time:"12:58"},
        {type:"直達車", time:"13:11"}, {type:"普通車", time:"13:13"}, {type:"直達車", time:"13:26"}, {type:"普通車", time:"13:28"},
        {type:"直達車", time:"13:41"}, {type:"普通車", time:"13:43"}, {type:"直達車", time:"13:56"}, {type:"普通車", time:"13:58"},
        {type:"直達車", time:"14:11"}, {type:"普通車", time:"14:13"}, {type:"直達車", time:"14:26"}, {type:"普通車", time:"14:28"},
        {type:"直達車", time:"14:41"}, {type:"普通車", time:"14:43"}, {type:"直達車", time:"14:56"}, {type:"普通車", time:"14:58"},
        {type:"直達車", time:"15:11"}, {type:"普通車", time:"15:13"}, {type:"直達車", time:"15:26"}, {type:"普通車", time:"15:28"},
        {type:"直達車", time:"15:41"}, {type:"普通車", time:"15:43"}, {type:"直達車", time:"15:56"}, {type:"普通車", time:"15:58"},
        {type:"直達車", time:"16:11"}, {type:"普通車", time:"16:13"}, {type:"直達車", time:"16:26"}, {type:"普通車", time:"16:28"},
        {type:"直達車", time:"16:41"}, {type:"普通車", time:"16:43"}, {type:"直達車", time:"16:56"}, {type:"普通車", time:"16:58"},
        {type:"直達車", time:"17:11"}, {type:"普通車", time:"17:13"}, {type:"直達車", time:"17:26"}, {type:"普通車", time:"17:28"},
        {type:"直達車", time:"17:41"}, {type:"普通車", time:"17:43"}, {type:"直達車", time:"17:56"}, {type:"普通車", time:"17:58"},
        {type:"普通車", time:"18:03"}, {type:"直達車", time:"18:11"}, {type:"普通車", time:"18:13"}, {type:"直達車", time:"18:26"},
        {type:"普通車", time:"18:28"}, {type:"直達車", time:"18:41"}, {type:"普通車", time:"18:43"}, {type:"直達車", time:"18:56"},
        {type:"普通車", time:"18:58"}, {type:"直達車", time:"19:11"}, {type:"普通車", time:"19:13"}, {type:"直達車", time:"19:26"},
        {type:"普通車", time:"19:28"}, {type:"直達車", time:"19:41"}, {type:"普通車", time:"19:43"}, {type:"直達車", time:"19:56"},
        {type:"普通車", time:"19:58"}, {type:"直達車", time:"20:11"}, {type:"普通車", time:"20:13"}, {type:"直達車", time:"20:26"},
        {type:"普通車", time:"20:28"}, {type:"直達車", time:"20:41"}, {type:"普通車", time:"20:43"}, {type:"直達車", time:"20:56"},
        {type:"普通車", time:"20:58"}, {type:"直達車", time:"21:11"}, {type:"普通車", time:"21:13"}, {type:"直達車", time:"21:26"},
        {type:"普通車", time:"21:28"}, {type:"直達車", time:"21:41"}
    ],
    toAP: [
        {type:"直達車", time:"10:37"}, {type:"普通車", time:"10:38"}, {type:"直達車", time:"10:52"}, {type:"普通車", time:"10:53"},
        {type:"直達車", time:"11:07"}, {type:"普通車", time:"11:08"}, {type:"直達車", time:"11:22"}, {type:"普通車", time:"11:23"},
        {type:"直達車", time:"11:37"}, {type:"普通車", time:"11:38"}, {type:"直達車", time:"11:52"}, {type:"普通車", time:"11:53"},
        {type:"直達車", time:"12:07"}, {type:"普通車", time:"12:08"}, {type:"直達車", time:"12:22"}, {type:"普通車", time:"12:23"},
        {type:"直達車", time:"12:37"}, {type:"普通車", time:"12:38"}, {type:"直達車", time:"12:52"}, {type:"普通車", time:"12:53"},
        {type:"直達車", time:"13:07"}, {type:"普通車", time:"13:08"}, {type:"直達車", time:"13:22"}, {type:"普通車", time:"13:23"},
        {type:"直達車", time:"13:37"}, {type:"普通車", time:"13:38"}, {type:"直達車", time:"13:52"}, {type:"普通車", time:"13:53"},
        {type:"直達車", time:"14:07"}, {type:"普通車", time:"14:08"}, {type:"直達車", time:"14:22"}, {type:"普通車", time:"14:23"},
        {type:"直達車", time:"14:37"}, {type:"普通車", time:"14:38"}, {type:"直達車", time:"14:52"}, {type:"普通車", time:"14:53"},
        {type:"直達車", time:"15:07"}, {type:"普通車", time:"15:08"}, {type:"直達車", time:"15:22"}, {type:"普通車", time:"15:23"},
        {type:"直達車", time:"15:37"}, {type:"普通車", time:"15:38"}, {type:"直達車", time:"15:52"}, {type:"普通車", time:"15:53"},
        {type:"直達車", time:"16:07"}, {type:"普通車", time:"16:08"}, {type:"直達車", time:"16:22"}, {type:"普通車", time:"16:23"},
        {type:"直達車", time:"16:37"}, {type:"普通車", time:"16:38"}, {type:"直達車", time:"16:52"}, {type:"普通車", time:"16:53"},
        {type:"直達車", time:"17:07"}, {type:"普通車", time:"17:08"}, {type:"直達車", time:"17:22"}, {type:"普通車", time:"17:23"},
        {type:"直達車", time:"17:37"}, {type:"普通車", time:"17:38"}, {type:"直達車", time:"17:52"}, {type:"普通車", time:"17:53"},
        {type:"直達車", time:"18:07"}, {type:"普通車", time:"18:08"}, {type:"直達車", time:"18:22"}, {type:"普通車", time:"18:23"},
        {type:"直達車", time:"18:37"}, {type:"普通車", time:"18:38"}, {type:"普通車", time:"18:45"}, {type:"直達車", time:"18:52"},
        {type:"普通車", time:"18:53"}, {type:"普通車", time:"19:00"}, {type:"直達車", time:"19:07"}, {type:"普通車", time:"19:08"},
        {type:"直達車", time:"19:22"}, {type:"普通車", time:"19:23"}, {type:"直達車", time:"19:37"}, {type:"普通車", time:"19:38"},
        {type:"直達車", time:"19:52"}, {type:"普通車", time:"19:53"}, {type:"直達車", time:"20:07"}, {type:"普通車", time:"20:08"},
        {type:"直達車", time:"20:22"}, {type:"普通車", time:"20:23"}, {type:"直達車", time:"20:37"}, {type:"普通車", time:"20:38"},
        {type:"直達車", time:"20:52"}, {type:"普通車", time:"20:53"}, {type:"直達車", time:"21:07"}, {type:"普通車", time:"21:08"},
        {type:"直達車", time:"21:22"}, {type:"普通車", time:"21:23"}, {type:"直達車", time:"21:37"}, {type:"普通車", time:"21:38"},
        {type:"直達車", time:"21:52"}, {type:"普通車", time:"21:53"}
    ]
};

////////////////////////////////////////////////////////////
// 串接文德路真實氣象 API 機制 (自動演算)
////////////////////////////////////////////////////////////
async function fetchRealWeather() {
    if (isSleeping) return; // 休眠時暫停氣象 API 請求
    try {
        const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=25.041&longitude=121.368&current_weather=true");
        const json = await res.json();
        
        if (json && json.current_weather) {
            const temp = json.current_weather.temperature;
            const code = json.current_weather.weathercode;
            
            const rainCodes = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99];
            if (rainCodes.includes(code)) {
                isRaining = true;
                weatherDescription = `🌧️ 雨天 ${temp}°C`;
            } else if (code >= 1 && code <= 3) {
                isRaining = false;
                weatherDescription = `☁️ 陰天/多雲 ${temp}°C`;
            } else {
                isRaining = false;
                weatherDescription = `☀️ 晴天 ${temp}°C`;
            }
        }
    } catch (err) {
        const currentHour = new Date().getHours();
        isRaining = (currentHour >= 14 && currentHour <= 16); 
        weatherDescription = isRaining ? "🌧️ 陣雨 24°C (自動安全機制備用)" : "☀️ 晴天/多雲 28°C";
    }
    
    updateUIAndCalculations();
}

function updateUIAndCalculations() {
    let trafficStr = "🚦 路況順暢";
    const hour = new Date().getHours();
    if (hour >= 17 && hour <= 19) {
        trafficStr = "🚦 下班尖峰車流稍多";
    }

    document.getElementById("weather-text").innerHTML = weatherDescription;
    document.getElementById("traffic-text").innerHTML = trafficStr;

    updateBestOption();
    updateShuttleHighlight();
    updateMRTBoard();
}

////////////////////////////////////////////////////////////
// 地理防錯 (防遠端惡意/異常定位點)
////////////////////////////////////////////////////////////
function isVehicleOutofBounds(lat, lng) {
    if (!google.maps.geometry) return false; 
    const busLoc = new google.maps.LatLng(lat, lng);
    const campusLoc = new google.maps.LatLng(LIN_KOU_CAMPUS.lat, LIN_KOU_CAMPUS.lng);
    const distance = google.maps.geometry.spherical.computeDistanceBetween(busLoc, campusLoc);
    return distance > 5000; 
}

////////////////////////////////////////////////////////////
// 車輛 UI
////////////////////////////////////////////////////////////
function updateBusUI(type, data, eta) {
    const now = Date.now();
    const isOnline = data && (now - data.timestamp) < 300000;
    const statusEl = document.getElementById(type + "-status");
    const directionEl = document.getElementById(type + "-direction");
    const etaEl = document.getElementById(type + "-eta");

    if (!isOnline) {
        statusEl.innerHTML = "⚪ 離線";
        statusEl.className = "offline";
        directionEl.innerHTML = "--";
        etaEl.innerHTML = "--";
        return;
    }

    if (isVehicleOutofBounds(data.lat, data.lng)) {
        statusEl.innerHTML = "⚠️ 路線偏離異常";
        statusEl.className = "route-error";
        directionEl.innerHTML = "未知 (異常定位點)";
        etaEl.innerHTML = `<span style="color:red;">不準確 (攔截設定)</span>`;
        return;
    }

    statusEl.innerHTML = "🟢 在線";
    statusEl.className = "online";

    let direction = "判斷中";
    let etaDisplay = eta ? eta + " 分鐘" : "計算中...";
    
    // 計算巴士與研華園區的物理距離
    let distanceToCampus = 999;
    if (google.maps.geometry) {
        const busLoc = new google.maps.LatLng(data.lat, data.lng);
        const campusLoc = new google.maps.LatLng(LIN_KOU_CAMPUS.lat, LIN_KOU_CAMPUS.lng);
        distanceToCampus = google.maps.geometry.spherical.computeDistanceBetween(busLoc, campusLoc);
    }

    if (data.direction === "toA8") {
        if (distanceToCampus < 100) {
            direction = "➡️ 往A8機捷站";
            etaDisplay = "即將離站"; 
        } else {
            direction = "➡️ 前往A8機捷站";
            etaDisplay = eta + " 分鐘";
        }
    }
    
    if (data.direction === "toAdvantech") {
        if (distanceToCampus < 100) {
            direction = "⬅️ 返回研華園區";
            etaDisplay = "即將到達"; 
        } else {
            direction = "⬅️ 返回研華園區";
            etaDisplay = "接駁車返回中";
        }
    }

    directionEl.innerHTML = direction;
    etaEl.innerHTML = etaDisplay;
}

////////////////////////////////////////////////////////////
// 智慧推薦演算
////////////////////////////////////////////////////////////
function renderDecision(busTime, walkTime) {
    const threshold = 2;
    const display = document.getElementById("decision-status");
    const reason = document.getElementById("reasoning");

    document.getElementById("bus-time").innerHTML = busTime !== null ? busTime + " min" : "--";
    document.getElementById("walk-time").innerHTML = walkTime + " min";

    if (isSleeping) {
        display.innerHTML = "💤 系統休眠中";
        display.className = "decision-box warning";
        reason.innerHTML = "已暫停 Firebase 即時數據監聽。請點擊上方按鈕「重新連線」以回復動態追蹤。";
        return;
    }

    if (busTime === null) {
        display.innerHTML = isRaining ? "建議等車 (下雨天)" : "建議步行";
        display.className = isRaining ? "decision-box wait-bus" : "decision-box go-walk";
        reason.innerHTML = isRaining ? "目前追蹤不到有效車輛 GPS，但外面正在下雨，建議遵循底色班表留在室內等車。" : "目前無在線接駁車，建議直接步行前往 A8。";
        return;
    }

    if (busTime > walkTime + threshold && !isRaining) {
        display.innerHTML = "建議步行";
        display.className = "decision-box go-walk";
        reason.innerHTML = `當前路況搭車需 ${busTime} 分鐘，而步行只需 ${walkTime} 分鐘，走路較快。`;
    } else {
        display.innerHTML = "建議等車";
        display.className = "decision-box wait-bus";
        reason.innerHTML = isRaining 
            ? `文德路正在下雨，雖等車+車程需 ${busTime} 分鐘，但搭車可避免雨天行走不便。`
            : `目前接駁車預估 ${busTime} 分鐘抵達，快於或接近步行時間，建議搭乘。`;
    }
}

function updateBestOption() {
    const now = Date.now();
    let validBuses = [];

    let finalSmall = busData.small;
    let finalMedium = busData.medium;
    if (finalSmall && finalMedium && finalSmall.sessionId === finalMedium.sessionId) {
        if (finalMedium.timestamp > finalSmall.timestamp) finalSmall = null;
        else finalMedium = null;
    }

    if (finalSmall && (now - finalSmall.timestamp) < 300000 && !isVehicleOutofBounds(finalSmall.lat, finalSmall.lng)) {
        if (busETAs.small !== null) validBuses.push(busETAs.small);
    }
    if (finalMedium && (now - finalMedium.timestamp) < 300000 && !isVehicleOutofBounds(finalMedium.lat, finalMedium.lng)) {
        if (busETAs.medium !== null) validBuses.push(busETAs.medium);
    }

    let walkTime = 20;
    const hour = new Date().getHours();
    if (hour >= 17) walkTime = 24; 
    
    if (isRaining) {
        walkTime = 25; 
    }

    if (isSleeping || validBuses.length === 0) {
        renderDecision(null, walkTime);
        return;
    }

    const bestETA = Math.min(...validBuses);
    renderDecision(bestETA, walkTime);
}

function calculateETA(bus, callback) {
    if (isSleeping || !bus || isVehicleOutofBounds(bus.lat, bus.lng)) {
        callback(null);
        return;
    }

    if (google.maps.geometry) {
        const busLoc = new google.maps.LatLng(bus.lat, bus.lng);
        const campusLoc = new google.maps.LatLng(LIN_KOU_CAMPUS.lat, LIN_KOU_CAMPUS.lng);
        const distToCampus = google.maps.geometry.spherical.computeDistanceBetween(busLoc, campusLoc);
        
        if (distToCampus < 100) {
            if (bus.direction === "toAdvantech") {
                callback(0); 
                return;
            } else if (bus.direction === "toA8") {
                const hour = new Date().getHours();
                const trafficBaseMin = (hour >= 17 && hour <= 19) ? 7 : 5; 
                callback(trafficBaseMin); 
                return;
            }
        }
    }

    const service = new google.maps.DistanceMatrixService();
    const nowTime = new Date();

    if (bus.direction === "toA8") {
        service.getDistanceMatrix({
            origins: [{ lat: bus.lat, lng: bus.lng }],
            destinations: [A8_ADDRESS],
            travelMode: "DRIVING",
            drivingOptions: { departureTime: nowTime, trafficModel: "bestguess" }
        }, (response, status) => {
            if (status !== "OK" || !response.rows[0].elements[0].duration) {
                callback(null);
                return;
            }
            const element = response.rows[0].elements[0];
            const sec = element.duration_in_traffic ? element.duration_in_traffic.value : element.duration.value;
            callback(Math.round(sec / 60));
        });
    } 
    else if (bus.direction === "toAdvantech") {
        service.getDistanceMatrix({
            origins: [
                { lat: bus.lat, lng: bus.lng }, 
                LIN_KOU_CAMPUS                 
            ],
            destinations: [
                LIN_KOU_CAMPUS,                
                A8_ADDRESS                     
            ],
            travelMode: "DRIVING",
            drivingOptions: { departureTime: nowTime, trafficModel: "bestguess" }
        }, (response, status) => {
            if (status !== "OK") {
                callback(null);
                return;
            }

            try {
                const element1 = response.rows[0].elements[0]; 
                const sec1 = element1.duration_in_traffic ? element1.duration_in_traffic.value : element1.duration.value;
                const minToCampus = Math.round(sec1 / 60);

                const element2 = response.rows[1].elements[1]; 
                const sec2 = element2.duration_in_traffic ? element2.duration_in_traffic.value : element2.duration.value;
                const minToA8 = Math.round(sec2 / 60);

                const totalEstimatedMinutes = minToCampus + 1 + minToA8;
                callback(totalEstimatedMinutes);
            } catch (err) {
                callback(null);
            }
        });
    } else {
        callback(null);
    }
}

function updateShuttleHighlight() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const allItems = document.querySelectorAll(".schedule-item");
    allItems.forEach(el => el.classList.remove("next-shuttle"));

    let futureTrains = [];
    allItems.forEach(item => {
        const timeStr = item.getAttribute("data-time");
        if (timeStr) {
            const [h, m] = timeStr.split(":").map(Number);
            const busMinutes = h * 60 + m;
            
            if (busMinutes >= currentMinutes) {
                futureTrains.push({
                    element: item,
                    minutes: busMinutes
                });
            }
        }
    });

    futureTrains.sort((a, b) => a.minutes - b.minutes);

    for (let i = 0; i < Math.min(2, futureTrains.length); i++) {
        futureTrains[i].element.classList.add("next-shuttle");
    }
}

function updateMRTBoard() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const timeCeiling = currentMinutes + 30; 

    const renderList = (allTrains, elementId) => {
        const container = document.getElementById(elementId);
        container.innerHTML = ""; 

        const filtered = allTrains.filter(train => {
            const [h, m] = train.time.split(":").map(Number);
            const tMins = h * 60 + m;
            return tMins >= currentMinutes && tMins <= timeCeiling;
        });

        if (filtered.length === 0) {
            container.innerHTML = `<div class="mrt-empty">30分鐘內暫無班次</div>`;
            return;
        }

        filtered.forEach(train => {
            const [h, m] = train.time.split(":").map(Number);
            const diff = (h * 60 + m) - currentMinutes;
            
            const itemDiv = document.createElement("div");
            itemDiv.className = "mrt-item";
            
            const type = train.type === "直達車" ? 'small' : 'medium';
            const badgeClass = type === 'small' ? 'badge-direct' : 'badge-normal';
            const badgeText = type === 'small' ? '直達車' : '普通車';
            const typeBadge = `<span class="badge ${badgeClass}">${badgeText}</span>`;
            
            let countdownText = `${diff}分鐘後`;
            if (diff === 0) {
                countdownText = "即將進站";
            }
                
            itemDiv.innerHTML = `
                <span class="mrt-col-type">${typeBadge}</span>
                <span class="mrt-col-time">${train.time}</span>
                <span class="mrt-col-countdown mrt-countdown">${countdownText}</span>
            `;
            container.appendChild(itemDiv);
        });
    };

    renderList(MRT_TIMETABLE.toTPE, "mrt-to-tpe-list");
    renderList(MRT_TIMETABLE.toAP, "mrt-to-ap-list");
}

////////////////////////////////////////////////////////////
// 🔋 核心優化：Firebase 智慧動態連線與休眠控制邏輯
////////////////////////////////////////////////////////////
function startFirebaseListeners() {
    if (isSleeping) return;

    // 監聽小巴動態
    firebaseListeners.small = onValue(ref(db, "shuttle/small"), (snap) => {
        const data = snap.val();
        busData.small = data;

        if (busData.small && busData.medium && 
            busData.small.sessionId === busData.medium.sessionId && 
            busData.medium.timestamp > busData.small.timestamp) {
            busData.small = null; 
        }

        calculateETA(busData.small, (eta) => {
            busETAs.small = eta;
            updateBusUI("small", busData.small, eta || "--");
            updateUIAndCalculations(); 
        });
    });

    // 監聽中巴動態
    firebaseListeners.medium = onValue(ref(db, "shuttle/medium"), (snap) => {
        const data = snap.val();
        busData.medium = data;

        if (busData.small && busData.medium && 
            busData.small.sessionId === busData.medium.sessionId && 
            busData.small.timestamp > busData.medium.timestamp) {
            busData.medium = null; 
        }

        calculateETA(busData.medium, (eta) => {
            busETAs.medium = eta;
            updateBusUI("medium", busData.medium, eta || "--");
            updateUIAndCalculations(); 
        });
    });
}

// 🔋 切斷連線，主動向 Firebase 釋放 Simultaneous Connection 名額
function stopFirebaseListeners() {
    if (firebaseListeners.small) {
        off(ref(db, "shuttle/small"));
        firebaseListeners.small = null;
    }
    if (firebaseListeners.medium) {
        off(ref(db, "shuttle/medium"));
        firebaseListeners.medium = null;
    }
}

// 🔋 進入休眠遮罩與狀態覆蓋
function enterSleepMode() {
    isSleeping = true;
    stopFirebaseListeners(); // 拔掉插頭，連線數歸零

    // 顯示提示橫幅
    document.getElementById("sleep-notice").style.display = "block";

    // 覆蓋即時卡片 UI 成休眠樣式
    document.getElementById("small-status").innerHTML = "💤 暫停同步";
    document.getElementById("small-status").className = "offline sleeping-mask";
    document.getElementById("medium-status").innerHTML = "💤 暫停同步";
    document.getElementById("medium-status").className = "offline sleeping-mask";
    
    document.getElementById("small-direction").innerHTML = "休眠中";
    document.getElementById("small-eta").innerHTML = "點擊重新連線";
    document.getElementById("medium-direction").innerHTML = "休眠中";
    document.getElementById("medium-eta").innerHTML = "點擊重新連線";

    updateUIAndCalculations();
}

// 🔋 喚醒機制
function resetIdleTimer() {
    if (isSleeping) return; // 已處於休眠狀態時，不透過背景滑動喚醒，必須強制點擊按鈕

    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        enterSleepMode();
    }, IDLE_TIMEOUT);
}

// 手動重新連線事件綁定
document.getElementById("btn-reconnect").addEventListener("click", () => {
    isSleeping = false;
    document.getElementById("sleep-notice").style.display = "none";
    document.getElementById("decision-status").innerHTML = "連線中...";
    
    // 重新建立 Firebase 實時動態監聽
    startFirebaseListeners();
    // 重新跑一次即時氣象與推薦演算
    fetchRealWeather();
    // 重設計時器
    resetIdleTimer();
});

// 監聽使用者是否有在網頁進行活動（滾動、點擊、觸控）
window.addEventListener("load", () => {
    startFirebaseListeners();
    fetchRealWeather();
    resetIdleTimer();
});

window.addEventListener("click", resetIdleTimer);
window.addEventListener("mousemove", resetIdleTimer);
window.addEventListener("scroll", resetIdleTimer);
window.addEventListener("touchstart", resetIdleTimer);

// 常態定時器
setInterval(fetchRealWeather, 300000); // 5分鐘自動查一次氣象 (若休眠會自動跳過)
setInterval(() => {
    if (!isSleeping) updateUIAndCalculations();
}, 15000)