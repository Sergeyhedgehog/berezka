#!/usr/bin/env python3
"""
Берёзка — Push-уведомления для iPhone (Safari PWA) и Android Chrome.

Режим: CRON — запускать каждую минуту через ISPmanager → Планировщик:
    * * * * *  cd /home/USER/push-server && python3 push_cron.py >> push.log 2>&1

Что делает:
  - Проверяет Firebase на новые непрочитанные сообщения за последние 2 минуты
  - Находит получателей, у которых сохранена Web Push подписка
  - Отправляет push-уведомление через VAPID (APNs для iOS, FCM для Android)
  - Помечает доставленные сообщения, чтобы не дублировать
"""

import os, sys, json, time, requests
from pywebpush import webpush, WebPushException
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

FIREBASE_URL   = os.getenv('FIREBASE_URL', '').rstrip('/')
VAPID_PRIVATE  = os.getenv('VAPID_PRIVATE_KEY', '')
VAPID_EMAIL    = os.getenv('VAPID_EMAIL', '')

# Файл состояния — хранит уже отправленные уведомления {msg_key:username -> ts}
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.push_state.json')

# Смотрим сообщения за последние 2 минуты
LOOK_BACK_MS = 2 * 60 * 1000


# ─── Firebase helpers ──────────────────────────────────────────────────────────

def fb_key(s: str) -> str:
    """Преобразует строку в валидный Firebase-ключ."""
    for c in '.#$[]':
        s = s.replace(c, '_')
    return s

def fb_get(path: str):
    """GET к Firebase REST API. Возвращает python-объект или None."""
    try:
        r = requests.get(f"{FIREBASE_URL}/{path}.json", timeout=10)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"[GET error] {path}: {e}")
    return None

def fb_delete(path: str):
    """DELETE к Firebase REST API."""
    try:
        requests.delete(f"{FIREBASE_URL}/{path}.json", timeout=5)
    except Exception as e:
        print(f"[DELETE error] {path}: {e}")


# ─── State (processed notifications) ──────────────────────────────────────────

def load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

def save_state(state: dict):
    # Оставляем только последние 2000 записей (чтобы файл не рос)
    if len(state) > 2000:
        sorted_keys = sorted(state, key=lambda k: state[k])
        state = {k: state[k] for k in sorted_keys[-1000:]}
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f)


# ─── Web Push ──────────────────────────────────────────────────────────────────

def send_push(sub_info: dict, title: str, body: str) -> str:
    """
    Отправляет Web Push. Возвращает 'ok', 'expired' или 'error'.
    Для iOS: Safari PWA (iOS 16.4+), для Android: Chrome.
    """
    try:
        webpush(
            subscription_info=sub_info,
            data=json.dumps({
                'title': title,
                'body':  body[:120],
                'icon':  '/icon-192.png',
                'badge': '/icon-192.png',
            }),
            vapid_private_key=VAPID_PRIVATE,
            vapid_claims={"sub": f"mailto:{VAPID_EMAIL}"}
        )
        return 'ok'
    except WebPushException as e:
        err = str(e)
        if '410' in err or '404' in err:
            return 'expired'   # подписка устарела
        print(f"[push error] {e}")
        return 'error'
    except Exception as e:
        print(f"[push exception] {e}")
        return 'error'


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not FIREBASE_URL:
        sys.exit("Ошибка: FIREBASE_URL не задан в .env")
    if not VAPID_PRIVATE:
        sys.exit("Ошибка: VAPID_PRIVATE_KEY не задан. Запустите generate_vapid.py")

    now_ms   = int(time.time() * 1000)
    since_ms = now_ms - LOOK_BACK_MS

    state     = load_state()
    new_state = dict(state)

    # ── Загружаем всех пользователей ──────────────────────────────────────────
    users = fb_get('users')
    if not users:
        save_state(new_state)
        return

    # Для каждого пользователя с Web Push подпиской
    for user_key, user_data in users.items():
        if not isinstance(user_data, dict):
            continue
        sub      = user_data.get('pushSubscription')
        username = user_data.get('username', user_key)
        if not sub:
            continue

        # ── Получаем список чатов пользователя ────────────────────────────────
        user_chats = fb_get(f'user_chats/{user_key}')
        if not user_chats:
            continue

        for chat_key, chat_info in user_chats.items():
            if not isinstance(chat_info, dict):
                continue
            chat_id = chat_info.get('chatId', chat_key)

            # ── Получаем сообщения чата ────────────────────────────────────────
            msgs = fb_get(f'chats/{chat_id}/messages')
            if not msgs or not isinstance(msgs, dict):
                continue

            for msg_key, msg in msgs.items():
                if not isinstance(msg, dict):
                    continue

                ts         = msg.get('timestamp', 0)
                state_key  = f"{msg_key}:{username}"

                # Старое сообщение — просто запоминаем и пропускаем
                if ts < since_ms:
                    new_state[state_key] = ts
                    continue

                # Уже отправляли уведомление для этого (сообщение, получатель)?
                if state_key in state:
                    continue

                new_state[state_key] = ts

                sender = msg.get('sender', '')
                text   = msg.get('text', '')

                # Пропускаем: системные, удалённые, от себя
                if not sender or sender == '__system__' or msg.get('deleted') or sender == username:
                    continue

                # Уже прочитано получателем?
                read_by = msg.get('readBy', {})
                if fb_key(username) in read_by:
                    continue

                # ── Отправляем push ────────────────────────────────────────────
                title  = f"Берёзка — {sender}"
                result = send_push(sub, title, text)

                if result == 'ok':
                    print(f"[✓] Push → {username}  от {sender}: {text[:50]!r}")
                elif result == 'expired':
                    print(f"[×] Устаревшая подписка удалена: {username}")
                    fb_delete(f'users/{user_key}/pushSubscription')
                    break  # больше нечего отправлять этому пользователю

    save_state(new_state)
    print(f"[done] проверено в {time.strftime('%H:%M:%S')}")


if __name__ == '__main__':
    main()
