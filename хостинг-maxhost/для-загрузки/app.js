// ============================================================
// FIREBASE
// ============================================================
var db = null;
try {
    firebase.initializeApp({
        apiKey: "AIzaSyAAECNNQJuYaOoi-Pc_QCXpOnlOsqUcAfk",
        authDomain: "berezka-4a2c5.firebaseapp.com",
        databaseURL: "https://berezka-4a2c5-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "berezka-4a2c5",
        storageBucket: "berezka-4a2c5.firebasestorage.app",
        messagingSenderId: "262260400083",
        appId: "1:262260400083:web:b7e14ba455f9290d0d5926"
    });
    db = firebase.database();
} catch (e) {
    document.getElementById('loading-text').textContent = '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F.';
}

// ============================================================
// EMAILJS
// ============================================================
var EMAILJS_PUBLIC_KEY = 'RIcm9uJNJbFjefEWS';
var EMAILJS_SERVICE_ID = 'service_d62ejmd';
var EMAILJS_VERIFY_TEMPLATE = 'template_nri6h8v';

try { if (window.emailjs) emailjs.init(EMAILJS_PUBLIC_KEY); } catch (e) {}

// ============================================================
// Web Push (VAPID)
// Заполнить после python3 generate_vapid.py
// ============================================================
var VAPID_PUBLIC_KEY = '';  // <-- вставьте публичный ключ сюда

function _urlB64ToUint8Array(b64) {
    var padding = '='.repeat((4 - b64.length % 4) % 4);
    var base64  = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw     = atob(base64);
    var arr     = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
}

function subscribeWebPush() {
    if (!VAPID_PUBLIC_KEY) return;                              // ключ не задан
    if (!('serviceWorker' in navigator)) return;
    if (!('PushManager' in window)) return;                    // браузер не поддерживает
    if (!myUsername || !db) return;

    navigator.serviceWorker.ready.then(function(reg) {
        reg.pushManager.getSubscription().then(function(existing) {
            if (existing) {
                // Подписка уже есть — просто обновляем её в Firebase
                _savePushSub(existing);
                return;
            }
            // Запрашиваем новую подписку
            reg.pushManager.subscribe({
                userVisibleOnly:      true,
                applicationServerKey: _urlB64ToUint8Array(VAPID_PUBLIC_KEY)
            }).then(function(sub) {
                _savePushSub(sub);
                console.log('[push] Web Push подписка создана');
            }).catch(function(err) {
                // На iOS: только для PWA, добавленной на главный экран
                console.log('[push] Подписка недоступна:', err.message);
            });
        });
    });
}

function _savePushSub(sub) {
    if (!myUsername || !db) return;
    db.ref('users/' + fbKey(myUsername) + '/pushSubscription')
      .set(JSON.parse(JSON.stringify(sub)));
}

// ============================================================
// Константы
// ============================================================
var MESSAGE_LIMIT = 100;
var PIN_LIMIT = 5;
var EDIT_TIME_LIMIT = 48 * 60 * 60 * 1000;
var DRAFT_DEBOUNCE = 1500;

// ============================================================
// Состояние
// ============================================================
var allScreens = [];
var myUsername = null;
var currentChatId = null;
var currentChatType = null;
var currentPeerId = null;
var authMode = 'login';
var globalChatListeners = {};
var newGroupMembers = [];
var currentFolder = '__all__';
var allChatsData = {};
var draftTimer = null;
var currentQuery = null;
var replyTo = null; // { key, sender, text }

// ============================================================
// DOM
// ============================================================
function $(id) { return document.getElementById(id); }

var screenLoading, screenAuth, screenMain, screenChat, screenCreateGroup, screenGroupInfo, screenProfile;
var authUsername, authPassword, btnAuth, authError;
var myIdSpan, btnCopy, peerIdInput, btnConnect, connectStatus, chatsList;
var chatPeerName, chatSubtitle, messagesDiv, messageInput;
var modalOverlay, modalTitle, modalBody;
var msgContextOverlay, msgContextBody;
var searchBar, searchInput, searchSenderFilter, searchResults;
var pinnedBar, pinnedMessages;
var folderTabs;

function initDOM() {
    screenLoading = $('screen-loading');
    screenAuth = $('screen-auth');
    screenMain = $('screen-main');
    screenChat = $('screen-chat');
    screenCreateGroup = $('screen-create-group');
    screenGroupInfo = $('screen-group-info');
    screenProfile = $('screen-profile');
    allScreens = [screenLoading, screenAuth, screenMain, screenChat, screenCreateGroup, screenGroupInfo, screenProfile];

    authUsername = $('auth-username');
    authPassword = $('auth-password');
    btnAuth = $('btn-auth');
    authError = $('auth-error');

    myIdSpan = $('my-id');
    btnCopy = $('btn-copy');
    peerIdInput = $('peer-id-input');
    btnConnect = $('btn-connect');
    connectStatus = $('connect-status');
    chatsList = $('chats-list');

    chatPeerName = $('chat-peer-name');
    chatSubtitle = $('chat-subtitle');
    messagesDiv = $('messages');
    messageInput = $('message-input');

    modalOverlay = $('modal-overlay');
    modalTitle = $('modal-title');
    modalBody = $('modal-body');

    msgContextOverlay = $('msg-context-overlay');
    msgContextBody = $('msg-context-body');

    searchBar = $('search-bar');
    searchInput = $('search-input');
    searchSenderFilter = $('search-sender-filter');
    searchResults = $('search-results');

    pinnedBar = $('pinned-bar');
    pinnedMessages = $('pinned-messages');

    folderTabs = $('folder-tabs');
}

// ============================================================
// Утилиты
// ============================================================
function sha256(text) {
    if (window.crypto && window.crypto.subtle) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function(h) {
            var b = new Uint8Array(h), hex = '';
            for (var i = 0; i < b.length; i++) hex += b[i].toString(16).padStart(2, '0');
            return hex;
        });
    }
    var hash = 0;
    for (var i = 0; i < text.length; i++) { hash = ((hash << 5) - hash) + text.charCodeAt(i); hash &= hash; }
    return Promise.resolve(Math.abs(hash).toString(16).padStart(12, '0'));
}

function getDmChatId(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    return a < b ? a + '_' + b : b + '_' + a;
}

function formatTime(ts) {
    var d = new Date(ts);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
}

function formatDate(ts) {
    var d = new Date(ts);
    var dd = d.getDate(), mm = d.getMonth() + 1;
    return (dd < 10 ? '0' : '') + dd + '.' + (mm < 10 ? '0' : '') + mm + '.' + d.getFullYear();
}

function showScreen(s) {
    allScreens.forEach(function(sc) { sc.classList.remove('active'); });
    s.classList.add('active');
}

function escapeHtml(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function sanitize(n) { return n.trim().toLowerCase().replace(/[^a-z\u0430-\u044f\u04510-9_-]/gi, ''); }
function fbKey(s) { return s.replace(/[.#$\[\]\/]/g, '_'); }

function setStatus(el, text, type) {
    el.textContent = text;
    el.className = 'status ' + (type || '');
}

function generateGroupId() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var id = 'g_';
    for (var i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

// ============================================================
// Уведомления
// ============================================================
var notifEnabled = false;
function requestNotifications() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') { notifEnabled = true; return; }
    if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(function(p) { notifEnabled = p === 'granted'; });
    }
}

function showNotification(title, body) {
    if (!notifEnabled) return;
    if (document.visibilityState === 'visible' && currentChatId) return;
    try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'SHOW_NOTIFICATION', title: title, body: body });
        } else {
            new Notification(title, { body: body, icon: 'icon-192.png' });
        }
    } catch (e) {}
}

// ============================================================
// Модальное окно
// ============================================================
function showModal(title, buttons) {
    modalTitle.textContent = title;
    modalBody.innerHTML = '';
    buttons.forEach(function(b) {
        var btn = document.createElement('button');
        btn.textContent = b.text;
        btn.className = b.cls || 'btn-modal-cancel';
        btn.addEventListener('click', function() {
            hideModal();
            if (b.action) b.action();
        });
        modalBody.appendChild(btn);
    });
    modalOverlay.style.display = 'flex';
}

function showModalWithInput(title, placeholder, value, onSave) {
    modalTitle.textContent = title;
    modalBody.innerHTML = '';
    var ta = document.createElement('textarea');
    ta.placeholder = placeholder;
    ta.value = value || '';
    modalBody.appendChild(ta);
    var btnSave = document.createElement('button');
    btnSave.textContent = '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C';
    btnSave.className = 'btn-primary btn-full';
    btnSave.addEventListener('click', function() { hideModal(); onSave(ta.value.trim()); });
    modalBody.appendChild(btnSave);
    var btnCancel = document.createElement('button');
    btnCancel.textContent = '\u041E\u0442\u043C\u0435\u043D\u0430';
    btnCancel.className = 'btn-modal-cancel';
    btnCancel.addEventListener('click', hideModal);
    modalBody.appendChild(btnCancel);
    modalOverlay.style.display = 'flex';
    ta.focus();
}

function hideModal() { modalOverlay.style.display = 'none'; }

// ============================================================
// Контекстное меню сообщения
// ============================================================
function showMsgContext(buttons) {
    msgContextBody.innerHTML = '';
    buttons.forEach(function(b) {
        var btn = document.createElement('button');
        btn.textContent = b.text;
        btn.className = b.cls || '';
        btn.addEventListener('click', function() { hideMsgContext(); if (b.action) b.action(); });
        msgContextBody.appendChild(btn);
    });
    msgContextOverlay.style.display = 'flex';
}

function hideMsgContext() { msgContextOverlay.style.display = 'none'; }

// ============================================================
// Авторизация
// ============================================================
function setupAuth() {
    var tabs = document.querySelectorAll('.auth-tab');
    for (var i = 0; i < tabs.length; i++) {
        (function(tab) {
            tab.addEventListener('click', function() {
                for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
                tab.classList.add('active');
                authMode = tab.getAttribute('data-tab');
                btnAuth.textContent = authMode === 'login' ? '\u0412\u043E\u0439\u0442\u0438' : '\u0417\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C\u0441\u044F';
                authError.textContent = '';
            });
        })(tabs[i]);
    }
    btnAuth.addEventListener('click', handleAuth);
    authPassword.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleAuth(); });
    authUsername.addEventListener('keydown', function(e) { if (e.key === 'Enter') authPassword.focus(); });
}

function handleAuth() {
    if (!db) { authError.textContent = '\u041D\u0435\u0442 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F'; return; }
    var input = authUsername.value.trim();
    var password = authPassword.value.trim();
    var isEmail = input.indexOf('@') > 0;

    if (authMode === 'register') {
        var username = sanitize(input);
        if (!username || username.length < 2) { authError.textContent = '\u041B\u043E\u0433\u0438\u043D \u2014 \u043C\u0438\u043D\u0438\u043C\u0443\u043C 2 \u0441\u0438\u043C\u0432\u043E\u043B\u0430'; return; }
        if (!password || password.length < 4) { authError.textContent = '\u041F\u0430\u0440\u043E\u043B\u044C \u2014 \u043C\u0438\u043D\u0438\u043C\u0443\u043C 4 \u0441\u0438\u043C\u0432\u043E\u043B\u0430'; return; }
        var key = fbKey(username);
        sha256('berezka-pass-' + password).then(function(passHash) {
            db.ref('users/' + key).once('value').then(function(s) {
                if (s.exists()) { authError.textContent = '\u041B\u043E\u0433\u0438\u043D \u0437\u0430\u043D\u044F\u0442'; return; }
                db.ref('users/' + key).set({ username: username, passHash: passHash, createdAt: firebase.database.ServerValue.TIMESTAMP })
                .then(function() { localStorage.setItem('berezka_user', username); myUsername = username; startApp(); })
                .catch(function(e) { authError.textContent = e.message; });
            });
        });
    } else {
        if (!input) { authError.textContent = '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043B\u043E\u0433\u0438\u043D \u0438\u043B\u0438 email'; return; }
        if (!password || password.length < 4) { authError.textContent = '\u041F\u0430\u0440\u043E\u043B\u044C \u2014 \u043C\u0438\u043D\u0438\u043C\u0443\u043C 4 \u0441\u0438\u043C\u0432\u043E\u043B\u0430'; return; }

        if (isEmail) {
            // Вход по email — ищем пользователя с таким email
            findUserByEmail(input).then(function(userData) {
                if (!userData) { authError.textContent = '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0441 \u0442\u0430\u043A\u0438\u043C email \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D'; return; }
                sha256('berezka-pass-' + password).then(function(passHash) {
                    if (userData.passHash !== passHash) { authError.textContent = '\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C'; return; }
                    localStorage.setItem('berezka_user', userData.username); myUsername = userData.username; startApp();
                });
            });
        } else {
            var username = sanitize(input);
            var key = fbKey(username);
            sha256('berezka-pass-' + password).then(function(passHash) {
                db.ref('users/' + key).once('value').then(function(s) {
                    if (!s.exists()) { authError.textContent = '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D'; return; }
                    if (s.val().passHash !== passHash) { authError.textContent = '\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C'; return; }
                    localStorage.setItem('berezka_user', username); myUsername = username; startApp();
                }).catch(function(e) { authError.textContent = e.message; });
            });
        }
    }
}

function findUserByEmail(email) {
    return db.ref('users').orderByChild('email').equalTo(email.toLowerCase().trim()).once('value').then(function(s) {
        var result = null;
        s.forEach(function(child) {
            var data = child.val();
            if (data.emailVerified) result = data;
        });
        return result;
    });
}

function forgotPassword() {
    var input = authUsername.value.trim();
    if (!input) { authError.textContent = '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043B\u043E\u0433\u0438\u043D \u0438\u043B\u0438 email \u0432 \u043F\u043E\u043B\u0435 \u0432\u044B\u0448\u0435'; return; }

    var isEmail = input.indexOf('@') > 0;

    var findUser;
    if (isEmail) {
        findUser = findUserByEmail(input);
    } else {
        var username = sanitize(input);
        findUser = db.ref('users/' + fbKey(username)).once('value').then(function(s) {
            return s.exists() ? s.val() : null;
        });
    }

    findUser.then(function(userData) {
        if (!userData) { authError.textContent = '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D'; return; }
        if (!userData.email || !userData.emailVerified) {
            authError.textContent = '\u041A \u044D\u0442\u043E\u043C\u0443 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0443 \u043D\u0435 \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u043D\u0430 \u043F\u043E\u0447\u0442\u0430'; return;
        }

        // Генерируем новый пароль
        var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        var newPass = '';
        for (var i = 0; i < 8; i++) newPass += chars[Math.floor(Math.random() * chars.length)];

        sha256('berezka-pass-' + newPass).then(function(newHash) {
            db.ref('users/' + fbKey(userData.username) + '/passHash').set(newHash).then(function() {
                if (window.emailjs) {
                    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_VERIFY_TEMPLATE, {
                        to_email: userData.email,
                        to_name: userData.displayName || userData.username,
                        code: '\u041D\u043E\u0432\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C: ' + newPass
                    }).then(function() {
                        authError.textContent = '';
                        setStatus(authError, '\u041D\u043E\u0432\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D \u043D\u0430 ' + userData.email, 'success');
                    }).catch(function(err) {
                        authError.textContent = '\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438: ' + (err.text || err);
                    });
                }
            });
        });
    });
}

// ============================================================
// Профиль
// ============================================================
function openProfile() {
    $('profile-username').textContent = myUsername;
    $('profile-old-pass').value = '';
    $('profile-new-pass').value = '';
    $('profile-email-code').value = '';
    setStatus($('profile-name-status'), '', '');
    setStatus($('profile-pass-status'), '', '');
    setStatus($('profile-email-status'), '', '');
    $('email-verify-section').style.display = 'none';

    var key = fbKey(myUsername);
    db.ref('users/' + key).once('value').then(function(s) {
        var data = s.val() || {};
        $('profile-display-name').value = data.displayName || '';
        if (data.email && data.emailVerified) {
            $('email-linked-section').style.display = 'block';
            $('email-unlinked-section').style.display = 'none';
            $('profile-email-display').textContent = data.email;
        } else {
            $('email-linked-section').style.display = 'none';
            $('email-unlinked-section').style.display = 'block';
            $('profile-email').value = data.email || '';
        }
    });
    showScreen(screenProfile);
}

function saveDisplayName() {
    var name = $('profile-display-name').value.trim();
    if (!name) { setStatus($('profile-name-status'), '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0438\u043C\u044F', 'error'); return; }
    db.ref('users/' + fbKey(myUsername) + '/displayName').set(name).then(function() {
        setStatus($('profile-name-status'), '\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E!', 'success');
    });
}

function changePassword() {
    var oldPass = $('profile-old-pass').value.trim();
    var newPass = $('profile-new-pass').value.trim();
    var statusEl = $('profile-pass-status');
    if (!oldPass || !newPass) { setStatus(statusEl, '\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435 \u043E\u0431\u0430 \u043F\u043E\u043B\u044F', 'error'); return; }
    if (newPass.length < 4) { setStatus(statusEl, '\u041D\u043E\u0432\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C \u2014 \u043C\u0438\u043D. 4 \u0441\u0438\u043C\u0432\u043E\u043B\u0430', 'error'); return; }

    var key = fbKey(myUsername);
    sha256('berezka-pass-' + oldPass).then(function(oldHash) {
        return db.ref('users/' + key + '/passHash').once('value').then(function(s) {
            if (s.val() !== oldHash) { setStatus(statusEl, '\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C', 'error'); return; }
            return sha256('berezka-pass-' + newPass).then(function(newHash) {
                return db.ref('users/' + key + '/passHash').set(newHash).then(function() {
                    setStatus(statusEl, '\u041F\u0430\u0440\u043E\u043B\u044C \u0438\u0437\u043C\u0435\u043D\u0451\u043D!', 'success');
                    $('profile-old-pass').value = '';
                    $('profile-new-pass').value = '';
                });
            });
        });
    });
}

function linkEmail() {
    var email = $('profile-email').value.trim();
    var statusEl = $('profile-email-status');
    if (!email || email.indexOf('@') < 1) { setStatus(statusEl, '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 email', 'error'); return; }

    var code = String(Math.floor(100000 + Math.random() * 900000));
    var key = fbKey(myUsername);

    db.ref('users/' + key).update({ email: email, emailCode: code, emailVerified: false }).then(function() {
        $('email-verify-section').style.display = 'block';
        $('email-verified-badge').style.display = 'none';
        setStatus(statusEl, '\u041E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u043C \u043A\u043E\u0434...', 'waiting');

        if (window.emailjs) {
            emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_VERIFY_TEMPLATE, {
                to_email: email, to_name: myUsername, code: code
            }).then(function() {
                setStatus(statusEl, '\u041A\u043E\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D \u043D\u0430 ' + email, 'success');
            }).catch(function(err) {
                setStatus(statusEl, '\u041E\u0448\u0438\u0431\u043A\u0430: ' + (err.text || err), 'error');
            });
        } else {
            setStatus(statusEl, '\u041A\u043E\u0434: ' + code, 'waiting');
        }
    });
}

function verifyEmail() {
    var code = $('profile-email-code').value.trim();
    var statusEl = $('profile-email-status');
    if (!code) { setStatus(statusEl, '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043A\u043E\u0434', 'error'); return; }

    var key = fbKey(myUsername);
    db.ref('users/' + key).once('value').then(function(s) {
        var data = s.val() || {};
        if (data.emailCode !== code) { setStatus(statusEl, '\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043A\u043E\u0434', 'error'); return; }
        db.ref('users/' + key).update({ emailVerified: true, emailCode: null }).then(function() {
            setStatus(statusEl, '\u041F\u043E\u0447\u0442\u0430 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0430!', 'success');
            $('email-verify-section').style.display = 'none';
            $('email-linked-section').style.display = 'block';
            $('email-unlinked-section').style.display = 'none';
            $('profile-email-display').textContent = data.email;
        });
    });
}

function unlinkEmail() {
    var key = fbKey(myUsername);
    db.ref('users/' + key).update({ email: null, emailVerified: false, emailCode: null }).then(function() {
        $('email-linked-section').style.display = 'none';
        $('email-unlinked-section').style.display = 'block';
        $('profile-email').value = '';
        $('email-verify-section').style.display = 'none';
        setStatus($('profile-email-status'), '\u041F\u043E\u0447\u0442\u0430 \u043E\u0442\u0432\u044F\u0437\u0430\u043D\u0430', 'success');
    });
}

// ============================================================
// Статусы сообщений (доставлено/прочитано)
// ============================================================
function markMessageDelivered(chatId, msgKey) {
    if (!myUsername || !db) return;
    db.ref('chats/' + chatId + '/messages/' + msgKey + '/deliveredTo/' + fbKey(myUsername)).set(firebase.database.ServerValue.TIMESTAMP);
}

function markMessagesRead(chatId) {
    if (!myUsername || !db || !chatId) return;
    var myKey = fbKey(myUsername);
    db.ref('chats/' + chatId + '/messages').orderByChild('timestamp').limitToLast(MESSAGE_LIMIT).once('value').then(function(s) {
        var updates = {};
        s.forEach(function(child) {
            var msg = child.val();
            if (msg.sender && msg.sender !== myUsername && msg.sender !== '__system__') {
                if (!msg.readBy || !msg.readBy[myKey]) {
                    updates[child.key + '/readBy/' + myKey] = firebase.database.ServerValue.TIMESTAMP;
                }
            }
        });
        if (Object.keys(updates).length > 0) {
            db.ref('chats/' + chatId + '/messages').update(updates);
        }
    });
}

function getStatusIcon(msg) {
    if (msg.sender !== myUsername) return '';
    if (msg.readBy && Object.keys(msg.readBy).length > 0) return '\u2713\u2713'; // ✓✓
    if (msg.deliveredTo && Object.keys(msg.deliveredTo).length > 0) return '\u2713'; // ✓
    return '\u2022'; // •
}

// ============================================================
// Папки
// ============================================================
function loadFolders() {
    db.ref('users/' + fbKey(myUsername) + '/folders').on('value', function(s) {
        renderFolderTabs(s.val() || {});
    });
}

function renderFolderTabs(folders) {
    folderTabs.innerHTML = '';
    var allTab = document.createElement('div');
    allTab.className = 'folder-tab' + (currentFolder === '__all__' ? ' active' : '');
    allTab.textContent = '\u0412\u0441\u0435';
    allTab.addEventListener('click', function() { currentFolder = '__all__'; renderFolderTabs(folders); filterChatsList(); });
    folderTabs.appendChild(allTab);

    Object.keys(folders).forEach(function(fId) {
        var f = folders[fId];
        var tab = document.createElement('div');
        tab.className = 'folder-tab' + (currentFolder === fId ? ' active' : '');
        tab.textContent = f.name || fId;
        tab.addEventListener('click', function() { currentFolder = fId; renderFolderTabs(folders); filterChatsList(); });
        var pressTimer;
        tab.addEventListener('touchstart', function(e) {
            pressTimer = setTimeout(function() {
                e.preventDefault();
                showModal('"' + (f.name || fId) + '"', [
                    { text: '\u041F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u0442\u044C', cls: 'btn-secondary', action: function() { renameFolder(fId); } },
                    { text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C', cls: 'btn-danger', action: function() { deleteFolder(fId); } },
                    { text: '\u041E\u0442\u043C\u0435\u043D\u0430' }
                ]);
            }, 600);
        });
        tab.addEventListener('touchend', function() { clearTimeout(pressTimer); });
        tab.addEventListener('touchmove', function() { clearTimeout(pressTimer); });
        folderTabs.appendChild(tab);
    });

    var addBtn = document.createElement('div');
    addBtn.className = 'folder-tab folder-tab-add';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', createFolder);
    folderTabs.appendChild(addBtn);
}

function createFolder() {
    showModalWithInput('\u041D\u043E\u0432\u0430\u044F \u043F\u0430\u043F\u043A\u0430', '\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435', '', function(name) {
        if (!name) return;
        db.ref('users/' + fbKey(myUsername) + '/folders/f_' + Date.now()).set({ name: name, chats: {} });
    });
}

function renameFolder(fId) {
    showModalWithInput('\u041F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u0442\u044C', '\u041D\u043E\u0432\u043E\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435', '', function(name) {
        if (!name) return;
        db.ref('users/' + fbKey(myUsername) + '/folders/' + fId + '/name').set(name);
    });
}

function deleteFolder(fId) {
    db.ref('users/' + fbKey(myUsername) + '/folders/' + fId).remove();
    if (currentFolder === fId) currentFolder = '__all__';
}

function assignChatToFolder(chatKey) {
    db.ref('users/' + fbKey(myUsername) + '/folders').once('value').then(function(s) {
        var folders = s.val() || {};
        var keys = Object.keys(folders);
        if (keys.length === 0) {
            showModal('\u041D\u0435\u0442 \u043F\u0430\u043F\u043E\u043A', [
                { text: '\u0421\u043E\u0437\u0434\u0430\u0442\u044C', cls: 'btn-primary', action: createFolder },
                { text: '\u041E\u0442\u043C\u0435\u043D\u0430' }
            ]);
            return;
        }
        var buttons = keys.map(function(fId) {
            return { text: folders[fId].name, cls: 'btn-secondary', action: function() {
                db.ref('users/' + fbKey(myUsername) + '/folders/' + fId + '/chats/' + chatKey).set(true);
            }};
        });
        buttons.push({ text: '\u0423\u0431\u0440\u0430\u0442\u044C \u0438\u0437 \u0432\u0441\u0435\u0445', cls: 'btn-danger-outline', action: function() {
            keys.forEach(function(fId) { db.ref('users/' + fbKey(myUsername) + '/folders/' + fId + '/chats/' + chatKey).remove(); });
        }});
        buttons.push({ text: '\u041E\u0442\u043C\u0435\u043D\u0430' });
        showModal('\u0412 \u043A\u0430\u043A\u0443\u044E \u043F\u0430\u043F\u043A\u0443?', buttons);
    });
}

function filterChatsList() {
    if (currentFolder === '__all__') {
        var items = chatsList.querySelectorAll('.chat-item');
        for (var i = 0; i < items.length; i++) items[i].style.display = '';
        return;
    }
    db.ref('users/' + fbKey(myUsername) + '/folders/' + currentFolder + '/chats').once('value').then(function(s) {
        var fc = s.val() || {};
        var items = chatsList.querySelectorAll('.chat-item');
        for (var i = 0; i < items.length; i++) {
            items[i].style.display = fc[items[i].getAttribute('data-chat-key')] ? '' : 'none';
        }
    });
}

// ============================================================
// Главный экран
// ============================================================
function startApp() {
    myIdSpan.textContent = myUsername;
    requestNotifications();
    subscribeWebPush();
    showScreen(screenMain);
    loadChatsList();
    listenAllChats();
    loadFolders();
}

function loadChatsList() {
    db.ref('user_chats/' + fbKey(myUsername)).on('value', function(snapshot) {
        allChatsData = snapshot.val() || {};
        var old = chatsList.querySelectorAll('.chat-item, .no-chats');
        for (var i = 0; i < old.length; i++) old[i].remove();

        var keys = Object.keys(allChatsData);
        if (keys.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'no-chats';
            empty.textContent = '\u041F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0447\u0430\u0442\u043E\u0432.';
            chatsList.appendChild(empty);
            return;
        }

        var entries = keys.map(function(k) { return { key: k, info: allChatsData[k] }; });
        entries.sort(function(a, b) { return (b.info.lastTime || 0) - (a.info.lastTime || 0); });

        entries.forEach(function(entry) {
            var info = entry.info;
            var isGroup = info.type === 'group';
            var name = isGroup ? (info.groupName || '\u0413\u0440\u0443\u043F\u043F\u0430') : (info.peerName || entry.key);
            var icon = isGroup ? (name[0] || '\u0413').toUpperCase() : (name[0] || '?').toUpperCase();

            var item = document.createElement('div');
            item.className = 'chat-item';
            item.setAttribute('data-chat-key', entry.key);
            item.innerHTML =
                '<div class="chat-item-icon">' + escapeHtml(icon) + '</div>' +
                '<div class="chat-item-body">' +
                '<div class="chat-item-name">' + escapeHtml(name) + (isGroup ? ' \uD83D\uDC65' : '') + '</div>' +
                '<div class="chat-item-preview">' + escapeHtml(info.lastMessage || '') + '</div>' +
                '</div>' +
                '<span class="chat-item-badge" style="display:none"></span>' +
                '<span class="chat-item-arrow">\u203A</span>';

            // Подсчёт непрочитанных
            (function(el, cid) {
                db.ref('chats/' + cid + '/messages').orderByChild('timestamp').limitToLast(MESSAGE_LIMIT).once('value').then(function(snap) {
                    var count = 0;
                    var myKey = fbKey(myUsername);
                    snap.forEach(function(child) {
                        var m = child.val();
                        if (m.sender && m.sender !== myUsername && m.sender !== '__system__' && !m.deleted) {
                            if (!m.readBy || !m.readBy[myKey]) count++;
                        }
                    });
                    var badge = el.querySelector('.chat-item-badge');
                    if (badge) {
                        if (count > 0) {
                            badge.textContent = count > 99 ? '99+' : count;
                            badge.style.display = 'flex';
                        } else {
                            badge.style.display = 'none';
                        }
                    }
                });
            })(item, info.chatId);

            item.addEventListener('click', function() {
                if (isGroup) openGroupChat(info.chatId, info.groupName);
                else openDmChat(info.peerName || entry.key);
            });

            var pressTimer;
            item.addEventListener('touchstart', function(e) {
                pressTimer = setTimeout(function() { e.preventDefault(); showDeleteMenu(entry.key, info); }, 600);
            });
            item.addEventListener('touchend', function() { clearTimeout(pressTimer); });
            item.addEventListener('touchmove', function() { clearTimeout(pressTimer); });
            chatsList.appendChild(item);
        });
        filterChatsList();
    });
}

function updateBadges() {
    var items = chatsList.querySelectorAll('.chat-item');
    for (var i = 0; i < items.length; i++) {
        (function(el) {
            var key = el.getAttribute('data-chat-key');
            var info = allChatsData[key];
            if (!info || !info.chatId) return;
            db.ref('chats/' + info.chatId + '/messages').orderByChild('timestamp').limitToLast(MESSAGE_LIMIT).once('value').then(function(snap) {
                var count = 0;
                var myKey = fbKey(myUsername);
                snap.forEach(function(child) {
                    var m = child.val();
                    if (m.sender && m.sender !== myUsername && m.sender !== '__system__' && !m.deleted) {
                        if (!m.readBy || !m.readBy[myKey]) count++;
                    }
                });
                var badge = el.querySelector('.chat-item-badge');
                if (badge) {
                    if (count > 0) {
                        badge.textContent = count > 99 ? '99+' : count;
                        badge.style.display = 'flex';
                    } else {
                        badge.style.display = 'none';
                    }
                }
            });
        })(items[i]);
    }
}

// ============================================================
// Удаление чатов
// ============================================================
function showDeleteMenu(chatKey, info) {
    var isGroup = info.type === 'group';
    var buttons = [];
    buttons.push({ text: '\uD83D\uDCC1 \u0412 \u043F\u0430\u043F\u043A\u0443...', cls: 'btn-secondary', action: function() { assignChatToFolder(chatKey); } });
    buttons.push({ text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443 \u0441\u0435\u0431\u044F', cls: 'btn-danger-outline', action: function() { deleteChatForMe(chatKey); } });

    if (isGroup) {
        db.ref('groups/' + info.chatId + '/creator').once('value').then(function(s) {
            if (s.val() === myUsername) {
                buttons.push({ text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0434\u043B\u044F \u0432\u0441\u0435\u0445', cls: 'btn-danger', action: function() { deleteGroupForAll(info.chatId); } });
            } else {
                buttons.push({ text: '\u041F\u043E\u043A\u0438\u043D\u0443\u0442\u044C', cls: 'btn-danger-outline', action: function() { leaveGroup(info.chatId); } });
            }
            buttons.push({ text: '\u041E\u0442\u043C\u0435\u043D\u0430' });
            showModal('\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F', buttons);
        });
        return;
    }
    buttons.push({ text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443 \u043E\u0431\u043E\u0438\u0445', cls: 'btn-danger', action: function() { deleteDmForBoth(chatKey, info.peerName || chatKey); } });
    buttons.push({ text: '\u041E\u0442\u043C\u0435\u043D\u0430' });
    showModal('\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F', buttons);
}

function deleteChatForMe(chatKey) { db.ref('user_chats/' + fbKey(myUsername) + '/' + chatKey).remove(); }

function deleteDmForBoth(chatKey, peerName) {
    var chatId = getDmChatId(myUsername, peerName);
    db.ref('user_chats/' + fbKey(myUsername) + '/' + chatKey).remove();
    db.ref('user_chats/' + fbKey(peerName) + '/' + fbKey(myUsername)).remove();
    db.ref('chats/' + chatId).remove();
}

function deleteGroupForAll(groupId) {
    db.ref('groups/' + groupId + '/members').once('value').then(function(s) {
        Object.keys(s.val() || {}).forEach(function(m) { db.ref('user_chats/' + fbKey(m) + '/' + groupId).remove(); });
        db.ref('groups/' + groupId).remove();
        db.ref('chats/' + groupId).remove();
    });
    showScreen(screenMain);
}

function leaveGroup(groupId) {
    db.ref('groups/' + groupId + '/members/' + myUsername).remove();
    db.ref('user_chats/' + fbKey(myUsername) + '/' + groupId).remove();
    db.ref('chats/' + groupId + '/messages').push({ sender: '__system__', text: myUsername + ' \u043F\u043E\u043A\u0438\u043D\u0443\u043B(\u0430) \u0433\u0440\u0443\u043F\u043F\u0443', timestamp: firebase.database.ServerValue.TIMESTAMP });
    showScreen(screenMain);
}

// ============================================================
// Глобальный слушатель уведомлений + доставка
// ============================================================
function listenAllChats() {
    db.ref('user_chats/' + fbKey(myUsername)).on('child_added', function(snap) {
        var info = snap.val();
        var chatId = info.chatId || getDmChatId(myUsername, info.peerName || snap.key);
        subscribeToChatNotif(chatId);
    });
}

function subscribeToChatNotif(chatId) {
    if (globalChatListeners[chatId]) return;
    globalChatListeners[chatId] = true;
    var first = true;
    db.ref('chats/' + chatId + '/messages').orderByChild('timestamp').limitToLast(1)
        .on('child_added', function(s) {
            if (first) { first = false; return; }
            var msg = s.val();
            if (msg.sender !== myUsername && msg.sender !== '__system__') {
                // Помечаем доставленным
                markMessageDelivered(chatId, s.key);

                if (currentChatId !== chatId || document.visibilityState !== 'visible') {
                    showNotification(msg.sender, msg.text);
                } else {
                    // Если в чате и видим — сразу читаем
                    markMessagesRead(chatId);
                }
            }
        });
}

// ============================================================
// ЛС
// ============================================================
function startDmChat(peer) {
    if (!db) { setStatus(connectStatus, '\u041D\u0435\u0442 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F', 'error'); return; }
    peer = sanitize(peer);
    if (!peer) { setStatus(connectStatus, '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043B\u043E\u0433\u0438\u043D', 'error'); return; }
    if (peer === myUsername) { setStatus(connectStatus, '\u041D\u0435\u043B\u044C\u0437\u044F \u043D\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0441\u0435\u0431\u0435', 'error'); return; }
    db.ref('users/' + fbKey(peer)).once('value').then(function(s) {
        if (!s.exists()) { setStatus(connectStatus, '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D', 'error'); return; }
        setStatus(connectStatus, '', '');
        openDmChat(peer);
    });
}

function openDmChat(peer) {
    peer = sanitize(peer);
    currentPeerId = peer;
    currentChatId = getDmChatId(myUsername, peer);
    currentChatType = 'dm';
    chatPeerName.textContent = peer;
    chatSubtitle.textContent = '';
    messagesDiv.innerHTML = '';
    closeSearch();
    cancelReply();
    loadPinnedMessages(currentChatId);

    db.ref('user_chats/' + fbKey(myUsername) + '/' + fbKey(peer)).update({ peerName: peer, type: 'dm', chatId: currentChatId });
    db.ref('user_chats/' + fbKey(peer) + '/' + fbKey(myUsername)).update({ peerName: myUsername, type: 'dm', chatId: currentChatId });

    showScreen(screenChat);
    loadMessages(currentChatId);
    loadDraft(currentChatId);
    markMessagesRead(currentChatId);
    messageInput.focus();
}

// ============================================================
// Групповой чат
// ============================================================
function openGroupChat(groupId, groupName) {
    currentChatId = groupId;
    currentChatType = 'group';
    currentPeerId = null;
    chatPeerName.textContent = groupName || '\u0413\u0440\u0443\u043F\u043F\u0430';
    messagesDiv.innerHTML = '';
    closeSearch();
    cancelReply();
    loadPinnedMessages(groupId);

    db.ref('groups/' + groupId + '/members').once('value').then(function(s) {
        chatSubtitle.textContent = Object.keys(s.val() || {}).length + ' \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A(\u043E\u0432)';
    });

    showScreen(screenChat);
    loadMessages(groupId);
    loadDraft(groupId);
    markMessagesRead(groupId);
    messageInput.focus();
}

// ============================================================
// Сообщения
// ============================================================
function loadMessages(chatId) {
    if (currentQuery) currentQuery.off();
    var query = db.ref('chats/' + chatId + '/messages').orderByChild('timestamp').limitToLast(MESSAGE_LIMIT);
    currentQuery = query;

    query.on('child_added', function(s) {
        if (currentChatId !== chatId) return;
        renderMessage(s.key, s.val());
        // Доставлено + прочитано если в чате
        if (s.val().sender && s.val().sender !== myUsername && s.val().sender !== '__system__') {
            markMessageDelivered(chatId, s.key);
            if (document.visibilityState === 'visible') {
                db.ref('chats/' + chatId + '/messages/' + s.key + '/readBy/' + fbKey(myUsername)).set(firebase.database.ServerValue.TIMESTAMP);
            }
        }
    });

    query.on('child_changed', function(s) {
        if (currentChatId !== chatId) return;
        updateMessage(s.key, s.val());
    });

    query.on('child_removed', function(s) {
        if (currentChatId !== chatId) return;
        removeMessageEl(s.key);
    });
}

function renderMessage(key, msg) {
    var div = document.createElement('div');
    div.setAttribute('data-msg-key', key);

    if (msg.deleted) {
        div.className = 'message system deleted';
        div.textContent = '\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0443\u0434\u0430\u043B\u0435\u043D\u043E';
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        return;
    }

    if (msg.sender === '__system__') {
        div.className = 'message system';
        div.textContent = msg.text;
    } else {
        var isMine = msg.sender === myUsername;
        div.className = 'message ' + (isMine ? 'mine' : 'theirs');
        var senderHtml = '';
        if (currentChatType === 'group' && !isMine) {
            senderHtml = '<div class="msg-sender">' + escapeHtml(msg.sender) + '</div>';
        }
        var replyHtml = '';
        if (msg.replyTo) {
            replyHtml = '<div class="msg-reply-quote" data-reply-key="' + escapeHtml(msg.replyTo.key) + '">' +
                '<div class="msg-reply-quote-sender">' + escapeHtml(msg.replyTo.sender) + '</div>' +
                '<div class="msg-reply-quote-text">' + escapeHtml(msg.replyTo.text) + '</div>' +
                '</div>';
        }
        var editedHtml = msg.edited ? ' <span class="edited-mark">(\u0438\u0437\u043C.)</span>' : '';
        var statusHtml = isMine ? '<span class="msg-status">' + getStatusIcon(msg) + '</span>' : '';
        div.innerHTML = senderHtml + replyHtml +
            '<div class="text">' + escapeHtml(msg.text) + editedHtml + '</div>' +
            '<div class="time">' + formatTime(msg.timestamp) + ' ' + statusHtml + '</div>';

        // Клик по цитате — прокрутка к исходному
        var quoteEl = div.querySelector('.msg-reply-quote');
        if (quoteEl) {
            quoteEl.addEventListener('click', function(e) {
                e.stopPropagation();
                var targetKey = quoteEl.getAttribute('data-reply-key');
                var el = messagesDiv.querySelector('[data-msg-key="' + targetKey + '"]');
                if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight'); setTimeout(function() { el.classList.remove('highlight'); }, 2000); }
            });
        }

        // Свайп вправо = ответить + контекстное меню по долгому нажатию
        var swipe = { startX: 0, startY: 0, moving: false, fired: false };
        var pressTimer;

        div.addEventListener('touchstart', function(e) {
            swipe.startX = e.touches[0].clientX;
            swipe.startY = e.touches[0].clientY;
            swipe.moving = false;
            swipe.fired = false;
            pressTimer = setTimeout(function() { if (!swipe.moving) showMessageContextMenu(key, msg); }, 600);
        }, { passive: true });

        div.addEventListener('touchmove', function(e) {
            var dx = e.touches[0].clientX - swipe.startX;
            var dy = e.touches[0].clientY - swipe.startY;
            if (!swipe.moving && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
                swipe.moving = true;
                clearTimeout(pressTimer);
            }
            // Горизонтальный свайп вправо
            if (swipe.moving && dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                e.preventDefault();
                div.classList.add('swiping');
                div.style.transform = 'translateX(' + Math.min(dx * 0.55, 72) + 'px)';
                if (dx > 65 && !swipe.fired) {
                    swipe.fired = true;
                    if (navigator.vibrate) navigator.vibrate(12);
                }
            }
        }, { passive: false });

        div.addEventListener('touchend', function() {
            clearTimeout(pressTimer);
            div.classList.remove('swiping');
            div.style.transform = '';
            if (swipe.fired) setReply(key, msg);
        }, { passive: true });

        div.addEventListener('touchcancel', function() {
            clearTimeout(pressTimer);
            div.classList.remove('swiping');
            div.style.transform = '';
        }, { passive: true });

        div.addEventListener('contextmenu', function(e) { e.preventDefault(); showMessageContextMenu(key, msg); });
    }

    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateMessage(key, msg) {
    var el = messagesDiv.querySelector('[data-msg-key="' + key + '"]');
    if (!el) return;
    if (msg.deleted) {
        el.className = 'message system deleted';
        el.textContent = '\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0443\u0434\u0430\u043B\u0435\u043D\u043E';
        return;
    }
    if (msg.sender !== '__system__') {
        var isMine = msg.sender === myUsername;
        var senderHtml = '';
        if (currentChatType === 'group' && !isMine) senderHtml = '<div class="msg-sender">' + escapeHtml(msg.sender) + '</div>';
        var replyHtml = '';
        if (msg.replyTo) {
            replyHtml = '<div class="msg-reply-quote" data-reply-key="' + escapeHtml(msg.replyTo.key) + '">' +
                '<div class="msg-reply-quote-sender">' + escapeHtml(msg.replyTo.sender) + '</div>' +
                '<div class="msg-reply-quote-text">' + escapeHtml(msg.replyTo.text) + '</div>' +
                '</div>';
        }
        var editedHtml = msg.edited ? ' <span class="edited-mark">(\u0438\u0437\u043C.)</span>' : '';
        var statusHtml = isMine ? '<span class="msg-status">' + getStatusIcon(msg) + '</span>' : '';
        el.innerHTML = senderHtml + replyHtml +
            '<div class="text">' + escapeHtml(msg.text) + editedHtml + '</div>' +
            '<div class="time">' + formatTime(msg.timestamp) + ' ' + statusHtml + '</div>';
        var quoteEl = el.querySelector('.msg-reply-quote');
        if (quoteEl) {
            quoteEl.addEventListener('click', function(e) {
                e.stopPropagation();
                var targetKey = quoteEl.getAttribute('data-reply-key');
                var target = messagesDiv.querySelector('[data-msg-key="' + targetKey + '"]');
                if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('highlight'); setTimeout(function() { target.classList.remove('highlight'); }, 2000); }
            });
        }
    }
}

function removeMessageEl(key) {
    var el = messagesDiv.querySelector('[data-msg-key="' + key + '"]');
    if (el) el.remove();
}

// ============================================================
// Контекстное меню сообщения
// ============================================================
function showMessageContextMenu(key, msg) {
    var buttons = [];
    var isMine = msg.sender === myUsername;
    var canEdit = isMine && (Date.now() - msg.timestamp < EDIT_TIME_LIMIT);

    buttons.push({ text: '\u2190 \u041E\u0442\u0432\u0435\u0442\u0438\u0442\u044C', action: function() { setReply(key, msg); } });
    buttons.push({ text: '\uD83D\uDCCC \u0417\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C', action: function() { pinMessage(key, msg); } });
    if (canEdit) {
        buttons.push({ text: '\u270F\uFE0F \u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C', action: function() { editMessage(key, msg); } });
        buttons.push({ text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C', cls: 'ctx-danger', action: function() { deleteMessage(key); } });
    }
    buttons.push({ text: '\u041E\u0442\u043C\u0435\u043D\u0430', cls: 'ctx-cancel' });
    showMsgContext(buttons);
}

function editMessage(key, msg) {
    showModalWithInput('\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C', '\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435', msg.text, function(t) {
        if (!t || t === msg.text) return;
        db.ref('chats/' + currentChatId + '/messages/' + key).update({ text: t, edited: true, editedAt: firebase.database.ServerValue.TIMESTAMP });
    });
}

function deleteMessage(key) {
    showModal('\u0423\u0434\u0430\u043B\u0438\u0442\u044C?', [
        { text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C', cls: 'btn-danger', action: function() {
            db.ref('chats/' + currentChatId + '/messages/' + key).update({ deleted: true, text: '' });
        }},
        { text: '\u041E\u0442\u043C\u0435\u043D\u0430' }
    ]);
}

// ============================================================
// Закреплённые сообщения
// ============================================================
function loadPinnedMessages(chatId) {
    pinnedBar.style.display = 'none';
    pinnedMessages.innerHTML = '';
    db.ref('chats/' + chatId + '/pinned').on('value', function(s) {
        var pinned = s.val() || {};
        var keys = Object.keys(pinned);
        if (!keys.length) { pinnedBar.style.display = 'none'; return; }
        pinnedBar.style.display = 'block';
        pinnedMessages.innerHTML = '';
        pinnedMessages.classList.remove('collapsed');
        keys.forEach(function(pk) {
            var p = pinned[pk];
            var item = document.createElement('div');
            item.className = 'pinned-item';
            item.innerHTML = '<div style="flex:1;min-width:0"><div class="pinned-item-sender">' + escapeHtml(p.sender) + '</div><div class="pinned-item-text">' + escapeHtml(p.text) + '</div></div><button class="btn-unpin">\u2715</button>';
            item.querySelector('.btn-unpin').addEventListener('click', function(e) { e.stopPropagation(); db.ref('chats/' + chatId + '/pinned/' + pk).remove(); });
            item.addEventListener('click', function() {
                var el = messagesDiv.querySelector('[data-msg-key="' + pk + '"]');
                if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight'); setTimeout(function() { el.classList.remove('highlight'); }, 2000); }
            });
            pinnedMessages.appendChild(item);
        });
    });
}

function pinMessage(key, msg) {
    if (!currentChatId) return;
    db.ref('chats/' + currentChatId + '/pinned').once('value').then(function(s) {
        if (Object.keys(s.val() || {}).length >= PIN_LIMIT) { showModal('\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C ' + PIN_LIMIT, [{ text: '\u041E\u041A' }]); return; }
        db.ref('chats/' + currentChatId + '/pinned/' + key).set({
            text: msg.text.substring(0, 100), sender: msg.sender,
            pinnedBy: myUsername, pinnedAt: firebase.database.ServerValue.TIMESTAMP
        });
    });
}

// ============================================================
// Поиск
// ============================================================
function openSearch() {
    searchBar.style.display = 'block';
    searchInput.value = '';
    searchResults.innerHTML = '';
    searchInput.focus();
    searchSenderFilter.innerHTML = '<option value="">\u0412\u0441\u0435</option>';
    if (currentChatType === 'group') {
        db.ref('groups/' + currentChatId + '/members').once('value').then(function(s) {
            Object.keys(s.val() || {}).forEach(function(m) {
                var opt = document.createElement('option'); opt.value = m; opt.textContent = m;
                searchSenderFilter.appendChild(opt);
            });
        });
    }
    searchSenderFilter.style.display = currentChatType === 'group' ? '' : 'none';
}

function closeSearch() { searchBar.style.display = 'none'; searchInput.value = ''; searchResults.innerHTML = ''; }

function doSearch() {
    var q = searchInput.value.trim().toLowerCase();
    var sf = searchSenderFilter.value;
    searchResults.innerHTML = '';
    if (!q && !sf) return;
    db.ref('chats/' + currentChatId + '/messages').once('value').then(function(s) {
        var msgs = s.val() || {}, results = [];
        Object.keys(msgs).forEach(function(key) {
            var m = msgs[key];
            if (m.deleted || m.sender === '__system__') return;
            if (sf && m.sender !== sf) return;
            if (q && m.text.toLowerCase().indexOf(q) < 0) return;
            results.push({ key: key, msg: m });
        });
        results.sort(function(a, b) { return (b.msg.timestamp || 0) - (a.msg.timestamp || 0); });
        if (!results.length) { searchResults.innerHTML = '<div class="search-no-results">\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E</div>'; return; }
        results.slice(0, 50).forEach(function(r) {
            var div = document.createElement('div');
            div.className = 'search-result-item';
            var th = escapeHtml(r.msg.text);
            if (q) { var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'); th = th.replace(re, '<mark>$1</mark>'); }
            div.innerHTML = '<div class="search-result-sender">' + escapeHtml(r.msg.sender) + '</div><div class="search-result-text">' + th + '</div><div class="search-result-time">' + formatDate(r.msg.timestamp) + ' ' + formatTime(r.msg.timestamp) + '</div>';
            div.addEventListener('click', function() {
                closeSearch();
                var el = messagesDiv.querySelector('[data-msg-key="' + r.key + '"]');
                if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight'); setTimeout(function() { el.classList.remove('highlight'); }, 2000); }
            });
            searchResults.appendChild(div);
        });
    });
}

// ============================================================
// Черновики
// ============================================================
function saveDraft(chatId, text) {
    if (!myUsername || !chatId || !db) return;
    var path = 'users/' + fbKey(myUsername) + '/drafts/' + fbKey(chatId);
    if (text) db.ref(path).set(text);
    else db.ref(path).remove();
}

function loadDraft(chatId) {
    if (!myUsername || !chatId || !db) return;
    db.ref('users/' + fbKey(myUsername) + '/drafts/' + fbKey(chatId)).once('value').then(function(s) {
        var draft = s.val();
        if (draft && currentChatId === chatId) {
            messageInput.value = draft;
            $('draft-indicator').style.display = 'block';
        } else {
            $('draft-indicator').style.display = 'none';
        }
    });
}

function clearDraft(chatId) {
    if (!myUsername || !chatId || !db) return;
    db.ref('users/' + fbKey(myUsername) + '/drafts/' + fbKey(chatId)).remove();
    $('draft-indicator').style.display = 'none';
}

function onMessageInputChange() {
    clearTimeout(draftTimer);
    var text = messageInput.value.trim();
    $('draft-indicator').style.display = text ? 'block' : 'none';
    var chatId = currentChatId;
    draftTimer = setTimeout(function() {
        if (chatId) saveDraft(chatId, text);
    }, DRAFT_DEBOUNCE);
}

// ============================================================
// Ответ на сообщение
// ============================================================
function setReply(key, msg) {
    replyTo = { key: key, sender: msg.sender, text: msg.text };
    $('reply-preview-sender').textContent = msg.sender;
    $('reply-preview-text').textContent = msg.text;
    $('reply-preview').style.display = 'flex';
    messageInput.focus();
}

function cancelReply() {
    replyTo = null;
    $('reply-preview').style.display = 'none';
}

// ============================================================
// Отправка сообщения
// ============================================================
function sendMessage() {
    var text = messageInput.value.trim();
    if (!text || !currentChatId || !db) return;

    // Сразу очищаем поле и черновик
    messageInput.value = '';
    $('draft-indicator').style.display = 'none';
    clearTimeout(draftTimer);
    clearDraft(currentChatId);

    var chatId = currentChatId;
    var chatType = currentChatType;
    var peerId = currentPeerId;

    var msgData = { sender: myUsername, text: text, timestamp: firebase.database.ServerValue.TIMESTAMP };
    if (replyTo) {
        msgData.replyTo = { key: replyTo.key, sender: replyTo.sender, text: replyTo.text.substring(0, 100) };
        cancelReply();
    }

    var chatRef = db.ref('chats/' + chatId + '/messages');
    var newMsgRef = chatRef.push(msgData);
    var msgKey = newMsgRef.key;

    var preview = text.length > 40 ? text.substring(0, 40) + '...' : text;
    var updateData = { lastMessage: myUsername + ': ' + preview, lastTime: firebase.database.ServerValue.TIMESTAMP };

    if (chatType === 'dm') {
        db.ref('user_chats/' + fbKey(myUsername) + '/' + fbKey(peerId)).update(updateData);
        db.ref('user_chats/' + fbKey(peerId) + '/' + fbKey(myUsername)).update(updateData);
    } else {
        db.ref('groups/' + chatId + '/members').once('value').then(function(s) {
            Object.keys(s.val() || {}).forEach(function(m) {
                db.ref('user_chats/' + fbKey(m) + '/' + chatId).update(updateData);
            });
        });
    }

    // Лимит сообщений
    chatRef.once('value').then(function(cs) {
        if (cs.numChildren() > MESSAGE_LIMIT) {
            chatRef.orderByChild('timestamp').limitToFirst(cs.numChildren() - MESSAGE_LIMIT).once('value').then(function(old) {
                var upd = {}; old.forEach(function(c) { upd[c.key] = null; }); chatRef.update(upd);
            });
        }
    });

    messageInput.focus();
}

// ============================================================
// Создание группы
// ============================================================
function openCreateGroup() {
    newGroupMembers = [];
    $('group-name-input').value = ''; $('group-desc-input').value = '';
    $('group-member-input').value = ''; $('members-list').innerHTML = '';
    $('create-group-error').textContent = '';
    setStatus($('group-member-status'), '', '');
    showScreen(screenCreateGroup);
}

function addMemberToNew() {
    var input = $('group-member-input'), name = sanitize(input.value), st = $('group-member-status');
    if (!name) { setStatus(st, '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043B\u043E\u0433\u0438\u043D', 'error'); return; }
    if (name === myUsername) { setStatus(st, '\u0412\u044B \u0443\u0436\u0435 \u0432 \u0433\u0440\u0443\u043F\u043F\u0435', 'error'); return; }
    if (newGroupMembers.indexOf(name) >= 0) { setStatus(st, '\u0423\u0436\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D', 'error'); return; }
    db.ref('users/' + fbKey(name)).once('value').then(function(s) {
        if (!s.exists()) { setStatus(st, '\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D', 'error'); return; }
        newGroupMembers.push(name); input.value = ''; setStatus(st, '', '');
        renderMembersList($('members-list'), newGroupMembers, true);
    });
}

function renderMembersList(container, members, removable) {
    container.innerHTML = '';
    members.forEach(function(m) {
        var chip = document.createElement('span'); chip.className = 'member-chip'; chip.innerHTML = escapeHtml(m);
        if (removable) {
            chip.innerHTML += ' <button class="remove-member">\u00D7</button>';
            chip.querySelector('.remove-member').addEventListener('click', function() {
                newGroupMembers.splice(newGroupMembers.indexOf(m), 1);
                renderMembersList(container, newGroupMembers, true);
            });
        }
        container.appendChild(chip);
    });
}

function createGroup() {
    var name = $('group-name-input').value.trim(), desc = $('group-desc-input').value.trim(), err = $('create-group-error');
    if (!name || name.length < 2) { setStatus(err, '\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u2014 \u043C\u0438\u043D. 2 \u0441\u0438\u043C\u0432\u043E\u043B\u0430', 'error'); return; }
    var groupId = generateGroupId(), members = {};
    members[myUsername] = true;
    newGroupMembers.forEach(function(m) { members[m] = true; });
    db.ref('groups/' + groupId).set({ name: name, description: desc, creator: myUsername, createdAt: firebase.database.ServerValue.TIMESTAMP, members: members }).then(function() {
        var ci = { type: 'group', chatId: groupId, groupName: name, lastMessage: '\u0413\u0440\u0443\u043F\u043F\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0430', lastTime: firebase.database.ServerValue.TIMESTAMP };
        Object.keys(members).forEach(function(m) { db.ref('user_chats/' + fbKey(m) + '/' + groupId).set(ci); });
        db.ref('chats/' + groupId + '/messages').push({ sender: '__system__', text: myUsername + ' \u0441\u043E\u0437\u0434\u0430\u043B(\u0430) \u0433\u0440\u0443\u043F\u043F\u0443 "' + name + '"', timestamp: firebase.database.ServerValue.TIMESTAMP });
        openGroupChat(groupId, name);
    }).catch(function(e) { setStatus(err, e.message, 'error'); });
}

// ============================================================
// Информация о группе
// ============================================================
function openGroupInfo() {
    if (currentChatType !== 'group' || !currentChatId) return;
    showScreen(screenGroupInfo);
    var groupId = currentChatId;
    db.ref('groups/' + groupId).once('value').then(function(s) {
        var data = s.val(); if (!data) return;
        $('info-group-name').textContent = data.name || '\u0413\u0440\u0443\u043F\u043F\u0430';
        $('info-group-desc').textContent = data.description || '\u041D\u0435\u0442 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u044F';
        $('info-group-creator').textContent = '\u0421\u043E\u0437\u0434\u0430\u0442\u0435\u043B\u044C: ' + (data.creator || '?');
        var isCreator = data.creator === myUsername, members = Object.keys(data.members || {});
        $('info-members-label').textContent = '\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 (' + members.length + '):';
        var list = $('info-members-list'); list.innerHTML = '';
        members.forEach(function(m) {
            var chip = document.createElement('span'); chip.className = 'member-chip' + (m === data.creator ? ' creator' : '');
            chip.innerHTML = escapeHtml(m) + (m === data.creator ? ' \u2605' : '');
            if (isCreator && m !== myUsername) {
                chip.innerHTML += ' <button class="remove-member">\u00D7</button>';
                chip.querySelector('.remove-member').addEventListener('click', function() { removeMemberFromGroup(groupId, m); });
            }
            list.appendChild(chip);
        });
        $('info-add-member-section').style.display = isCreator ? 'block' : 'none';
        var actions = $('info-actions'); actions.innerHTML = '';
        if (isCreator) {
            var bd = document.createElement('button'); bd.className = 'btn-danger'; bd.textContent = '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443';
            bd.addEventListener('click', function() { showModal('\u0422\u043E\u0447\u043D\u043E?', [{ text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C', cls: 'btn-danger', action: function() { deleteGroupForAll(groupId); } }, { text: '\u041E\u0442\u043C\u0435\u043D\u0430' }]); });
            actions.appendChild(bd);
        } else {
            var bl = document.createElement('button'); bl.className = 'btn-danger-outline'; bl.textContent = '\u041F\u043E\u043A\u0438\u043D\u0443\u0442\u044C';
            bl.addEventListener('click', function() { leaveGroup(groupId); }); actions.appendChild(bl);
        }
    });
}

function addMemberToExistingGroup() {
    var input = $('info-member-input'), st = $('info-member-status'), name = sanitize(input.value);
    if (!name) { setStatus(st, '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043B\u043E\u0433\u0438\u043D', 'error'); return; }
    var groupId = currentChatId;
    db.ref('users/' + fbKey(name)).once('value').then(function(s) {
        if (!s.exists()) { setStatus(st, '\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D', 'error'); return; }
        db.ref('groups/' + groupId + '/members/' + name).set(true);
        db.ref('groups/' + groupId).once('value').then(function(gs) {
            db.ref('user_chats/' + fbKey(name) + '/' + groupId).set({ type: 'group', chatId: groupId, groupName: gs.val().name, lastMessage: '\u0412\u044B \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B', lastTime: firebase.database.ServerValue.TIMESTAMP });
        });
        db.ref('chats/' + groupId + '/messages').push({ sender: '__system__', text: myUsername + ' \u0434\u043E\u0431\u0430\u0432\u0438\u043B(\u0430) ' + name, timestamp: firebase.database.ServerValue.TIMESTAMP });
        input.value = ''; setStatus(st, '\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D!', 'success'); openGroupInfo();
    });
}

function removeMemberFromGroup(groupId, member) {
    showModal('\u0423\u0434\u0430\u043B\u0438\u0442\u044C ' + member + '?', [
        { text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C', cls: 'btn-danger', action: function() {
            db.ref('groups/' + groupId + '/members/' + member).remove();
            db.ref('user_chats/' + fbKey(member) + '/' + groupId).remove();
            db.ref('chats/' + groupId + '/messages').push({ sender: '__system__', text: member + ' \u0443\u0434\u0430\u043B\u0451\u043D(\u0430)', timestamp: firebase.database.ServerValue.TIMESTAMP });
            openGroupInfo();
        }},
        { text: '\u041E\u0442\u043C\u0435\u043D\u0430' }
    ]);
}

// ============================================================
// Меню чата
// ============================================================
function showChatMenu() {
    var buttons = [];
    if (currentChatType === 'group') buttons.push({ text: '\u0418\u043D\u0444\u043E', cls: 'btn-secondary', action: openGroupInfo });
    buttons.push({ text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443 \u0441\u0435\u0431\u044F', cls: 'btn-danger-outline', action: function() {
        if (currentChatType === 'dm') db.ref('user_chats/' + fbKey(myUsername) + '/' + fbKey(currentPeerId)).remove();
        else db.ref('user_chats/' + fbKey(myUsername) + '/' + currentChatId).remove();
        goBack();
    }});
    if (currentChatType === 'dm') buttons.push({ text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443 \u043E\u0431\u043E\u0438\u0445', cls: 'btn-danger', action: function() { deleteDmForBoth(fbKey(currentPeerId), currentPeerId); goBack(); } });
    buttons.push({ text: '\u041E\u0442\u043C\u0435\u043D\u0430' });
    showModal('\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F', buttons);
}

function goBack() {
    if (currentQuery) { currentQuery.off(); currentQuery = null; }
    if (currentChatId && db) db.ref('chats/' + currentChatId + '/pinned').off();
    closeSearch();
    cancelReply();
    currentChatId = null; currentChatType = null; currentPeerId = null;
    peerIdInput.value = '';
    showScreen(screenMain);
    updateBadges();
}

// ============================================================
// Обработчики
// ============================================================
function setupEvents() {
    $('btn-connect').addEventListener('click', function() { startDmChat(peerIdInput.value); });
    peerIdInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') startDmChat(peerIdInput.value); });
    $('btn-send').addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') sendMessage(); });
    messageInput.addEventListener('input', onMessageInputChange);
    $('btn-cancel-reply').addEventListener('click', cancelReply);

    $('btn-back').addEventListener('click', goBack);
    $('btn-chat-menu').addEventListener('click', showChatMenu);
    $('chat-header-info').addEventListener('click', function() { if (currentChatType === 'group') openGroupInfo(); });

    $('btn-search-chat').addEventListener('click', openSearch);
    $('btn-close-search').addEventListener('click', closeSearch);
    searchInput.addEventListener('input', function() { clearTimeout(searchInput._t); searchInput._t = setTimeout(doSearch, 300); });
    searchSenderFilter.addEventListener('change', doSearch);

    $('btn-toggle-pinned').addEventListener('click', function() {
        pinnedMessages.classList.toggle('collapsed');
        $('btn-toggle-pinned').textContent = pinnedMessages.classList.contains('collapsed') ? '\u25B6' : '\u25BC';
    });

    $('btn-profile').addEventListener('click', openProfile);
    $('btn-back-profile').addEventListener('click', function() { showScreen(screenMain); });
    $('btn-save-name').addEventListener('click', saveDisplayName);
    $('btn-change-pass').addEventListener('click', changePassword);
    $('btn-link-email').addEventListener('click', linkEmail);
    $('btn-verify-email').addEventListener('click', verifyEmail);
    $('btn-unlink-email').addEventListener('click', unlinkEmail);
    $('btn-forgot-pass').addEventListener('click', forgotPassword);

    $('btn-logout').addEventListener('click', function() {
        localStorage.removeItem('berezka_user'); myUsername = null; currentChatId = null;
        if (db) db.ref().off(); globalChatListeners = {}; showScreen(screenAuth);
    });

    btnCopy.addEventListener('click', function() {
        var t = myUsername || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(function() {
                btnCopy.innerHTML = '<svg width="20" height="20"><use href="#ico-check"/></svg>';
                setTimeout(function() { btnCopy.innerHTML = '<svg width="20" height="20"><use href="#ico-copy"/></svg>'; }, 1500);
            }).catch(function() { copyFallback(t); });
        } else copyFallback(t);
    });

    $('btn-new-group').addEventListener('click', openCreateGroup);
    $('btn-back-create').addEventListener('click', function() { showScreen(screenMain); });
    $('btn-add-member').addEventListener('click', addMemberToNew);
    $('group-member-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') addMemberToNew(); });
    $('btn-create-group').addEventListener('click', createGroup);

    $('btn-back-info').addEventListener('click', function() {
        if (currentChatId) openGroupChat(currentChatId, chatPeerName.textContent);
        else showScreen(screenMain);
    });
    $('btn-info-add-member').addEventListener('click', addMemberToExistingGroup);
    $('info-member-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') addMemberToExistingGroup(); });

    modalOverlay.addEventListener('click', function(e) { if (e.target === modalOverlay) hideModal(); });
    msgContextOverlay.addEventListener('click', function(e) { if (e.target === msgContextOverlay) hideMsgContext(); });

    // Отмечаем прочитанным при возврате в приложение
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible' && currentChatId) markMessagesRead(currentChatId);
    });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', function() {
            if (currentChatId) requestAnimationFrame(function() { messagesDiv.scrollTop = messagesDiv.scrollHeight; });
        });
    }
}

function copyFallback(t) {
    var tmp = document.createElement('textarea');
    tmp.value = t; tmp.style.position = 'fixed'; tmp.style.opacity = '0';
    document.body.appendChild(tmp); tmp.select();
    document.execCommand('copy'); document.body.removeChild(tmp);
    btnCopy.innerHTML = '<svg width="20" height="20"><use href="#ico-check"/></svg>';
    setTimeout(function() { btnCopy.innerHTML = '<svg width="20" height="20"><use href="#ico-copy"/></svg>'; }, 1500);
}

// ============================================================
// Service Worker
// ============================================================
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(function() {}); }

// ============================================================
// Запуск
// ============================================================
initDOM();
setupAuth();
setupEvents();

(function init() {
    if (!db) return;
    var saved = localStorage.getItem('berezka_user');
    if (saved) {
        db.ref('users/' + fbKey(saved)).once('value').then(function(s) {
            if (s.exists()) { myUsername = saved; startApp(); }
            else { localStorage.removeItem('berezka_user'); showScreen(screenAuth); }
        }).catch(function() { showScreen(screenAuth); });
    } else showScreen(screenAuth);
})();
