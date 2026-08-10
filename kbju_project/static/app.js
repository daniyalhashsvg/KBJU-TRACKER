const messageBox = document.getElementById("message");
const mealDateInput = document.getElementById("mealDate");
const filterDateInput = document.getElementById("filterDate");
const mealNameInput = document.getElementById("mealName");
const productIdInput = document.getElementById("productId");
const gramsInput = document.getElementById("grams");
const suggestionsBox = document.getElementById("productSuggestions");
const nutritionFields = ["calories", "protein", "fat", "carbs"];

let selectedProduct = null;
let searchTimer = null;

const today = new Date().toISOString().slice(0, 10);
mealDateInput.value = today;
filterDateInput.value = today;

function showMessage(text, type = "success") {
    messageBox.innerHTML = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${escapeHtml(text)}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    window.scrollTo({ top: 0, behavior: "smooth" });
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
    });

    if (!response.ok) {
        let errorMessage = `Ошибка HTTP ${response.status}`;
        try {
            const data = await response.json();
            errorMessage = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
        } catch (_) {}
        throw new Error(errorMessage);
    }

    if (response.status === 204) return null;
    return response.json();
}

function clearNutrition() {
    nutritionFields.forEach(id => document.getElementById(id).value = "");
}

function calculateSelectedProduct() {
    if (!selectedProduct || !gramsInput.value) {
        clearNutrition();
        return;
    }

    const factor = Number(gramsInput.value) / 100;
    nutritionFields.forEach(field => {
        document.getElementById(field).value = (selectedProduct[field] * factor).toFixed(1);
    });
}

function selectProduct(product) {
    selectedProduct = product;
    productIdInput.value = product.id;
    mealNameInput.value = product.name;
    suggestionsBox.classList.add("d-none");
    calculateSelectedProduct();
}

function renderSuggestions(products) {
    suggestionsBox.innerHTML = "";

    if (!products.length) {
        suggestionsBox.innerHTML = '<div class="p-3 text-secondary">Ничего не найдено</div>';
        suggestionsBox.classList.remove("d-none");
        return;
    }

    products.forEach(product => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "product-option";
        button.innerHTML = `
            <strong>${escapeHtml(product.name)}</strong>
            <small>${escapeHtml(product.category)} · на 100 г: ${product.calories} ккал, Б ${product.protein}, Ж ${product.fat}, У ${product.carbs}</small>
        `;
        button.addEventListener("click", () => selectProduct(product));
        suggestionsBox.appendChild(button);
    });

    suggestionsBox.classList.remove("d-none");
}

async function searchProducts(query) {
    try {
        const products = await apiRequest(`/api/products?q=${encodeURIComponent(query)}&limit=12`);
        renderSuggestions(products);
    } catch (error) {
        showMessage(error.message, "danger");
    }
}

mealNameInput.addEventListener("input", () => {
    selectedProduct = null;
    productIdInput.value = "";
    clearNutrition();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchProducts(mealNameInput.value.trim()), 220);
});

mealNameInput.addEventListener("focus", () => searchProducts(mealNameInput.value.trim()));
gramsInput.addEventListener("input", calculateSelectedProduct);

document.addEventListener("click", event => {
    if (!event.target.closest(".product-search-wrap")) {
        suggestionsBox.classList.add("d-none");
    }
});

document.getElementById("calculatorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
        sex: document.getElementById("sex").value,
        age: Number(document.getElementById("age").value),
        height: Number(document.getElementById("height").value),
        weight: Number(document.getElementById("weight").value),
        activity: Number(document.getElementById("activity").value),
        goal: document.getElementById("goal").value
    };

    try {
        const result = await apiRequest("/api/calculate", { method: "POST", body: JSON.stringify(payload) });
        document.getElementById("resultCalories").textContent = result.target_calories;
        document.getElementById("resultProtein").textContent = result.protein;
        document.getElementById("resultFat").textContent = result.fat;
        document.getElementById("resultCarbs").textContent = result.carbs;
        document.getElementById("resultBmr").textContent = result.bmr;
        document.getElementById("resultTdee").textContent = result.tdee;
        document.getElementById("calculationResult").classList.remove("d-none");
    } catch (error) {
        showMessage(error.message, "danger");
    }
});

document.getElementById("mealForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedProduct || !productIdInput.value) {
        showMessage("Выберите продукт из выпадающего списка.", "danger");
        mealNameInput.focus();
        return;
    }

    const payload = {
        meal_date: mealDateInput.value,
        product_id: Number(productIdInput.value),
        grams: Number(gramsInput.value)
    };

    try {
        await apiRequest("/api/meals/from-product", { method: "POST", body: JSON.stringify(payload) });
        event.target.reset();
        selectedProduct = null;
        productIdInput.value = "";
        mealDateInput.value = filterDateInput.value;
        clearNutrition();
        showMessage("Приём пищи сохранён. КБЖУ рассчитаны автоматически.");
        await loadDiary();
    } catch (error) {
        showMessage(error.message, "danger");
    }
});

async function deleteMeal(id) {
    if (!confirm("Удалить эту запись?")) return;
    try {
        await apiRequest(`/api/meals/${id}`, { method: "DELETE" });
        await loadDiary();
    } catch (error) {
        showMessage(error.message, "danger");
    }
}

async function loadDiary() {
    const selectedDate = filterDateInput.value;
    try {
        const [meals, summary] = await Promise.all([
            apiRequest(`/api/meals?meal_date=${selectedDate}`),
            apiRequest(`/api/summary/${selectedDate}`)
        ]);

        const tbody = document.getElementById("mealTableBody");
        const emptyState = document.getElementById("emptyState");
        tbody.innerHTML = "";
        emptyState.classList.toggle("d-none", meals.length !== 0);

        for (const meal of meals) {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td><strong>${escapeHtml(meal.name)}</strong></td>
                <td>${meal.grams} г</td>
                <td>${meal.calories}</td>
                <td>${meal.protein}</td>
                <td>${meal.fat}</td>
                <td>${meal.carbs}</td>
                <td><button class="btn btn-sm btn-outline-danger" onclick="deleteMeal(${meal.id})">Удалить</button></td>
            `;
            tbody.appendChild(row);
        }

        document.getElementById("sumCalories").textContent = summary.calories;
        document.getElementById("sumProtein").textContent = `${summary.protein} г`;
        document.getElementById("sumFat").textContent = `${summary.fat} г`;
        document.getElementById("sumCarbs").textContent = `${summary.carbs} г`;
    } catch (error) {
        showMessage(error.message, "danger");
    }
}

function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value);
    return element.innerHTML;
}

filterDateInput.addEventListener("change", () => {
    mealDateInput.value = filterDateInput.value;
    loadDiary();
});

loadDiary();

// Навигация между дневником и отдельной вкладкой графиков.
const diaryTab = document.getElementById("diaryTab");
const chartsTab = document.getElementById("chartsTab");
const diaryTabButton = document.getElementById("diaryTabButton");
const chartsTabButton = document.getElementById("chartsTabButton");
const chartDateInput = document.getElementById("chartDate");
const chartPeriodText = document.getElementById("chartPeriodText");
const chartEmpty = document.getElementById("chartEmpty");
let caloriesChart = null;
let currentChartPeriod = "day";

chartDateInput.value = today;

function setActiveTab(tab) {
    const showDiary = tab === "diary";
    diaryTab.classList.toggle("d-none", !showDiary);
    chartsTab.classList.toggle("d-none", showDiary);

    diaryTabButton.className = showDiary
        ? "btn btn-light btn-sm app-tab active"
        : "btn btn-outline-light btn-sm app-tab";
    chartsTabButton.className = showDiary
        ? "btn btn-outline-light btn-sm app-tab"
        : "btn btn-light btn-sm app-tab active";

    if (!showDiary) loadCaloriesChart();
}

diaryTabButton.addEventListener("click", () => setActiveTab("diary"));
chartsTabButton.addEventListener("click", () => setActiveTab("charts"));

async function loadCaloriesChart() {
    try {
        const data = await apiRequest(
            `/api/analytics?period=${currentChartPeriod}&meal_date=${chartDateInput.value}`
        );

        const total = data.values.reduce((sum, value) => sum + Number(value), 0);
        chartEmpty.classList.toggle("d-none", total > 0);

        const canvas = document.getElementById("caloriesChart");
        const chartWrap = canvas.parentElement;
        chartWrap.classList.toggle("d-none", total === 0);

        let labels = data.labels;
        let values = data.values;

        if (currentChartPeriod === "day") {
            chartPeriodText.textContent = `${data.start}: калории по приёмам пищи`;
        } else if (currentChartPeriod === "week") {
            chartPeriodText.textContent = `Неделя: ${data.start} — ${data.end}`;
        } else {
            chartPeriodText.textContent = `Месяц: ${data.start.slice(0, 7)}`;
        }

        if (caloriesChart) {
            caloriesChart.destroy();
            caloriesChart = null;
        }

        if (total === 0) return;

        caloriesChart = new Chart(canvas, {
            type: "line",
            data: {
                labels,
                datasets: [{
                    label: "Калории, ккал",
                    data: values,
                    borderColor: "#3157d5",
                    backgroundColor: "rgba(49, 87, 213, 0.12)",
                    pointBackgroundColor: "#3157d5",
                    pointBorderColor: "#ffffff",
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    borderWidth: 3,
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: "index"
                },
                plugins: {
                    legend: {
                        display: true
                    },
                    tooltip: {
                        callbacks: {
                            label: context => `${context.parsed.y} ккал`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: "Калории, ккал"
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: currentChartPeriod === "day" ? "Блюдо" : "Дата"
                        }
                    }
                }
            }
        });
    } catch (error) {
        showMessage(error.message, "danger");
    }
}

document.querySelectorAll(".chart-period").forEach(button => {
    button.addEventListener("click", () => {
        currentChartPeriod = button.dataset.period;
        document.querySelectorAll(".chart-period").forEach(item => {
            item.classList.toggle("btn-primary", item === button);
            item.classList.toggle("btn-outline-primary", item !== button);
        });
        loadCaloriesChart();
    });
});

chartDateInput.addEventListener("change", loadCaloriesChart);

filterDateInput.addEventListener("change", () => {
    chartDateInput.value = filterDateInput.value;
});
