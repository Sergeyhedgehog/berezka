// ============================================================
// КОНФИГУРАЦИЯ FIREBASE
// Замените значения ниже на свои из Firebase Console
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyAAECNNQJuYaOoi-Pc_QCXpOnlOsqUcAfk",
    authDomain: "berezka-4a2c5.firebaseapp.com",
    databaseURL: "https://berezka-4a2c5-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "berezka-4a2c5",
    storageBucket: "berezka-4a2c5.firebasestorage.app",
    messagingSenderId: "262260400083",
    appId: "1:262260400083:web:b7e14ba455f9290d0d5926"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ============================================================
// Элементы DOM
// ============================================================
const screenLoading = document.getElementById('screen-loading');
const screenMain = document.getElementById('screen-main');
const screenChat = document.getElementById('screen-chat');
const myIdSpan = document.getElementById('my-id');
const btnCopy = document.getElementById('btn-copy');
const peerIdInput = document.getElementById('peer-id-input');
const btnConnect = document.getElementById('btn-connect');
const connectStatus = document.getElementById('connect-status');
const pendingDiv = document.getElementById('pending-connections');
const btnBack = document.getElementById('btn-back');
const chatPeerName = document.getElementById('chat-peer-name');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const btnSend = document.getElementById('btn-send');

let myId = null;
let currentChatId = null;
let currentPeerId = null;

// ============================================================
// Утилиты
// ============================================================
async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hash);
    let hex = '';
    bytes.forEach(b => hex += b.toString(16).padStart(2, '0'));
    return hex;
}

function hexToBase36(hex) {
    // Берём первые 10 символов hex и конвертируем в base36
    const num = parseInt(hex.substring(0, 10), 16);
    return num.toString(36).toUpperCase().substring(0, 6);
}

function getChatId(id1, id2) {
    return [id1, id2].sort().join('-');
}

function formatTime(timestamp) {
    const d = new Date(timestamp);
    return d.getHours().toString().padStart(2, '0') + ':' +
           d.getMinutes().toString().padStart(2, '0');
}

function showScreen(screen) {
    screenLoading.classList.remove('active');
    screenMain.classList.remove('active');
    screenChat.classList.remove('active');
    screen.classList.add('active');
}

function setStatus(text, type) {
    connectStatus.textContent = text;
    connectStatus.className = 'status ' + (type || '');
}

// ============================================================
// Получение IP и генерация ID
// ============================================================
async function getIpAndGenerateId() {
    try {
        const res = await fetch('https://api.ipify.org?format=text');
        const ip = await res.text();
        const hash = await sha256('berezka-salt-' + ip);
        return hexToBase36(hash);
    } catch (e) {
        // Fallback: случайный ID
        const arr = new Uint8Array(5);
        crypto.getRandomValues(arr);
        let fallback = '';
        arr.forEach(b => fallback += b.toString(36));
        return fallback.substring(0, 6).toUpperCase();
    }
}

// ============================================================
// Инициализация
// ============================================================
async function init() {
    myId = await getIpAndGenerateId();
    myIdSpan.textContent = myId;

    // Регистрируем пользователя
    const userRef = db.ref('users/' + myId);
    await userRef.set({ online: true, lastSeen: firebase.database.ServerValue.TIMESTAMP });
    userRef.onDisconnect().update({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP });

    // Слушаем входящие подключения
    listenForIncomingConnections();

    showScreen(screenMain);
}

// ============================================================
// Подключение к собеседнику
// ============================================================
async function connectToPeer(peerId) {
    peerId = peerId.trim().toUpperCase();

    if (!peerId || peerId.length < 3) {
        setStatus('Введите корректный ID', 'error');
        return;
    }

    if (peerId === myId) {
        setStatus('Нельзя подключиться к себе', 'error');
        return;
    }

    // Записываем своё намерение подключиться
    await db.ref('connections/' + myId + '/' + peerId).set(true);
    setStatus('Запрос отправлен...', 'waiting');

    // Проверяем, есть ли обратное подключение
    const snapshot = await db.ref('connections/' + peerId + '/' + myId).once('value');

    if (snapshot.val()) {
        // Взаимное подключение — открываем чат
        setStatus('Подключено!', 'success');
        openChat(peerId);
    } else {
        setStatus('Ожидаем ответа от ' + peerId + '...', 'waiting');
        // Подписываемся на обратное подключение
        db.ref('connections/' + peerId + '/' + myId).on('value', (snap) => {
            if (snap.val()) {
                setStatus('Подключено!', 'success');
                openChat(peerId);
            }
        });
    }
}

// ============================================================
// Входящие подключения
// ============================================================
function listenForIncomingConnections() {
    db.ref('connections').orderByKey().on('value', (snapshot) => {
        const allConnections = snapshot.val() || {};
        pendingDiv.innerHTML = '';

        // Ищем тех, кто хочет подключиться к нам
        for (const [fromId, targets] of Object.entries(allConnections)) {
            if (targets[myId] && fromId !== myId) {
                // Проверяем, подключились ли мы к ним
                const weConnected = allConnections[myId] && allConnections[myId][fromId];
                if (!weConnected) {
                    // Показываем запрос
                    const item = document.createElement('div');
                    item.className = 'pending-item';
                    item.innerHTML = `
                        <div class="peer-info">
                            Запрос от <span class="peer-id">${fromId}</span>
                        </div>
                        <button class="btn-accept" data-id="${fromId}">Принять</button>
                    `;
                    pendingDiv.appendChild(item);
                }
            }
        }

        // Обработчики кнопок "Принять"
        pendingDiv.querySelectorAll('.btn-accept').forEach(btn => {
            btn.addEventListener('click', () => {
                const peerId = btn.dataset.id;
                peerIdInput.value = peerId;
                connectToPeer(peerId);
            });
        });
    });
}

// ============================================================
// Чат
// ============================================================
function openChat(peerId) {
    currentPeerId = peerId;
    currentChatId = getChatId(myId, peerId);
    chatPeerName.textContent = peerId;
    messagesDiv.innerHTML = '';

    showScreen(screenChat);

    // Подписываемся на сообщения
    const messagesRef = db.ref('chats/' + currentChatId + '/messages');
    messagesRef.off(); // Убираем старые подписки
    messagesRef.orderByChild('timestamp').on('child_added', (snapshot) => {
        const msg = snapshot.val();
        renderMessage(msg);
    });

    // Фокус на поле ввода
    messageInput.focus();
}

function renderMessage(msg) {
    const div = document.createElement('div');
    const isMine = msg.sender === myId;
    div.className = 'message ' + (isMine ? 'mine' : 'theirs');
    div.innerHTML = `
        <div class="text">${escapeHtml(msg.text)}</div>
        <div class="time">${formatTime(msg.timestamp)}</div>
    `;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentChatId) return;

    db.ref('chats/' + currentChatId + '/messages').push({
        sender: myId,
        text: text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    messageInput.value = '';
    messageInput.focus();
}

// ============================================================
// Обработчики событий
// ============================================================
btnConnect.addEventListener('click', () => {
    connectToPeer(peerIdInput.value);
});

peerIdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectToPeer(peerIdInput.value);
});

btnSend.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
});

btnBack.addEventListener('click', () => {
    // Отписываемся от сообщений
    if (currentChatId) {
        db.ref('chats/' + currentChatId + '/messages').off();
    }
    currentChatId = null;
    currentPeerId = null;
    showScreen(screenMain);
});

btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(myId).then(() => {
        btnCopy.textContent = '✅';
        setTimeout(() => btnCopy.textContent = '📋', 1500);
    });
});

// Автоматическое изменение высоты при открытии клавиатуры на мобильных
window.visualViewport && window.visualViewport.addEventListener('resize', () => {
    document.body.style.height = window.visualViewport.height + 'px';
});

// ============================================================
// Запуск
// ============================================================
init();
