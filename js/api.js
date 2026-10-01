const API_BASE_URL = "http://127.0.0.1:8000";

/**
 * 1. Відправка повідомлення в чат і отримання відповіді з картками
 */
async function sendChatMessage(message, history = []) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                history: history
            })
        });

        if (!response.ok) {
            throw new Error(`Помилка сервера: ${response.status}`);
        }

        // Парсимо JSON-відповідь від FastAPI
        const data = await response.json();
        return data; // Поверне об'єкт: { reply: "...", cards: [...] }

    } catch (error) {
        console.error("Помилка при запиті до чату:", error);
        throw error;
    }
}

/**
 * 2. Відправка карток на сервер та автоматичне скачування .apkg файлу
 */
async function exportDeck(deckName, cards) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/export-deck`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                deck_name: deckName,
                cards: cards
            })
        });

        if (!response.ok) {
            throw new Error(`Помилка скачування: ${response.status}`);
        }

        // Зчитуємо бінарний файл (Blob), який повернув FastAPI
        const blob = await response.blob();

        // Створюємо тимчасове посилання в браузері для завантаження файлу
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${deckName}.apkg`;
        
        // Додаємо посилання в DOM, імітуємо клік для завантаження і видаляємо його
        document.body.appendChild(link);
        link.click();
        link.remove();
        
        // Очищаємо пам'ять від тимчасового посилання
        window.URL.revokeObjectURL(downloadUrl);

    } catch (error) {
        console.error("Помилка при експорті колоди:", error);
        throw error;
    }
}