/* Расчёт для пульта оплаты курьеров.
   Все числа условные: это пример для лендинга, а не модель реальной сети. */
(function (root) {
  const TOTAL = 14;        // курьеров в штате точки
  const BASE_RATE = 100;   // обычная ставка за заказ вне пика, ₽
  const FIXED = 28;        // постоянная часть на заказ, ₽
  const BONUS = 500;       // премия за выход в пик, ₽ за смену
  const WEATHER_PAY = 40;  // доплата за погоду, ₽ к заказу
  const PEAK_HOURS = 4;

  const DAYS = {
    weekday: { label: 'Будни, 14:00', demand: 12, turnout: 0.5, peak: false },
    friday: { label: 'Пятница, 19:00', demand: 28, turnout: 0.6, peak: true },
    saturday: { label: 'Суббота, 20:00', demand: 25, turnout: 0.62, peak: true },
  };

  const WEATHER = {
    clear: { label: 'Ясно', demandK: 1, turnoutK: 1, cap: 2.8, extraMin: 0, bad: false },
    rain: { label: 'Дождь', demandK: 1.25, turnoutK: 0.72, cap: 2.6, extraMin: 4, bad: true },
    snow: { label: 'Снег', demandK: 1.3, turnoutK: 0.66, cap: 2.3, extraMin: 7, bad: true },
  };

  const COURIERS = ['Артём К.', 'Дина М.', 'Руслан Т.', 'Олег П.', 'Саша В.', 'Тимур А.', 'Лена Г.',
    'Марат Ш.', 'Никита Д.', 'Влад Ц.', 'Егор Л.', 'Айдар Х.', 'Костя Б.', 'Юра Н.'];
  const ON_TIME_SHIFT = [15, 11, 8, 5, 3, 1, -1, -3, -5, -7, -9, -11, -13, -15];
  const RATING_SHIFT = [0.1, 0.3, -0.1, 0.2, -0.15, 0.05, 0.2, -0.1, 0.1, -0.2, 0.15, 0, -0.1, 0.05];

  const START = { day: 'friday', weather: 'rain', rate: 120, bonus: false, weatherPay: false };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function compute(s) {
    const d = DAYS[s.day];
    const w = WEATHER[s.weather];
    const bonusOn = d.peak && s.bonus;
    const weatherPayOn = w.bad && s.weatherPay;

    let share = d.turnout * w.turnoutK;
    if (d.peak) share += (s.rate - 120) * 0.0022;
    if (bonusOn) share += 0.14;
    if (weatherPayOn) share += 0.2;
    const couriers = clamp(Math.round(TOTAL * share), 2, TOTAL);

    const demand = d.demand * w.demandK;
    const load = demand / (couriers * w.cap);
    const time = clamp(Math.round(32 + 28 * (load - 0.9) + w.extraMin), 30 + w.extraMin, 95);
    const onTime = clamp(Math.round(100 - 1.6 * (time - 44)), 30, 96);

    const perCourierHour = Math.min(w.cap, demand / couriers);
    const rate = d.peak ? s.rate : BASE_RATE;
    const bonusPerOrder = bonusOn ? BONUS / (perCourierHour * PEAK_HOURS) : 0;
    const cost = Math.round(rate + FIXED + (weatherPayOn ? WEATHER_PAY : 0) + bonusPerOrder);

    const shift = COURIERS.slice(0, couriers).map((name, i) => {
      const courierOnTime = clamp(onTime + ON_TIME_SHIFT[i], 15, 99);
      return {
        name,
        orders: Math.max(1, Math.round(perCourierHour * PEAK_HOURS * (1.25 - i * 0.06))),
        onTime: courierOnTime,
        rating: clamp(3.3 + (courierOnTime / 100) * 1.5 + RATING_SHIFT[i], 3.5, 5),
      };
    });

    return { couriers, total: TOTAL, time, onTime, cost, shift, peak: d.peak, badWeather: w.bad };
  }

  const api = { compute, START, DAYS, WEATHER, TOTAL, BASE_RATE, BONUS, WEATHER_PAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CourierModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
