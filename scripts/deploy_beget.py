"""Выкатка лендинга на Beget в папку /goulash/ сайта danyatroyanov.com.

Сборки нет: страница статичная, заливаются файлы из корня репозитория.
Как и в портфолио, через API Beget заводится временный FTP-аккаунт со
случайным паролем, файлы уходят по FTPS (HTML последним), аккаунт удаляется.
Старые файлы на сервере не удаляются.

Доступ берётся из переменных окружения:

  BEGET_LOGIN         логин панели Beget
  BEGET_API_PASSWORD  пароль для API: панель Beget → раздел «API»

Необязательные:

  BEGET_FTP_HOST      по умолчанию <login>.beget.tech
  BEGET_SITE_DIR      по умолчанию /<login>.beget.tech/public_html
  SITE_URL            по умолчанию https://danyatroyanov.com/goulash/

Запуск:

  python3 scripts/deploy_beget.py            # выкатить
  python3 scripts/deploy_beget.py --dry-run  # показать, что уедет, без сети
"""

from __future__ import annotations

import argparse
import ftplib
import json
import os
import re
import secrets
import ssl
import string
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT
REMOTE = "goulash"
SKIP = {".git", "scripts", "README.md", ".nojekyll", ".gitignore", ".DS_Store"}
API = "https://api.beget.com/api"


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if not value:
        sys.exit(f"Не задана переменная окружения {name}")
    return value


def beget(method: str, login: str, password: str, data: dict) -> object:
    """Вызов API Beget. Возвращает result или завершает скрипт с ошибкой."""
    query = urllib.parse.urlencode({
        "login": login,
        "passwd": password,
        "input_format": "json",
        "output_format": "json",
        "input_data": json.dumps(data),
    })
    # POST, чтобы пароль не оседал в логах запросов как часть URL.
    request = urllib.request.Request(f"{API}/{method}", data=query.encode(), method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)

    answer = payload.get("answer", {}) if payload.get("status") == "success" else payload
    if payload.get("status") != "success" or answer.get("status") != "success":
        errors = answer.get("errors") or payload.get("errors") or payload
        raise RuntimeError(f"Beget API {method}: {errors}")
    return answer.get("result")


def files_in_upload_order() -> list[Path]:
    files = sorted(p for p in DIST.rglob("*") if p.is_file() and not (set(p.relative_to(DIST).parts) & SKIP))
    if not (DIST / "index.html").is_file():
        sys.exit("нет index.html — запускай из репозитория лендинга")
    # HTML последним: пока он старый, он ссылается на старые ассеты, которые
    # никуда не делись; новый HTML появляется, когда его ассеты уже на месте.
    return sorted(files, key=lambda p: (p.suffix == ".html", str(p)))


class SessionReuseFTP_TLS(ftplib.FTP_TLS):
    """FTPS, который переиспользует TLS-сессию на канале данных.

    FTP-сервер Beget требует, чтобы канал передачи файлов продолжал TLS-сессию
    управляющего соединения, иначе отвечает «522 session reuse required».
    Стандартный ftplib открывает для данных новую сессию — здесь подставляем
    сессию управляющего сокета.
    """

    def ntransfercmd(self, cmd, rest=None):
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            conn = self.context.wrap_socket(conn, server_hostname=self.host, session=self.sock.session)
        return conn, size


def ensure_dir(ftp: ftplib.FTP_TLS, remote_dir: str, known: set[str]) -> None:
    parts = [part for part in remote_dir.split("/") if part]
    path = ""
    for part in parts:
        path = f"{path}/{part}" if path else part
        if path in known:
            continue
        try:
            ftp.mkd(path)
        except ftplib.error_perm:
            pass  # папка уже есть
        known.add(path)


def upload(host: str, user: str, password: str, files: list[Path]) -> None:
    context = ssl.create_default_context()
    # В TLS 1.3 сессия появляется у сокета не сразу после рукопожатия, и её
    # нечем переиспользовать на канале данных. TLS 1.2 отдаёт её сразу.
    context.maximum_version = ssl.TLSVersion.TLSv1_2
    ftp = SessionReuseFTP_TLS(host, timeout=60, context=context)
    try:
        ftp.login(user, password)
        ftp.prot_p()  # шифруем и данные, а не только логин
        known: set[str] = set()
        total = len(files)
        for index, path in enumerate(files, 1):
            remote = f"{REMOTE}/{path.relative_to(DIST).as_posix()}"
            ensure_dir(ftp, str(Path(remote).parent.as_posix()), known)
            with path.open("rb") as handle:
                ftp.storbinary(f"STOR {remote}", handle)
            print(f"  [{index}/{total}] {remote}", flush=True)
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


def verify(site_url: str) -> None:
    stamp = re.search(r'window\.__v = "([^"]+)"', (DIST / "index.html").read_text("utf-8")).group(1)
    with urllib.request.urlopen(f"{site_url}?deploy={int(time.time())}", timeout=30) as response:
        live = response.read().decode("utf-8", "ignore")
    if f'window.__v = "{stamp}"' not in live:
        raise RuntimeError(f"Сайт отдаёт старую версию, ждали {stamp}")
    print(f"✓ {site_url} отдаёт свежую версию {stamp}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="только показать список файлов")
    args = parser.parse_args()

    # Доступ проверяем до сборки: иначе ошибка про пароль всплывёт через минуту.
    if not args.dry_run:
        env("BEGET_LOGIN")
        env("BEGET_API_PASSWORD")

    files = files_in_upload_order()
    size = sum(p.stat().st_size for p in files) / 1024 / 1024
    print(f"К заливке: {len(files)} файлов, {size:.1f} МБ")

    if args.dry_run:
        for path in files:
            print("  ", path.relative_to(DIST).as_posix())
        return

    login = env("BEGET_LOGIN")
    api_password = env("BEGET_API_PASSWORD")
    host = env("BEGET_FTP_HOST", f"{login}.beget.tech")
    site_dir = env("BEGET_SITE_DIR", f"/{login}.beget.tech/public_html")
    site_url = env("SITE_URL", "https://danyatroyanov.com/goulash/")

    # Beget ограничивает полный логин «login_suffix» 17 символами.
    room = 17 - len(login) - 1
    if room < 2:
        sys.exit(f"Логин {login} слишком длинный для временного FTP-аккаунта")
    suffix = "d" + secrets.token_hex(4)[: room - 1]
    alphabet = string.ascii_letters + string.digits
    ftp_password = "".join(secrets.choice(alphabet) for _ in range(24))
    ftp_user = f"{login}_{suffix}"

    print(f"→ временный FTP-аккаунт {ftp_user} → {site_dir}")
    beget("ftp/add", login, api_password, {"suffix": suffix, "homedir": site_dir, "password": ftp_password})
    try:
        upload(host, ftp_user, ftp_password, files)
    finally:
        beget("ftp/delete", login, api_password, {"suffix": suffix})
        print(f"→ временный аккаунт {ftp_user} удалён")

    verify(site_url)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ftplib.Error) as error:
        sys.exit(f"✗ {error}")
