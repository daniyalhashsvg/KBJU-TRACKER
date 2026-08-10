# KBJU Tracker

Учебное веб-приложение на FastAPI, HTML, Bootstrap, JavaScript и SQLite.


- расчёт BMR, TDEE и целевых КБЖУ;
- база из **330 продуктов** в `products.csv`;
- поиск продуктов с выпадающими подсказками;
- автоматический расчёт калорий, белков, жиров и углеводов по весу;
- сохранение и удаление приёмов пищи;
- дневная сводка;
- REST API и Swagger-документация.


1. Установите Python 3.14 или новее.
2. Откройте папку проекта в VS Code.
3. Откройте **Terminal → New Terminal**.
4. Выполните:

```powershell
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

5. Откройте:

- сайт: http://127.0.0.1:8000
- Swagger API: http://127.0.0.1:8000/docs

Файл `nutrition.db` создаётся автоматически. При запуске таблица `products` заполняется данными из `products.csv`.


- `POST /api/calculate` — расчёт нормы;
- `GET /api/products?q=курица` — поиск продуктов;
- `GET /api/products/{id}` — один продукт;
- `POST /api/meals/from-product` — добавить продукт и автоматически рассчитать КБЖУ;
- `GET /api/meals?meal_date=YYYY-MM-DD` — дневник;
- `DELETE /api/meals/{id}` — удалить запись;
- `GET /api/summary/{date}` — дневная аналитика;
- `GET /health` — проверка сервера и количества продуктов.


В приложении добавлена отдельная вкладка «Графики». Она получает данные из REST API и показывает потребление калорий:
- за день — по отдельным приёмам пищи;
- за неделю — по дням;
- за месяц — по дням.

Для визуализации используется Chart.js, подключаемый на странице через CDN. Дополнительная Python-библиотека для графиков не требуется.
