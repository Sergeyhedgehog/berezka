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

var MESSAGE_LIMIT = 100;
var allScreens = [];
var myUsername = null;
var currentChatId = null;
var currentChatType = null; // 'dm' or 'group'
var currentPeerId = null;
var authMode = 'login';
var globalChatListeners = {};
var newGroupMembers = [];

// ============================================================
// DOM
// ============================================================
function $(id) { return document.getElementById(id); }

var screenLoading, screenAuth, screenMain, screenChat, screenCreateGroup, screenGroupInfo;
var authUsername, authPassword, btnAuth, authError;
var myIdSpan, btnCopy, peerIdInput, btnConnect, connectStatus, chatsList;
var chatPeerName, chatSubtitle, messagesDiv, messageInput;
var modalOverlay, modalTitle, modalBody;

function initDOM() {
    screenLoading = $('screen-loading');
    screenAuth = $('screen-auth');
    screenMain = $('screen-main');
    screenChat = $('screen-chat');
    screenCreateGroup = $('screen-create-group');
    screenGroupInfo = $('screen-group-info');
    allScreens = [screenLoading, screenAuth, screenMain, screenChat, screenCreateGroup, screenGroupInfo];

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
    return a < b ? 'dm_' + a + '_' + b : 'dm_' + b + '_' + a;
}

function formatTime(ts) {
    var d = new Date(ts);
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
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

function hideModal() { modalOverlay.style.display = 'none'; }

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
    var username = sanitize(authUsername.value);
    var password = authPassword.value.trim();
    if (!username || username.length < 2) { authError.textContent = '\u041B\u043E\u0433\u0438\u043D \u2014 \u043C\u0438\u043D\u0438\u043C\u0443\u043C 2 \u0441\u0438\u043C\u0432\u043E\u043B\u0430'; return; }
    if (!password || password.length < 4) { authError.textContent = '\u041F\u0430\u0440\u043E\u043B\u044C \u2014 \u043C\u0438\u043D\u0438\u043C\u0443\u043C 4 \u0441\u0438\u043C\u0432\u043E\u043B\u0430'; return; }

    var key = fbKey(username);
    sha256('berezka-pass-' + password).then(function(passHash) {
        if (authMode === 'register') {
            db.ref('users/' + key).once('value').then(function(s) {
                if (s.exists()) { authError.textContent = '\u041B\u043E\u0433\u0438\u043D \u0437\u0430\u043D\u044F\u0442'; return; }
                db.ref('users/' + key).set({ username: username, passHash: passHash, createdAt: firebase.database.ServerValue.TIMESTAMP })
                .then(function() { localStorage.setItem('berezka_user', username); myUsername = username; startApp(); })
                .catch(function(e) { authError.textContent = e.message; });
            });
        } else {
            db.ref('users/' + key).once('value').then(function(s) {
                if (!s.exists()) { authError.textContent = '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D'; return; }
                if (s.val().passHash !== passHash) { authError.textContent = '\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C'; return; }
                localStorage.setItem('berezka_user', username); myUsername = username; startApp();
            }).catch(function(e) { authError.textContent = e.message; });
        }
    });
}

// ============================================================
// Главный экран
// ============================================================
function startApp() {
    myIdSpan.textContent = myUsername;
    requestNotifications();
    showScreen(screenMain);
    loadChatsList();
    listenAllChats();
}

function loadChatsList() {
    var key = fbKey(myUsername);
    db.ref('user_chats/' + key).on('value', function(snapshot) {
        var chats = snapshot.val() || {};
        var old = chatsList.querySelectorAll('.chat-item, .no-chats');
        for (var i = 0; i < old.length; i++) old[i].remove();

        var keys = Object.keys(chats);
        if (keys.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'no-chats';
            empty.textContent = '\u041F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0447\u0430\u0442\u043E\u0432.';
            chatsList.appendChild(empty);
            return;
        }

        var entries = keys.map(function(k) { return { key: k, info: chats[k] }; });
        entries.sort(function(a, b) { return (b.info.lastTime || 0) - (a.info.lastTime || 0); });

        entries.forEach(function(entry) {
            var info = entry.info;
            var isGroup = info.type === 'group';
            var name = isGroup ? (info.groupName || 'Группа') : (info.peerName || entry.key);
            var icon = isGroup ? (name[0] || 'Г').toUpperCase() : (name[0] || '?').toUpperCase();

            var item = document.createElement('div');
            item.className = 'chat-item';
            item.innerHTML =
                '<div class="chat-item-icon">' + escapeHtml(icon) + '</div>' +
                '<div class="chat-item-body">' +
                '<div class="chat-item-name">' + escapeHtml(name) + (isGroup ? ' \uD83D\uDC65' : '') + '</div>' +
                '<div class="chat-item-preview">' + escapeHtml(info.lastMessage || '') + '</div>' +
                '</div>' +
                '<span class="chat-item-arrow">\u203A</span>';

            item.addEventListener('click', function() {
                if (isGroup) {
                    openGroupChat(info.chatId, info.groupName);
                } else {
                    openDmChat(info.peerName || entry.key);
                }
            });

            // Долгое нажатие — меню удаления
            var pressTimer;
            item.addEventListener('touchstart', function(e) {
                pressTimer = setTimeout(function() {
                    e.preventDefault();
                    showDeleteMenu(entry.key, info);
                }, 600);
            });
            item.addEventListener('touchend', function() { clearTimeout(pressTimer); });
            item.addEventListener('touchmove', function() { clearTimeout(pressTimer); });

            chatsList.appendChild(item);
        });
    });
}

// ============================================================
// Удаление чатов
// ============================================================
function showDeleteMenu(chatKey, info) {
    var isGroup = info.type === 'group';
    var buttons = [];

    buttons.push({
        text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443 \u0441\u0435\u0431\u044F',
        cls: 'btn-danger-outline',
        action: function() { deleteChatForMe(chatKey, info); }
    });

    if (isGroup) {
        // Проверяем, создатель ли я
        db.ref('groups/' + info.chatId + '/creator').once('value').then(function(s) {
            if (s.val() === myUsername) {
                showModal('\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443?', [
                    { text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443 \u0441\u0435\u0431\u044F', cls: 'btn-danger-outline', action: function() { deleteChatForMe(chatKey, info); } },
                    { text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0434\u043B\u044F \u0432\u0441\u0435\u0445', cls: 'btn-danger', action: function() { deleteGroupForAll(info.chatId); } },
                    { text: '\u041E\u0442\u043C\u0435\u043D\u0430' }
                ]);
            } else {
                showModal('\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0447\u0430\u0442?', [
                    { text: '\u041F\u043E\u043A\u0438\u043D\u0443\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443', cls: 'btn-danger-outline', action: function() { leaveGroup(info.chatId); } },
                    { text: '\u041E\u0442\u043C\u0435\u043D\u0430' }
                ]);
            }
        });
        return;
    }

    // ЛС
    var peerName = info.peerName || chatKey;
    buttons.push({
        text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443 \u043E\u0431\u043E\u0438\u0445',
        cls: 'btn-danger',
        action: function() { deleteDmForBoth(chatKey, peerName); }
    });
    buttons.push({ text: '\u041E\u0442\u043C\u0435\u043D\u0430' });
    showModal('\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0447\u0430\u0442?', buttons);
}

function deleteChatForMe(chatKey, info) {
    var key = fbKey(myUsername);
    db.ref('user_chats/' + key + '/' + chatKey).remove();
}

function deleteDmForBoth(chatKey, peerName) {
    var myKey = fbKey(myUsername);
    var peerKey = fbKey(peerName);
    var chatId = getDmChatId(myUsername, peerName);
    db.ref('user_chats/' + myKey + '/' + chatKey).remove();
    db.ref('user_chats/' + peerKey + '/' + myKey).remove();
    db.ref('chats/' + chatId).remove();
}

function deleteGroupForAll(groupId) {
    db.ref('groups/' + groupId + '/members').once('value').then(function(s) {
        var members = s.val() || {};
        Object.keys(members).forEach(function(m) {
            db.ref('user_chats/' + fbKey(m) + '/' + groupId).remove();
        });
        db.ref('groups/' + groupId).remove();
        db.ref('chats/' + groupId).remove();
    });
    showScreen(screenMain);
}

function leaveGroup(groupId) {
    db.ref('groups/' + groupId + '/members/' + myUsername).remove();
    db.ref('user_chats/' + fbKey(myUsername) + '/' + groupId).remove();
    // Системное сообщение
    db.ref('chats/' + groupId + '/messages').push({
        sender: '__system__',
        text: myUsername + ' \u043F\u043E\u043A\u0438\u043D\u0443\u043B(\u0430) \u0433\u0440\u0443\u043F\u043F\u0443',
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });
    showScreen(screenMain);
}

// ============================================================
// Глобальный слушатель уведомлений
// ============================================================
function listenAllChats() {
    var key = fbKey(myUsername);
    db.ref('user_chats/' + key).on('child_added', function(snap) {
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
                if (currentChatId !== chatId || document.visibilityState !== 'visible') {
                    showNotification(msg.sender, msg.text);
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

    var myKey = fbKey(myUsername);
    var peerKey = fbKey(peer);
    db.ref('user_chats/' + myKey + '/' + peerKey).update({ peerName: peer, type: 'dm', chatId: currentChatId });
    db.ref('user_chats/' + peerKey + '/' + myKey).update({ peerName: myUsername, type: 'dm', chatId: currentChatId });

    showScreen(screenChat);
    loadMessages(currentChatId);
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

    db.ref('groups/' + groupId + '/members').once('value').then(function(s) {
        var members = Object.keys(s.val() || {});
        chatSubtitle.textContent = members.length + ' \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A(\u043E\u0432)';
    });

    showScreen(screenChat);
    loadMessages(groupId);
    messageInput.focus();
}

function loadMessages(chatId) {
    var ref = db.ref('chats/' + chatId + '/messages');
    ref.off();
    ref.orderByChild('timestamp').limitToLast(MESSAGE_LIMIT).on('child_added', function(s) {
        renderMessage(s.val());
    });
}

function renderMessage(msg) {
    var div = document.createElement('div');
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
        div.innerHTML = senderHtml +
            '<div class="text">' + escapeHtml(msg.text) + '</div>' +
            '<div class="time">' + formatTime(msg.timestamp) + '</div>';
    }
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

    var preview = text.length > 40 ? text.substring(0, 40) + '...' : text;
    var updateData = { lastMessage: myUsername + ': ' + preview, lastTime: firebase.database.ServerValue.TIMESTAMP };

    if (currentChatType === 'dm') {
        var myKey = fbKey(myUsername);
        var peerKey = fbKey(currentPeerId);
        db.ref('user_chats/' + myKey + '/' + peerKey).update(updateData);
        db.ref('user_chats/' + peerKey + '/' + myKey).update(updateData);
    } else {
        // Группа — обновляем для всех участников
        db.ref('groups/' + currentChatId + '/members').once('value').then(function(s) {
            var members = Object.keys(s.val() || {});
            members.forEach(function(m) {
                db.ref('user_chats/' + fbKey(m) + '/' + currentChatId).update(updateData);
            });
        });
    }

    // Лимит сообщений
    chatRef.once('value').then(function(cs) {
        if (cs.numChildren() > MESSAGE_LIMIT) {
            chatRef.orderByChild('timestamp').limitToFirst(cs.numChildren() - MESSAGE_LIMIT).once('value').then(function(old) {
                var upd = {};
                old.forEach(function(c) { upd[c.key] = null; });
                chatRef.update(upd);
            });
        }
    });

    messageInput.value = '';
    messageInput.focus();
}

// ============================================================
// Создание группы
// ============================================================
function openCreateGroup() {
    newGroupMembers = [];
    $('group-name-input').value = '';
    $('group-desc-input').value = '';
    $('group-member-input').value = '';
    $('members-list').innerHTML = '';
    $('create-group-error').textContent = '';
    setStatus($('group-member-status'), '', '');
    showScreen(screenCreateGroup);
}

function addMemberToNew() {
    var input = $('group-member-input');
    var name = sanitize(input.value);
    var statusEl = $('group-member-status');
    if (!name) { setStatus(statusEl, '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043B\u043E\u0433\u0438\u043D', 'error'); return; }
    if (name === myUsername) { setStatus(statusEl, '\u0412\u044B \u0443\u0436\u0435 \u0432 \u0433\u0440\u0443\u043F\u043F\u0435', 'error'); return; }
    if (newGroupMembers.indexOf(name) >= 0) { setStatus(statusEl, '\u0423\u0436\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D', 'error'); return; }

    db.ref('users/' + fbKey(name)).once('value').then(function(s) {
        if (!s.exists()) { setStatus(statusEl, '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D', 'error'); return; }
        newGroupMembers.push(name);
        input.value = '';
        setStatus(statusEl, '', '');
        renderMembersList($('members-list'), newGroupMembers, true);
    });
}

function renderMembersList(container, members, removable) {
    container.innerHTML = '';
    members.forEach(function(m) {
        var chip = document.createElement('span');
        chip.className = 'member-chip';
        chip.innerHTML = escapeHtml(m);
        if (removable) {
            chip.innerHTML += ' <button class="remove-member">\u00D7</button>';
            chip.querySelector('.remove-member').addEventListener('click', function() {
                var idx = newGroupMembers.indexOf(m);
                if (idx >= 0) newGroupMembers.splice(idx, 1);
                renderMembersList(container, newGroupMembers, true);
            });
        }
        container.appendChild(chip);
    });
}

function createGroup() {
    var name = $('group-name-input').value.trim();
    var desc = $('group-desc-input').value.trim();
    var errEl = $('create-group-error');

    if (!name || name.length < 2) { setStatus(errEl, '\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u2014 \u043C\u0438\u043D. 2 \u0441\u0438\u043C\u0432\u043E\u043B\u0430', 'error'); return; }

    var groupId = generateGroupId();
    var members = {};
    members[myUsername] = true;
    newGroupMembers.forEach(function(m) { members[m] = true; });

    db.ref('groups/' + groupId).set({
        name: name,
        description: desc,
        creator: myUsername,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        members: members
    }).then(function() {
        // Добавляем чат всем участникам
        var chatInfo = {
            type: 'group',
            chatId: groupId,
            groupName: name,
            lastMessage: '\u0413\u0440\u0443\u043F\u043F\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0430',
            lastTime: firebase.database.ServerValue.TIMESTAMP
        };
        Object.keys(members).forEach(function(m) {
            db.ref('user_chats/' + fbKey(m) + '/' + groupId).set(chatInfo);
        });

        // Системное сообщение
        db.ref('chats/' + groupId + '/messages').push({
            sender: '__system__',
            text: myUsername + ' \u0441\u043E\u0437\u0434\u0430\u043B(\u0430) \u0433\u0440\u0443\u043F\u043F\u0443 "' + name + '"',
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });

        openGroupChat(groupId, name);
    }).catch(function(e) { setStatus(errEl, e.message, 'error'); });
}

// ============================================================
// Информация о группе
// ============================================================
function openGroupInfo() {
    if (currentChatType !== 'group' || !currentChatId) return;

    showScreen(screenGroupInfo);
    var groupId = currentChatId;

    db.ref('groups/' + groupId).once('value').then(function(s) {
        var data = s.val();
        if (!data) return;

        $('info-group-name').textContent = data.name || '\u0413\u0440\u0443\u043F\u043F\u0430';
        $('info-group-desc').textContent = data.description || '\u041D\u0435\u0442 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u044F';
        $('info-group-creator').textContent = '\u0421\u043E\u0437\u0434\u0430\u0442\u0435\u043B\u044C: ' + (data.creator || '?');

        var isCreator = data.creator === myUsername;
        var members = Object.keys(data.members || {});
        $('info-members-label').textContent = '\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 (' + members.length + '):';

        var list = $('info-members-list');
        list.innerHTML = '';
        members.forEach(function(m) {
            var chip = document.createElement('span');
            chip.className = 'member-chip' + (m === data.creator ? ' creator' : '');
            chip.innerHTML = escapeHtml(m) + (m === data.creator ? ' \u2605' : '');
            if (isCreator && m !== myUsername) {
                chip.innerHTML += ' <button class="remove-member">\u00D7</button>';
                chip.querySelector('.remove-member').addEventListener('click', function() {
                    removeMemberFromGroup(groupId, m, data.name);
                });
            }
            list.appendChild(chip);
        });

        // Добавление участников — только для создателя
        var addSection = $('info-add-member-section');
        addSection.style.display = isCreator ? 'block' : 'none';

        // Кнопки действий
        var actions = $('info-actions');
        actions.innerHTML = '';

        if (isCreator) {
            var btnDel = document.createElement('button');
            btnDel.className = 'btn-danger';
            btnDel.textContent = '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443 \u0434\u043B\u044F \u0432\u0441\u0435\u0445';
            btnDel.addEventListener('click', function() {
                showModal('\u0422\u043E\u0447\u043D\u043E \u0443\u0434\u0430\u043B\u0438\u0442\u044C?', [
                    { text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C', cls: 'btn-danger', action: function() { deleteGroupForAll(groupId); } },
                    { text: '\u041E\u0442\u043C\u0435\u043D\u0430' }
                ]);
            });
            actions.appendChild(btnDel);
        } else {
            var btnLeave = document.createElement('button');
            btnLeave.className = 'btn-danger-outline';
            btnLeave.textContent = '\u041F\u043E\u043A\u0438\u043D\u0443\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443';
            btnLeave.addEventListener('click', function() { leaveGroup(groupId); });
            actions.appendChild(btnLeave);
        }
    });
}

function addMemberToExistingGroup() {
    var input = $('info-member-input');
    var statusEl = $('info-member-status');
    var name = sanitize(input.value);
    if (!name) { setStatus(statusEl, '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043B\u043E\u0433\u0438\u043D', 'error'); return; }

    var groupId = currentChatId;
    db.ref('users/' + fbKey(name)).once('value').then(function(s) {
        if (!s.exists()) { setStatus(statusEl, '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D', 'error'); return; }

        db.ref('groups/' + groupId + '/members/' + name).set(true);

        db.ref('groups/' + groupId).once('value').then(function(gs) {
            var gData = gs.val();
            db.ref('user_chats/' + fbKey(name) + '/' + groupId).set({
                type: 'group', chatId: groupId, groupName: gData.name,
                lastMessage: '\u0412\u044B \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B \u0432 \u0433\u0440\u0443\u043F\u043F\u0443',
                lastTime: firebase.database.ServerValue.TIMESTAMP
            });
        });

        db.ref('chats/' + groupId + '/messages').push({
            sender: '__system__',
            text: myUsername + ' \u0434\u043E\u0431\u0430\u0432\u0438\u043B(\u0430) ' + name,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });

        input.value = '';
        setStatus(statusEl, '\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D!', 'success');
        openGroupInfo(); // обновить список
    });
}

function removeMemberFromGroup(groupId, member, groupName) {
    showModal('\u0423\u0434\u0430\u043B\u0438\u0442\u044C ' + member + '?', [
        { text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C', cls: 'btn-danger', action: function() {
            db.ref('groups/' + groupId + '/members/' + member).remove();
            db.ref('user_chats/' + fbKey(member) + '/' + groupId).remove();
            db.ref('chats/' + groupId + '/messages').push({
                sender: '__system__',
                text: member + ' \u0443\u0434\u0430\u043B\u0451\u043D(\u0430) \u0438\u0437 \u0433\u0440\u0443\u043F\u043F\u044B',
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
            openGroupInfo();
        }},
        { text: '\u041E\u0442\u043C\u0435\u043D\u0430' }
    ]);
}

// ============================================================
// Меню чата (три точки)
// ============================================================
function showChatMenu() {
    var buttons = [];

    if (currentChatType === 'group') {
        buttons.push({
            text: '\u0418\u043D\u0444\u043E \u043E \u0433\u0440\u0443\u043F\u043F\u0435',
            cls: 'btn-secondary',
            action: openGroupInfo
        });
    }

    buttons.push({
        text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443 \u0441\u0435\u0431\u044F',
        cls: 'btn-danger-outline',
        action: function() {
            if (currentChatType === 'dm') {
                db.ref('user_chats/' + fbKey(myUsername) + '/' + fbKey(currentPeerId)).remove();
            } else {
                db.ref('user_chats/' + fbKey(myUsername) + '/' + currentChatId).remove();
            }
            goBack();
        }
    });

    if (currentChatType === 'dm') {
        buttons.push({
            text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443 \u043E\u0431\u043E\u0438\u0445',
            cls: 'btn-danger',
            action: function() {
                deleteDmForBoth(fbKey(currentPeerId), currentPeerId);
                goBack();
            }
        });
    }

    buttons.push({ text: '\u041E\u0442\u043C\u0435\u043D\u0430' });
    showModal('\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F', buttons);
}

function goBack() {
    if (currentChatId && db) {
        db.ref('chats/' + currentChatId + '/messages').off();
    }
    currentChatId = null;
    currentChatType = null;
    currentPeerId = null;
    peerIdInput.value = '';
    showScreen(screenMain);
}

// ============================================================
// Обработчики
// ============================================================
function setupEvents() {
    $('btn-connect').addEventListener('click', function() { startDmChat(peerIdInput.value); });
    peerIdInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') startDmChat(peerIdInput.value); });

    $('btn-send').addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') sendMessage(); });

    $('btn-back').addEventListener('click', goBack);
    $('btn-chat-menu').addEventListener('click', showChatMenu);
    $('chat-header-info').addEventListener('click', function() {
        if (currentChatType === 'group') openGroupInfo();
    });

    $('btn-logout').addEventListener('click', function() {
        localStorage.removeItem('berezka_user');
        myUsername = null; currentChatId = null;
        if (db) db.ref().off();
        globalChatListeners = {};
        showScreen(screenAuth);
    });

    btnCopy.addEventListener('click', function() {
        var t = myUsername || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(function() {
                btnCopy.textContent = '\u2705';
                setTimeout(function() { btnCopy.textContent = '\uD83D\uDCCB'; }, 1500);
            }).catch(function() { copyFallback(t); });
        } else { copyFallback(t); }
    });

    // Группы
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

    // Клавиатура
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
    btnCopy.textContent = '\u2705';
    setTimeout(function() { btnCopy.textContent = '\uD83D\uDCCB'; }, 1500);
}

// ============================================================
// Service Worker
// ============================================================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function() {});
}

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
    } else {
        showScreen(screenAuth);
    }
})();
