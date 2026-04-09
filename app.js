// ============================================================
// КОНФИГУРАЦИЯ FIREBASE
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

const MESSAGE_LIMIT = 100;

// ============================================================
// Элементы DOM
// ============================================================
const screenLoading = document.getElementById('screen-loading');
const screenAuth = document.getElementById('screen-auth');
const screenMain = document.getElementById('screen-main');
const screenChat = document.getElementById('screen-chat');

const authTabs = document.querySelectorAll('.auth-tab');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const btnAuth = document.getElementById('btn-auth');
const authError = document.getElementById('auth-error');

const myIdSpan = document.getElementById('my-id');
const btnCopy = document.getElementById('btn-copy');
const btnLogout = document.getElementById('btn-logout');
const peerIdInput = document.getElementById('peer-id-input');
const btnConnect = document.getElementById('btn-connect');
const connectStatus = document.getElementById('connect-status');
const chatsList = document.getElementById('chats-list');

const btnBack = document.getElementById('btn-back');
const chatPeerName = document.getElementById('chat-peer-name');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const btnSend = document.getElementById('btn-send');

let myUsername = null;
let currentChatId = null;
let currentPeerId = null;
let authMode = 'login'; // 'login' или 'register'

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

function getChatId(id1, id2) {
    return [id1.toLowerCase(), id2.toLowerCase()].sort().join('_');
}

function formatTime(timestamp) {
    const d = new Date(timestamp);
    return d.getHours().toString().padStart(2, '0') + ':' +
           d.getMinutes().toString().padStart(2, '0');
}

function showScreen(screen) {
    [screenLoading, screenAuth, screenMain, screenChat].forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
}

function setStatus(text, type) {
    connectStatus.textContent = text;
    connectStatus.className = 'status ' + (type || '');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sanitizeUsername(name) {
    return name.trim().toLowerCase().replace(/[^a-zа-яё0-9_-]/gi, '');
}

// Ключ для Firebase (заменяем точки и спецсимволы)
function toFirebaseKey(str) {
    return str.replace(/[.#$\[\]\/]/g, '_');
}

// ============================================================
// Авторизация
// ============================================================
authTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        authTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        authMode = tab.dataset.tab;
        btnAuth.textContent = authMode === 'login' ? 'Войти' : 'Зарегистрироваться';
        authError.textContent = '';
    });
});

async function handleAuth() {
    const username = sanitizeUsername(authUsername.value);
    const password = authPassword.value.trim();

    if (!username || username.length < 2) {
        authError.textContent = 'Логин — минимум 2 символа (буквы, цифры, _ -)';
        return;
    }
    if (!password || password.length < 4) {
        authError.textContent = 'Пароль — минимум 4 символа';
        return;
    }

    const key = toFirebaseKey(username);
    const passHash = await sha256('berezka-pass-' + password);

    if (authMode === 'register') {
        // Проверяем, существует ли пользователь
        const snap = await db.ref('users/' + key).once('value');
        if (snap.exists()) {
            authError.textContent = 'Этот логин уже занят';
            return;
        }
        // Регистрируем
        await db.ref('users/' + key).set({
            username: username,
            passHash: passHash,
            createdAt: firebase.database.ServerValue.TIMESTAMP
        });
        localStorage.setItem('berezka_user', username);
        myUsername = username;
        startApp();
    } else {
        // Вход
        const snap = await db.ref('users/' + key).once('value');
        if (!snap.exists()) {
            authError.textContent = 'Пользователь не найден';
            return;
        }
        const data = snap.val();
        if (data.passHash !== passHash) {
            authError.textContent = 'Неверный пароль';
            return;
        }
        localStorage.setItem('berezka_user', username);
        myUsername = username;
        startApp();
    }
}

btnAuth.addEventListener('click', handleAuth);
authPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAuth();
});
authUsername.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') authPassword.focus();
});

// ============================================================
// Выход
// ============================================================
btnLogout.addEventListener('click', () => {
    localStorage.removeItem('berezka_user');
    myUsername = null;
    currentChatId = null;
    currentPeerId = null;
    // Отписываемся от всех слушателей
    db.ref().off();
    authUsername.value = '';
    authPassword.value = '';
    authError.textContent = '';
    showScreen(screenAuth);
});

// ============================================================
// Основное приложение
// ============================================================
function startApp() {
    myIdSpan.textContent = myUsername;
    showScreen(screenMain);
    loadChatsList();
}

// ============================================================
// Список чатов
// ============================================================
function loadChatsList() {
    const key = toFirebaseKey(myUsername);
    db.ref('user_chats/' + key).on('value', (snapshot) => {
        const chats = snapshot.val() || {};
        // Убираем старые элементы чатов (но не label)
        chatsList.querySelectorAll('.chat-item, .no-chats').forEach(el => el.remove());

        const entries = Object.entries(chats);
        if (entries.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'no-chats';
            empty.textContent = 'Пока нет чатов. Введите логин собеседника выше.';
            chatsList.appendChild(empty);
            return;
        }

        // Сортируем по времени последнего сообщения
        entries.sort((a, b) => (b[1].lastTime || 0) - (a[1].lastTime || 0));

        entries.forEach(([peerKey, info]) => {
            const item = document.createElement('div');
            item.className = 'chat-item';
            item.innerHTML = `
                <div>
                    <div class="chat-item-name">${escapeHtml(info.peerName || peerKey)}</div>
                    <div class="chat-item-preview">${escapeHtml(info.lastMessage || '')}</div>
                </div>
                <span class="chat-item-arrow">›</span>
            `;
            item.addEventListener('click', () => openChat(info.peerName || peerKey));
            chatsList.appendChild(item);
        });
    });
}

// ============================================================
// Начать чат
// ============================================================
async function startChat(peerUsername) {
    peerUsername = sanitizeUsername(peerUsername);

    if (!peerUsername) {
        setStatus('Введите логин', 'error');
        return;
    }

    if (peerUsername === myUsername) {
        setStatus('Нельзя написать себе', 'error');
        return;
    }

    // Проверяем, существует ли пользователь
    const peerKey = toFirebaseKey(peerUsername);
    const snap = await db.ref('users/' + peerKey).once('value');
    if (!snap.exists()) {
        setStatus('Пользователь не найден', 'error');
        return;
    }

    setStatus('', '');
    openChat(peerUsername);
}

// ============================================================
// Чат
// ============================================================
function openChat(peerUsername) {
    peerUsername = sanitizeUsername(peerUsername);
    currentPeerId = peerUsername;
    currentChatId = getChatId(myUsername, peerUsername);
    chatPeerName.textContent = peerUsername;
    messagesDiv.innerHTML = '';

    // Записываем чат в список обоих пользователей
    const myKey = toFirebaseKey(myUsername);
    const peerKey = toFirebaseKey(peerUsername);
    db.ref('user_chats/' + myKey + '/' + peerKey).update({ peerName: peerUsername });
    db.ref('user_chats/' + peerKey + '/' + myKey).update({ peerName: myUsername });

    showScreen(screenChat);

    // Подписываемся на сообщения (последние MESSAGE_LIMIT)
    const messagesRef = db.ref('chats/' + currentChatId + '/messages');
    messagesRef.off();
    messagesRef.orderByChild('timestamp').limitToLast(MESSAGE_LIMIT).on('child_added', (snapshot) => {
        renderMessage(snapshot.val());
    });

    messageInput.focus();
}

function renderMessage(msg) {
    const div = document.createElement('div');
    const isMine = msg.sender === myUsername;
    div.className = 'message ' + (isMine ? 'mine' : 'theirs');
    div.innerHTML = `
        <div class="text">${escapeHtml(msg.text)}</div>
        <div class="time">${formatTime(msg.timestamp)}</div>
    `;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentChatId) return;

    const chatRef = db.ref('chats/' + currentChatId + '/messages');

    // Отправляем сообщение
    await chatRef.push({
        sender: myUsername,
        text: text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    // Обновляем превью в списке чатов
    const myKey = toFirebaseKey(myUsername);
    const peerKey = toFirebaseKey(currentPeerId);
    const preview = text.length > 40 ? text.substring(0, 40) + '...' : text;
    const updateData = { lastMessage: preview, lastTime: firebase.database.ServerValue.TIMESTAMP };
    db.ref('user_chats/' + myKey + '/' + peerKey).update(updateData);
    db.ref('user_chats/' + peerKey + '/' + myKey).update(updateData);

    // Удаляем старые сообщения если превышен лимит
    const countSnap = await chatRef.once('value');
    const count = countSnap.numChildren();
    if (count > MESSAGE_LIMIT) {
        const toRemove = count - MESSAGE_LIMIT;
        const oldSnap = await chatRef.orderByChild('timestamp').limitToFirst(toRemove).once('value');
        const updates = {};
        oldSnap.forEach(child => { updates[child.key] = null; });
        chatRef.update(updates);
    }

    messageInput.value = '';
    messageInput.focus();
}

// ============================================================
// Обработчики
// ============================================================
btnConnect.addEventListener('click', () => startChat(peerIdInput.value));
peerIdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startChat(peerIdInput.value);
});

btnSend.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
});

btnBack.addEventListener('click', () => {
    if (currentChatId) {
        db.ref('chats/' + currentChatId + '/messages').off();
    }
    currentChatId = null;
    currentPeerId = null;
    peerIdInput.value = '';
    showScreen(screenMain);
});

btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(myUsername).then(() => {
        btnCopy.textContent = '✅';
        setTimeout(() => btnCopy.textContent = '📋', 1500);
    }).catch(() => {
        // Fallback для старых браузеров
        const tmp = document.createElement('textarea');
        tmp.value = myUsername;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        document.body.removeChild(tmp);
        btnCopy.textContent = '✅';
        setTimeout(() => btnCopy.textContent = '📋', 1500);
    });
});

// Обработка виртуальной клавиатуры на мобильных
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        document.body.style.height = window.visualViewport.height + 'px';
        if (currentChatId) {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    });
    window.visualViewport.addEventListener('scroll', () => {
        document.body.style.height = window.visualViewport.height + 'px';
    });
}

// ============================================================
// Запуск
// ============================================================
(function init() {
    // Проверяем сохранённую сессию
    const saved = localStorage.getItem('berezka_user');
    if (saved) {
        // Проверяем, что пользователь всё ещё существует
        const key = toFirebaseKey(saved);
        db.ref('users/' + key).once('value').then(snap => {
            if (snap.exists()) {
                myUsername = saved;
                startApp();
            } else {
                localStorage.removeItem('berezka_user');
                showScreen(screenAuth);
            }
        }).catch(() => showScreen(screenAuth));
    } else {
        showScreen(screenAuth);
    }
})();
