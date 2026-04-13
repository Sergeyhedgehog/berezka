// ============================================================
// КОНФИГУРАЦИЯ FIREBASE
// ============================================================
var db = null;

try {
    var firebaseConfig = {
        apiKey: "AIzaSyAAECNNQJuYaOoi-Pc_QCXpOnlOsqUcAfk",
        authDomain: "berezka-4a2c5.firebaseapp.com",
        databaseURL: "https://berezka-4a2c5-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "berezka-4a2c5",
        storageBucket: "berezka-4a2c5.firebasestorage.app",
        messagingSenderId: "262260400083",
        appId: "1:262260400083:web:b7e14ba455f9290d0d5926"
    };
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
} catch (e) {
    document.getElementById('loading-text').textContent = 'Ошибка подключения. Обновите страницу.';
    console.error('Firebase init error:', e);
}

var MESSAGE_LIMIT = 100;

// ============================================================
// Элементы DOM
// ============================================================
var screenLoading = document.getElementById('screen-loading');
var screenAuth = document.getElementById('screen-auth');
var screenMain = document.getElementById('screen-main');
var screenChat = document.getElementById('screen-chat');

var authTabs = document.querySelectorAll('.auth-tab');
var authUsername = document.getElementById('auth-username');
var authPassword = document.getElementById('auth-password');
var btnAuth = document.getElementById('btn-auth');
var authError = document.getElementById('auth-error');

var myIdSpan = document.getElementById('my-id');
var btnCopy = document.getElementById('btn-copy');
var btnLogout = document.getElementById('btn-logout');
var peerIdInput = document.getElementById('peer-id-input');
var btnConnect = document.getElementById('btn-connect');
var connectStatus = document.getElementById('connect-status');
var chatsList = document.getElementById('chats-list');

var btnBack = document.getElementById('btn-back');
var chatPeerName = document.getElementById('chat-peer-name');
var messagesDiv = document.getElementById('messages');
var messageInput = document.getElementById('message-input');
var btnSend = document.getElementById('btn-send');

var myUsername = null;
var currentChatId = null;
var currentPeerId = null;
var authMode = 'login';

// ============================================================
// Утилиты
// ============================================================
function sha256(text) {
    if (window.crypto && window.crypto.subtle) {
        var encoder = new TextEncoder();
        var data = encoder.encode(text);
        return crypto.subtle.digest('SHA-256', data).then(function(hash) {
            var bytes = new Uint8Array(hash);
            var hex = '';
            for (var i = 0; i < bytes.length; i++) {
                hex += bytes[i].toString(16).padStart(2, '0');
            }
            return hex;
        });
    }
    // Fallback: простой хеш для HTTP (без crypto.subtle)
    return Promise.resolve(simpleHash(text));
}

function simpleHash(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        var ch = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(12, '0');
}

function getChatId(id1, id2) {
    var a = id1.toLowerCase();
    var b = id2.toLowerCase();
    return a < b ? a + '_' + b : b + '_' + a;
}

function formatTime(timestamp) {
    var d = new Date(timestamp);
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function showScreen(screen) {
    screenLoading.classList.remove('active');
    screenAuth.classList.remove('active');
    screenMain.classList.remove('active');
    screenChat.classList.remove('active');
    screen.classList.add('active');
}

function setStatus(text, type) {
    connectStatus.textContent = text;
    connectStatus.className = 'status ' + (type || '');
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sanitizeUsername(name) {
    return name.trim().toLowerCase().replace(/[^a-z\u0430-\u044f\u04510-9_-]/gi, '');
}

function toFirebaseKey(str) {
    return str.replace(/[.#$\[\]\/]/g, '_');
}

// ============================================================
// Уведомления
// ============================================================
var notificationsEnabled = false;

function requestNotifications() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        notificationsEnabled = true;
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(function(perm) {
            notificationsEnabled = (perm === 'granted');
        });
    }
}

function showNotification(title, body) {
    if (!notificationsEnabled) return;
    if (document.visibilityState === 'visible' && currentChatId) return;
    try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SHOW_NOTIFICATION',
                title: title,
                body: body
            });
        } else {
            new Notification(title, { body: body, icon: 'icon-192.png' });
        }
    } catch (e) {
        // Уведомления недоступны
    }
}

// ============================================================
// Авторизация
// ============================================================
for (var i = 0; i < authTabs.length; i++) {
    (function(tab) {
        tab.addEventListener('click', function() {
            for (var j = 0; j < authTabs.length; j++) {
                authTabs[j].classList.remove('active');
            }
            tab.classList.add('active');
            authMode = tab.getAttribute('data-tab');
            btnAuth.textContent = authMode === 'login' ? 'Войти' : 'Зарегистрироваться';
            authError.textContent = '';
        });
    })(authTabs[i]);
}

function handleAuth() {
    if (!db) {
        authError.textContent = 'Нет подключения к серверу. Обновите страницу.';
        return;
    }

    var username = sanitizeUsername(authUsername.value);
    var password = authPassword.value.trim();

    if (!username || username.length < 2) {
        authError.textContent = 'Логин \u2014 минимум 2 символа';
        return;
    }
    if (!password || password.length < 4) {
        authError.textContent = 'Пароль \u2014 минимум 4 символа';
        return;
    }

    var key = toFirebaseKey(username);

    sha256('berezka-pass-' + password).then(function(passHash) {
        if (authMode === 'register') {
            db.ref('users/' + key).once('value').then(function(snap) {
                if (snap.exists()) {
                    authError.textContent = 'Этот логин уже занят';
                    return;
                }
                db.ref('users/' + key).set({
                    username: username,
                    passHash: passHash,
                    createdAt: firebase.database.ServerValue.TIMESTAMP
                }).then(function() {
                    localStorage.setItem('berezka_user', username);
                    myUsername = username;
                    startApp();
                }).catch(function(err) {
                    authError.textContent = 'Ошибка: ' + err.message;
                });
            }).catch(function(err) {
                authError.textContent = 'Ошибка связи: ' + err.message;
            });
        } else {
            db.ref('users/' + key).once('value').then(function(snap) {
                if (!snap.exists()) {
                    authError.textContent = 'Пользователь не найден';
                    return;
                }
                var data = snap.val();
                if (data.passHash !== passHash) {
                    authError.textContent = 'Неверный пароль';
                    return;
                }
                localStorage.setItem('berezka_user', username);
                myUsername = username;
                startApp();
            }).catch(function(err) {
                authError.textContent = 'Ошибка связи: ' + err.message;
            });
        }
    });
}

btnAuth.addEventListener('click', handleAuth);
authPassword.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleAuth();
});
authUsername.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') authPassword.focus();
});

// ============================================================
// Выход
// ============================================================
btnLogout.addEventListener('click', function() {
    localStorage.removeItem('berezka_user');
    myUsername = null;
    currentChatId = null;
    currentPeerId = null;
    if (db) db.ref().off();
    authUsername.value = '';
    authPassword.value = '';
    authError.textContent = '';
    showScreen(screenAuth);
});

// ============================================================
// Основное приложение
// ============================================================
var globalChatListeners = {}; // отслеживаем подписки на чаты

function startApp() {
    myIdSpan.textContent = myUsername;
    requestNotifications();
    showScreen(screenMain);
    loadChatsList();
    listenAllChats();
}

// Глобальный слушатель ВСЕХ чатов пользователя — уведомления приходят
// даже когда конкретный чат не открыт (приложение в фоне)
function listenAllChats() {
    var key = toFirebaseKey(myUsername);
    db.ref('user_chats/' + key).on('child_added', function(snap) {
        var peerKey = snap.key;
        var info = snap.val();
        var peerName = info.peerName || peerKey;
        subscribeToChat(peerName);
    });
}

function subscribeToChat(peerName) {
    var chatId = getChatId(myUsername, peerName);
    if (globalChatListeners[chatId]) return; // уже подписаны
    globalChatListeners[chatId] = true;

    // Слушаем только НОВЫЕ сообщения (limitToLast(1) + пропуск первого)
    var isFirstMessage = true;
    db.ref('chats/' + chatId + '/messages')
        .orderByChild('timestamp')
        .limitToLast(1)
        .on('child_added', function(snapshot) {
            if (isFirstMessage) {
                isFirstMessage = false;
                return; // пропускаем последнее существующее сообщение
            }
            var msg = snapshot.val();
            if (msg.sender !== myUsername) {
                // Уведомление если мы НЕ в этом чате сейчас
                if (currentChatId !== chatId || document.visibilityState !== 'visible') {
                    showNotification(msg.sender, msg.text);
                }
            }
        });
}

// ============================================================
// Список чатов
// ============================================================
function loadChatsList() {
    var key = toFirebaseKey(myUsername);
    db.ref('user_chats/' + key).on('value', function(snapshot) {
        var chats = snapshot.val() || {};
        var old = chatsList.querySelectorAll('.chat-item, .no-chats');
        for (var i = 0; i < old.length; i++) old[i].remove();

        var keys = Object.keys(chats);
        if (keys.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'no-chats';
            empty.textContent = 'Пока нет чатов. Введите логин собеседника выше.';
            chatsList.appendChild(empty);
            return;
        }

        var entries = keys.map(function(k) { return { key: k, info: chats[k] }; });
        entries.sort(function(a, b) { return (b.info.lastTime || 0) - (a.info.lastTime || 0); });

        entries.forEach(function(entry) {
            var item = document.createElement('div');
            item.className = 'chat-item';
            var name = entry.info.peerName || entry.key;
            item.innerHTML =
                '<div>' +
                '<div class="chat-item-name">' + escapeHtml(name) + '</div>' +
                '<div class="chat-item-preview">' + escapeHtml(entry.info.lastMessage || '') + '</div>' +
                '</div>' +
                '<span class="chat-item-arrow">\u203A</span>';
            item.addEventListener('click', function() { openChat(name); });
            chatsList.appendChild(item);
        });
    });
}

// ============================================================
// Начать чат
// ============================================================
function startChat(peerUsername) {
    if (!db) { setStatus('Нет подключения', 'error'); return; }

    peerUsername = sanitizeUsername(peerUsername);
    if (!peerUsername) { setStatus('Введите логин', 'error'); return; }
    if (peerUsername === myUsername) { setStatus('Нельзя написать себе', 'error'); return; }

    var peerKey = toFirebaseKey(peerUsername);
    db.ref('users/' + peerKey).once('value').then(function(snap) {
        if (!snap.exists()) {
            setStatus('Пользователь не найден', 'error');
            return;
        }
        setStatus('', '');
        openChat(peerUsername);
    }).catch(function(err) {
        setStatus('Ошибка: ' + err.message, 'error');
    });
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

    var myKey = toFirebaseKey(myUsername);
    var peerKey = toFirebaseKey(peerUsername);
    db.ref('user_chats/' + myKey + '/' + peerKey).update({ peerName: peerUsername });
    db.ref('user_chats/' + peerKey + '/' + myKey).update({ peerName: myUsername });

    showScreen(screenChat);

    var messagesRef = db.ref('chats/' + currentChatId + '/messages');
    messagesRef.off();
    messagesRef.orderByChild('timestamp').limitToLast(MESSAGE_LIMIT).on('child_added', function(snapshot) {
        var msg = snapshot.val();
        renderMessage(msg);
    });

    messageInput.focus();
}

function renderMessage(msg) {
    var div = document.createElement('div');
    var isMine = msg.sender === myUsername;
    div.className = 'message ' + (isMine ? 'mine' : 'theirs');
    div.innerHTML =
        '<div class="text">' + escapeHtml(msg.text) + '</div>' +
        '<div class="time">' + formatTime(msg.timestamp) + '</div>';
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function sendMessage() {
    var text = messageInput.value.trim();
    if (!text || !currentChatId || !db) return;

    var chatRef = db.ref('chats/' + currentChatId + '/messages');

    chatRef.push({
        sender: myUsername,
        text: text,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    var myKey = toFirebaseKey(myUsername);
    var peerKey = toFirebaseKey(currentPeerId);
    var preview = text.length > 40 ? text.substring(0, 40) + '...' : text;
    var updateData = { lastMessage: preview, lastTime: firebase.database.ServerValue.TIMESTAMP };
    db.ref('user_chats/' + myKey + '/' + peerKey).update(updateData);
    db.ref('user_chats/' + peerKey + '/' + myKey).update(updateData);

    // Чистим старые сообщения
    chatRef.once('value').then(function(countSnap) {
        var count = countSnap.numChildren();
        if (count > MESSAGE_LIMIT) {
            var toRemove = count - MESSAGE_LIMIT;
            chatRef.orderByChild('timestamp').limitToFirst(toRemove).once('value').then(function(oldSnap) {
                var updates = {};
                oldSnap.forEach(function(child) { updates[child.key] = null; });
                chatRef.update(updates);
            });
        }
    });

    messageInput.value = '';
    messageInput.focus();
}

// ============================================================
// Обработчики
// ============================================================
btnConnect.addEventListener('click', function() { startChat(peerIdInput.value); });
peerIdInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') startChat(peerIdInput.value);
});

btnSend.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendMessage();
});

btnBack.addEventListener('click', function() {
    if (currentChatId && db) {
        db.ref('chats/' + currentChatId + '/messages').off();
    }
    currentChatId = null;
    currentPeerId = null;
    peerIdInput.value = '';
    showScreen(screenMain);
});

btnCopy.addEventListener('click', function() {
    var text = myUsername || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            btnCopy.textContent = '\u2705';
            setTimeout(function() { btnCopy.textContent = '\uD83D\uDCCB'; }, 1500);
        }).catch(function() { fallbackCopy(text); });
    } else {
        fallbackCopy(text);
    }
});

function fallbackCopy(text) {
    var tmp = document.createElement('textarea');
    tmp.value = text;
    tmp.style.position = 'fixed';
    tmp.style.opacity = '0';
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
    btnCopy.textContent = '\u2705';
    setTimeout(function() { btnCopy.textContent = '\uD83D\uDCCB'; }, 1500);
}

// ============================================================
// Мобильная клавиатура
// ============================================================
(function() {
    if (!window.visualViewport) return;

    window.visualViewport.addEventListener('resize', function() {
        // Просто прокручиваем сообщения вниз при изменении viewport (клавиатура)
        if (currentChatId) {
            requestAnimationFrame(function() {
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            });
        }
    });
})();

// ============================================================
// Service Worker
// ============================================================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function() {});
}

// ============================================================
// Запуск
// ============================================================
(function init() {
    if (!db) return; // Firebase не загрузился — ошибка уже показана

    var saved = localStorage.getItem('berezka_user');
    if (saved) {
        var key = toFirebaseKey(saved);
        db.ref('users/' + key).once('value').then(function(snap) {
            if (snap.exists()) {
                myUsername = saved;
                startApp();
            } else {
                localStorage.removeItem('berezka_user');
                showScreen(screenAuth);
            }
        }).catch(function() {
            showScreen(screenAuth);
        });
    } else {
        showScreen(screenAuth);
    }
})();
