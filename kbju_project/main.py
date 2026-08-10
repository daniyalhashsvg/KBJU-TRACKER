from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
import csv
import sqlite3
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "nutrition.db"
PRODUCTS_CSV_PATH = BASE_DIR / "products.csv"


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def create_tables() -> None:
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL,
                calories REAL NOT NULL,
                protein REAL NOT NULL,
                fat REAL NOT NULL,
                carbs REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meal_date TEXT NOT NULL,
                name TEXT NOT NULL,
                grams REAL NOT NULL,
                calories REAL NOT NULL,
                protein REAL NOT NULL,
                fat REAL NOT NULL,
                carbs REAL NOT NULL,
                product_id INTEGER,
                FOREIGN KEY (product_id) REFERENCES products(id)
            );
            """
        )

        columns = {row["name"] for row in connection.execute("PRAGMA table_info(meals)")}
        if "product_id" not in columns:
            connection.execute("ALTER TABLE meals ADD COLUMN product_id INTEGER")


def seed_products() -> None:
    if not PRODUCTS_CSV_PATH.exists():
        raise RuntimeError("Не найден файл products.csv")

    with PRODUCTS_CSV_PATH.open("r", encoding="utf-8-sig", newline="") as file:
        products = list(csv.DictReader(file))

    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO products (name, category, calories, protein, fat, carbs)
            VALUES (:name, :category, :calories, :protein, :fat, :carbs)
            ON CONFLICT(name) DO UPDATE SET
                category = excluded.category,
                calories = excluded.calories,
                protein = excluded.protein,
                fat = excluded.fat,
                carbs = excluded.carbs
            """,
            products,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    seed_products()
    yield


app = FastAPI(
    title="KBJU Tracker API",
    description="REST API для расчёта суточной нормы, поиска продуктов и учёта питания",
    version="2.0.0",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


class ProfileInput(BaseModel):
    sex: Literal["male", "female"]
    age: int = Field(ge=14, le=100)
    height: float = Field(gt=100, le=250)
    weight: float = Field(gt=30, le=350)
    activity: float = Field(ge=1.2, le=1.9)
    goal: Literal["lose", "maintain", "gain"]


class NutritionTarget(BaseModel):
    bmr: float
    tdee: float
    target_calories: float
    protein: float
    fat: float
    carbs: float


class Product(BaseModel):
    id: int
    name: str
    category: str
    calories: float
    protein: float
    fat: float
    carbs: float


class MealFromProduct(BaseModel):
    meal_date: date
    product_id: int = Field(gt=0)
    grams: float = Field(gt=0, le=5000)


class Meal(BaseModel):
    id: int
    meal_date: date
    name: str
    grams: float
    calories: float
    protein: float
    fat: float
    carbs: float
    product_id: int | None = None


class DailySummary(BaseModel):
    meal_date: date
    calories: float
    protein: float
    fat: float
    carbs: float
    meals_count: int


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def home(request: Request):
    return templates.TemplateResponse(request=request, name="index.html", context={"page_title": "KBJU Tracker"})


@app.get("/health", tags=["System"])
def health():
    with get_connection() as connection:
        count = connection.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    return {"status": "ok", "products": count}


@app.post("/api/calculate", response_model=NutritionTarget, tags=["Calculation"])
def calculate_target(profile: ProfileInput):
    bmr = 10 * profile.weight + 6.25 * profile.height - 5 * profile.age + (5 if profile.sex == "male" else -161)
    tdee = bmr * profile.activity
    target_calories = tdee * {"lose": 0.85, "maintain": 1.0, "gain": 1.10}[profile.goal]
    protein = profile.weight * 1.8
    fat = profile.weight * 0.9
    carbs = max(0, (target_calories - protein * 4 - fat * 9) / 4)
    return NutritionTarget(
        bmr=round(bmr, 1), tdee=round(tdee, 1), target_calories=round(target_calories),
        protein=round(protein), fat=round(fat), carbs=round(carbs)
    )


@app.get("/api/products", response_model=list[Product], tags=["Products"])
def search_products(q: str = Query(default="", max_length=80), limit: int = Query(default=12, ge=1, le=50)):
    search = q.strip().casefold()
    with get_connection() as connection:
        rows = connection.execute("SELECT * FROM products ORDER BY name").fetchall()

    products = [dict(row) for row in rows]
    if search:
        products = [
            product for product in products
            if search in product["name"].casefold() or search in product["category"].casefold()
        ]
        products.sort(key=lambda product: (not product["name"].casefold().startswith(search), product["name"]))

    return [Product(**product) for product in products[:limit]]


@app.get("/api/products/{product_id}", response_model=Product, tags=["Products"])
def get_product(product_id: int):
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Продукт не найден")
    return Product(**dict(row))


@app.post("/api/meals/from-product", response_model=Meal, status_code=201, tags=["Meals"])
def create_meal_from_product(data: MealFromProduct):
    with get_connection() as connection:
        product = connection.execute("SELECT * FROM products WHERE id = ?", (data.product_id,)).fetchone()
        if product is None:
            raise HTTPException(status_code=404, detail="Продукт не найден")

        factor = data.grams / 100
        values = {
            "calories": round(product["calories"] * factor, 1),
            "protein": round(product["protein"] * factor, 1),
            "fat": round(product["fat"] * factor, 1),
            "carbs": round(product["carbs"] * factor, 1),
        }
        cursor = connection.execute(
            """
            INSERT INTO meals (meal_date, name, grams, calories, protein, fat, carbs, product_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (data.meal_date.isoformat(), product["name"], data.grams, values["calories"],
             values["protein"], values["fat"], values["carbs"], data.product_id),
        )
        meal_id = cursor.lastrowid

    return Meal(id=meal_id, meal_date=data.meal_date, name=product["name"], grams=data.grams,
                product_id=data.product_id, **values)


@app.get("/api/meals", response_model=list[Meal], tags=["Meals"])
def list_meals(meal_date: date | None = Query(default=None)):
    sql = "SELECT * FROM meals"
    parameters: tuple = ()
    if meal_date:
        sql += " WHERE meal_date = ?"
        parameters = (meal_date.isoformat(),)
    sql += " ORDER BY meal_date DESC, id DESC"
    with get_connection() as connection:
        rows = connection.execute(sql, parameters).fetchall()
    return [Meal(**dict(row)) for row in rows]


@app.delete("/api/meals/{meal_id}", status_code=204, tags=["Meals"])
def delete_meal(meal_id: int):
    with get_connection() as connection:
        cursor = connection.execute("DELETE FROM meals WHERE id = ?", (meal_id,))
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Запись не найдена")


@app.get("/api/analytics", tags=["Analytics"])
def analytics(period: Literal["day", "week", "month"] = "day", meal_date: date | None = Query(default=None)):
    """Возвращает данные о калориях для графика за день, неделю или месяц."""
    selected_date = meal_date or date.today()

    with get_connection() as connection:
        if period == "day":
            rows = connection.execute(
                """
                SELECT name, calories, id
                FROM meals
                WHERE meal_date = ?
                ORDER BY id ASC
                """,
                (selected_date.isoformat(),),
            ).fetchall()
            return {
                "period": "day",
                "start": selected_date.isoformat(),
                "end": selected_date.isoformat(),
                "labels": [f"Блюдо {index}" for index, _ in enumerate(rows, start=1)],
                "values": [round(row["calories"], 1) for row in rows],
                "details": [row["name"] for row in rows],
            }

        if period == "week":
            start = selected_date.fromordinal(selected_date.toordinal() - selected_date.weekday())
            end = start.fromordinal(start.toordinal() + 6)
        else:
            start = selected_date.replace(day=1)
            if start.month == 12:
                next_month = start.replace(year=start.year + 1, month=1, day=1)
            else:
                next_month = start.replace(month=start.month + 1, day=1)
            end = next_month.fromordinal(next_month.toordinal() - 1)

        rows = connection.execute(
            """
            SELECT meal_date, COALESCE(SUM(calories), 0) AS calories
            FROM meals
            WHERE meal_date BETWEEN ? AND ?
            GROUP BY meal_date
            ORDER BY meal_date
            """,
            (start.isoformat(), end.isoformat()),
        ).fetchall()

    totals = {row["meal_date"]: round(row["calories"], 1) for row in rows}
    labels = []
    values = []
    current = start
    while current <= end:
        key = current.isoformat()
        labels.append(current.strftime("%d.%m"))
        values.append(totals.get(key, 0))
        current = current.fromordinal(current.toordinal() + 1)

    return {
        "period": period,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "labels": labels,
        "values": values,
        "details": [],
    }


@app.get("/api/summary/{meal_date}", response_model=DailySummary, tags=["Analytics"])
def daily_summary(meal_date: date):
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT COALESCE(SUM(calories), 0) calories, COALESCE(SUM(protein), 0) protein,
                   COALESCE(SUM(fat), 0) fat, COALESCE(SUM(carbs), 0) carbs, COUNT(*) meals_count
            FROM meals WHERE meal_date = ?
            """,
            (meal_date.isoformat(),),
        ).fetchone()
    return DailySummary(meal_date=meal_date, calories=round(row["calories"], 1),
                        protein=round(row["protein"], 1), fat=round(row["fat"], 1),
                        carbs=round(row["carbs"], 1), meals_count=row["meals_count"])
