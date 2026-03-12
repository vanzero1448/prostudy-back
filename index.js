require("dotenv").config();
const express = require("express");
const cors = require("cors");
const md5 = require("md5");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Инициализация Телеграм Бота ---
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const adminIds = process.env.ADMIN_CHAT_IDS
  ? process.env.ADMIN_CHAT_IDS.split(",").map((id) => id.trim())
  : [];

// --- База данных (в памяти) ---
const db = {
  promocodes: [
    { code: "IVY2026", type: "percent", value: 10 },
    { code: "GIFT5000", type: "fixed", value: 5000 },
  ],
  orders: [],
};

// --- Прайс-лист на бэкенде (эталон цен) ---
const SERVICES_PRICES = {
  "Полное сопровождение": 90000,
  "Стратегия поступления": 19000,
  "Разбор кейса": 2990,
  "College List": 2990,
  "Extracurricular Plan": 3490,
  "Summer Programs": 4999,
  "Personal Statement": 14900,
  "Supplemental Essay": 3900,
  "Activity List": 3999,
  "Academic Resume": 1400,
  "Письма-рекомендации": 1999,
  "Сайт-резюме абитуриента": 4999,
  "Сайт под ваш проект": 7980,
  "Notion-дашборд": 4900,
  "Аудит LinkedIn": 3900,
  "Cold Email Mentorship": 4210,
  "Waitlist Support": 4990,
  "Financial Aid (CSS)": 1900,
};

const adminStates = {};

const notifyAdmins = (text, options = {}) => {
  adminIds.forEach((id) => {
    bot
      .sendMessage(id, text, options)
      .catch((err) =>
        console.error(`Ошибка отправки админу ${id}:`, err.message),
      );
  });
};

// --- Главное меню бота ---
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (!adminIds.includes(chatId))
    return bot.sendMessage(chatId, "Нет доступа.");

  delete adminStates[chatId];

  const mainKeyboard = {
    reply_markup: {
      keyboard: [[{ text: "🎟 Управлять промокодами" }]],
      resize_keyboard: true,
    },
  };

  bot.sendMessage(
    chatId,
    "👋 Привет! Я бот управления ProStudy.\nИспользуй кнопку внизу для управления промокодами.",
    mainKeyboard,
  );
});

// --- Обработка кнопок бота (Inline) ---
bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id.toString();
  if (!adminIds.includes(chatId)) return;
  const data = query.data;

  if (data === "promo_list") {
    if (db.promocodes.length === 0)
      return bot.sendMessage(chatId, "Промокодов пока нет.");
    const list = db.promocodes
      .map(
        (p) =>
          `▫️ <b>${p.code}</b> — скидка ${p.value}${p.type === "percent" ? "%" : " ₽"}`,
      )
      .join("\n");
    bot.sendMessage(chatId, `🎟 <b>Активные промокоды:</b>\n\n${list}`, {
      parse_mode: "HTML",
    });
  }

  if (data === "promo_add_percent") {
    adminStates[chatId] = { action: "adding_percent" };
    bot.sendMessage(
      chatId,
      "Отправьте мне <b>КОД</b> и <b>ПРОЦЕНТ</b> через пробел.\n<i>Пример: SALE 15</i>",
      { parse_mode: "HTML" },
    );
  }

  if (data === "promo_add_fixed") {
    adminStates[chatId] = { action: "adding_fixed" };
    bot.sendMessage(
      chatId,
      "Отправьте мне <b>КОД</b> и <b>СУММУ</b> (в рублях) через пробел.\n<i>Пример: MINUS 5000</i>",
      { parse_mode: "HTML" },
    );
  }

  if (data === "promo_delete") {
    adminStates[chatId] = { action: "deleting" };
    bot.sendMessage(
      chatId,
      "Отправьте название промокода, который нужно удалить:",
    );
  }
});

// --- Обработка текстового ввода бота ---
bot.on("message", (msg) => {
  const chatId = msg.chat.id.toString();
  const text = msg.text;
  if (!adminIds.includes(chatId) || !text || text.startsWith("/")) return;

  if (text === "🎟 Управлять промокодами") {
    delete adminStates[chatId];
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Список промокодов", callback_data: "promo_list" }],
          [
            { text: "➕ Создать (%)", callback_data: "promo_add_percent" },
            { text: "➕ Создать (₽)", callback_data: "promo_add_fixed" },
          ],
          [{ text: "❌ Удалить промокод", callback_data: "promo_delete" }],
        ],
      },
    };
    return bot.sendMessage(
      chatId,
      "🎛 <b>Панель управления ProStudy</b>\nВыберите действие:",
      { parse_mode: "HTML", ...opts },
    );
  }

  const state = adminStates[chatId];
  if (!state) return;

  if (state.action === "adding_percent" || state.action === "adding_fixed") {
    const parts = text.split(" ");
    if (parts.length !== 2 || isNaN(parts[1])) {
      return bot.sendMessage(
        chatId,
        "⚠️ Неверный формат. Попробуйте еще раз (например: PROMO 20):",
      );
    }

    const code = parts[0].toUpperCase();
    const value = parseInt(parts[1]);
    const type = state.action === "adding_percent" ? "percent" : "fixed";

    if (db.promocodes.find((p) => p.code === code)) {
      return bot.sendMessage(chatId, "⚠️ Такой промокод уже существует!");
    }

    db.promocodes.push({ code, type, value });
    delete adminStates[chatId];
    bot.sendMessage(
      chatId,
      `✅ Промокод <b>${code}</b> на скидку ${value}${type === "percent" ? "%" : " ₽"} успешно создан!`,
      { parse_mode: "HTML" },
    );
  }

  if (state.action === "deleting") {
    const codeToDelete = text.toUpperCase();
    const initialLength = db.promocodes.length;

    db.promocodes = db.promocodes.filter((p) => p.code !== codeToDelete);
    delete adminStates[chatId];

    if (db.promocodes.length < initialLength) {
      bot.sendMessage(chatId, `🗑 Промокод <b>${codeToDelete}</b> удален.`, {
        parse_mode: "HTML",
      });
    } else {
      bot.sendMessage(chatId, `⚠️ Промокод <b>${codeToDelete}</b> не найден.`, {
        parse_mode: "HTML",
      });
    }
  }
});

// --- API: Бесплатная консультация ---
app.post("/api/consultation", (req, res) => {
  const { name, telegram } = req.body;

  const cleanTg = telegram.replace("@", "").trim();
  const text = `🔥 <b>Новая заявка на консультацию!</b>\n\nИмя: ${name}\nTelegram: @${cleanTg}`;

  const options = {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💬 Написать клиенту", url: `https://t.me/${cleanTg}` }],
      ],
    },
  };

  notifyAdmins(text, options);
  res.json({ success: true });
});

// --- API: Проверка промокода ---
app.post("/api/check-promo", (req, res) => {
  const { promo } = req.body;
  if (!promo) return res.json({ success: false });

  const activePromo = db.promocodes.find((p) => p.code === promo.toUpperCase());
  if (activePromo) {
    res.json({
      success: true,
      type: activePromo.type,
      value: activePromo.value,
    });
  } else {
    res.json({ success: false, message: "Промокод не найден" });
  }
});

// --- API: Создание платежа (AnyPay) ---
app.post("/api/checkout", (req, res) => {
  const { name, contact, promo, serviceTitle } = req.body;
  const realPrice = SERVICES_PRICES[serviceTitle];

  if (!realPrice) {
    return res
      .status(400)
      .json({ success: false, message: "Услуга не найдена" });
  }

  let finalPrice = realPrice;
  let isPromoValid = false;

  if (promo) {
    const activePromo = db.promocodes.find(
      (p) => p.code === promo.toUpperCase(),
    );
    if (activePromo) {
      if (activePromo.type === "percent") {
        finalPrice = Math.round(realPrice * (1 - activePromo.value / 100));
      } else if (activePromo.type === "fixed") {
        finalPrice = Math.max(1, realPrice - activePromo.value);
      }
      isPromoValid = true;
    }
  }

  const invId = db.orders.length + 1;
  db.orders.push({
    invId,
    name,
    contact,
    serviceTitle,
    price: finalPrice,
    status: "pending",
  });

  const projectId = process.env.ANYPAY_PROJECT_ID;
  const secretKey = process.env.ANYPAY_SECRET_KEY;
  const currency = "RUB";
  const description = `Оплата услуги: ${serviceTitle}`;

  // Генерация подписи для AnyPay
  const signatureString = `${projectId}:${invId}:${finalPrice}:${currency}:${description}:${secretKey}`;
  const signature = md5(signatureString);

  // Ссылка на кассу
  const paymentUrl = `https://anypay.io/merchant?merchant_id=${projectId}&pay_id=${invId}&amount=${finalPrice}&currency=${currency}&desc=${encodeURIComponent(description)}&sign=${signature}`;

  res.json({ success: true, url: paymentUrl, isPromoValid });
});

// --- API: Result URL (Успешная оплата AnyPay) ---
app.post("/api/payment/result", (req, res) => {
  const { merchant_id, amount, pay_id, status, sign } = req.body;
  const secretKey = process.env.ANYPAY_SECRET_KEY;

  // Проверка подписи от сервера AnyPay, чтобы избежать фейковых запросов
  const mySignature = md5(`${merchant_id}:${amount}:${pay_id}:${secretKey}`);

  if (mySignature === sign) {
    if (status === "paid") {
      const order = db.orders.find((o) => o.invId === parseInt(pay_id));

      if (order && order.status !== "paid") {
        order.status = "paid";
        const text = `💰 <b>УСПЕШНАЯ ОПЛАТА!</b>\n\nУслуга: ${order.serviceTitle}\nСумма: ${amount} руб.\nКлиент: ${order.name}\nКонтакт: ${order.contact}`;

        let contactUrl = "";
        const cleanContact = order.contact.trim();

        if (cleanContact.includes("@") && cleanContact.includes(".")) {
          contactUrl = `mailto:${cleanContact}`;
        } else {
          contactUrl = `https://t.me/${cleanContact.replace("@", "")}`;
        }

        const options = {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💬 Написать клиенту", url: contactUrl }],
            ],
          },
        };

        notifyAdmins(text, options);
      }
    }
    // AnyPay всегда ждет ответ "OK", иначе будет бесконечно слать запросы
    res.send("OK");
  } else {
    // Если кто-то пытается подделать запрос
    res.status(400).send("Bad sign");
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log(`Сервер запущен на порту ${process.env.PORT || 3000}`),
);
