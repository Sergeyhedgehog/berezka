#!/usr/bin/env python3
"""
Генерация VAPID-ключей для Web Push (iPhone Safari + Android Chrome).
Запустите ОДИН РАЗ: python3 generate_vapid.py

После запуска:
  1. Скопируйте VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY в файл .env
  2. В app.js замените значение переменной VAPID_PUBLIC_KEY на публичный ключ
"""

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
import base64

def main():
    # Генерируем пару EC-ключей (SECP256R1 = P-256, требуется для VAPID)
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
    public_key  = private_key.public_key()

    # Приватный ключ — raw bytes → urlsafe base64 без паддинга
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption()
    )
    private_b64 = base64.urlsafe_b64encode(private_bytes).decode().rstrip('=')

    # Публичный ключ — uncompressed point (04 || x || y, 65 байт) → urlsafe base64
    public_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint
    )
    public_b64 = base64.urlsafe_b64encode(public_bytes).decode().rstrip('=')

    print("=" * 60)
    print("  VAPID-ключи сгенерированы")
    print("=" * 60)
    print(f"\nVAPID_PUBLIC_KEY={public_b64}")
    print(f"VAPID_PRIVATE_KEY={private_b64}")
    print("\n" + "=" * 60)
    print("Шаги:")
    print("1. Скопируйте строки выше в файл .env")
    print("2. В app.js найдите строку:")
    print("     var VAPID_PUBLIC_KEY = '';")
    print("   и замените на:")
    print(f"     var VAPID_PUBLIC_KEY = '{public_b64}';")
    print("3. Загрузите обновлённый app.js на хостинг")
    print("=" * 60)

if __name__ == '__main__':
    main()
